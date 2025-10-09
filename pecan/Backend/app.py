import os
import json
import time
import threading
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional, Literal
import logging
from contextlib import asynccontextmanager

import cantools
import redis

from fastapi.response import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncio  # Added asyncio import




REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_CHANNEL = os.getenv("REDIS_CHANNEL", "can_messages")
PIPE_PATH = os.getenv("PIPE_PATH", "/tmp/can_data_pipe")
MESSAGE_HISTORY_LIMIT = int(os.getenv("MESSAGE_HISTORY_LIMIT", "1000"))

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



@asynccontextmanager
async def lifespan(app: FastAPI):
    global db
    db = load_dbc_file()
    if db:
        try:
            names = ", ".join(m.name for m in db.messages[:5])
            logger.info(f"[DBC] Sample messages: {names} ...")
        except Exception:
            pass
    _start_background_listener()

    yield

    _stop_background_listener()


app = FastAPI(title="PECAN FastAPI", lifespan=lifespan)

lock = threading.Lock()
CAN_MESSAGES: Deque[Dict[str, Any]] = deque(maxlen=MESSAGE_HISTORY_LIMIT)

_new_msg_event = threading.Event() # Event to signal new messages

db = None
redis_client = None
pubsub = None
IS_REDIS_ACTIVE = False
_listener_thread: Optional[threading.Thread] = None
_stop_listener = threading.Event()


class Health(BaseModel):
    health: str
    status_code: int


class ImportPayload(BaseModel):
    id: str
    data: List[int]
    time: Optional[int] = None


class MessageOut(BaseModel):
    timestamp: str
    received_timestamp: str
    can_id: int
    message_name: str
    signals: Dict[str, Any]
    raw_data: List[int]
    error: Optional[str] = None


FilterMode = Literal["received_time", "count", "original_time", "all"]


def load_dbc_file():
    """Load DBC file with multiple path fallbacks."""
    dbc_paths = [
        "WFR25-eeae9849.dbc",
        "dbc_files/WFR25-eeae9849.dbc",
        os.path.join(os.path.dirname(__file__), "WFR25-eeae9849.dbc"),
        os.path.join(os.path.dirname(__file__), "dbc_files", "WFR25-eeae9849.dbc"),
        os.getenv("DBC_FILE", "dbc_files/WFR25-eeae9849.dbc"),
    ]
    for dbc_path in dbc_paths:
        try:
            if os.path.exists(dbc_path):
                db_local = cantools.database.load_file(dbc_path)
                print(f"[DBC] Loaded: {dbc_path} ({len(db_local.messages)} messages)")
                return db_local
        except Exception as e:
            print(f"[DBC] Failed path {dbc_path}: {e}")
            continue
    print("[DBC] Warning: No DBC file found - raw CAN data only")
    return None


def decode_can_message(can_id: int, data_bytes: bytes) -> Dict[str, Any]:
    if db is None:
        return {
            "can_id": can_id,
            "message_name": "Raw",
            "signals": {},
            "raw_data": list(data_bytes),
            "error": "No DBC file loaded",
        }
    try:
        msg = db.get_message_by_frame_id(can_id)
        decoded = msg.decode(data_bytes, allow_truncated=True)
        return {
            "can_id": can_id,
            "message_name": msg.name,
            "signals": decoded,
            "raw_data": list(data_bytes),
        }
    except Exception as e:
        return {
            "can_id": can_id,
            "message_name": "Unknown",
            "signals": {},
            "raw_data": list(data_bytes),
            "error": str(e),
        }


def _append_message(decoded: Dict[str, Any], original_ts: datetime, recv_ts: datetime):
    decoded["timestamp"] = original_ts.isoformat()
    decoded["received_timestamp"] = recv_ts.isoformat()
    with lock:
        CAN_MESSAGES.append(decoded)
    _new_msg_event.set()  # Signal that a new message has been added

 


def _parse_and_add(msg: Dict[str, Any]):
    """
    Expected inbound schema (both Redis and pipe lines):
    {
      "id": <int or hex-string>,
      "data": [ints],
      "time": <epoch_ms>
    }
    """
    can_id_val = msg.get("id")
    raw_data = msg.get("data")
    epoch_ms = msg.get("time")

    if can_id_val is None or raw_data is None:
        raise ValueError("Missing 'id' or 'data' in message")

    if isinstance(can_id_val, str):
        can_id_int = int(can_id_val, 0)
    else:
        can_id_int = int(can_id_val)

    data_bytes = bytes(raw_data)

    if epoch_ms is not None:
        original_ts = datetime.fromtimestamp(
            epoch_ms / 1000.0, tz=timezone.utc
        ).astimezone()
    else:
        original_ts = datetime.now().astimezone()
    recv_ts = datetime.now().astimezone()

    decoded = decode_can_message(can_id_int, data_bytes)
    _append_message(decoded, original_ts, recv_ts)


def _redis_listener():
    global pubsub
    msg_count = 0
    try:
        pubsub = redis_client.pubsub()
        pubsub.subscribe(REDIS_CHANNEL)
        logger.info(f"[REDIS] Subscribed to '{REDIS_CHANNEL}'")
        for item in pubsub.listen():
            if _stop_listener.is_set():
                break
            if not item or item.get("type") != "message":
                continue
            try:
                payload = item["data"]
                if isinstance(payload, bytes):
                    payload = payload.decode("utf-8")
                if not payload:
                    continue
                msg_json = json.loads(payload)
                _parse_and_add(msg_json)
                msg_count += 1
                if msg_count % 100 == 0:
                    logger.info(f"[REDIS] Processed {msg_count} messages")
            except Exception as e:
                logger.error(f"[REDIS] Parse error: {e}")
    except Exception as e:
        logger.error(f"[REDIS] Listener error: {e}")


def _pipe_listener():
    msg_count = 0
    logger.info(f"[PIPE] Listening on {PIPE_PATH}")
    while not _stop_listener.is_set():
        try:

            with open(PIPE_PATH, "r") as pipe:
                for line in pipe:
                    if _stop_listener.is_set():
                        break
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg_json = json.loads(line)
                        _parse_and_add(msg_json)
                        msg_count += 1
                        if msg_count % 100 == 0:
                            logger.info(f"[PIPE] Processed {msg_count} messages")
                    except Exception as e:
                        logger.error(f"[PIPE] Line parse error: {e}")
        except FileNotFoundError:
            try:
                os.mkfifo(PIPE_PATH)
                logger.error(f"[PIPE] Created named pipe at {PIPE_PATH}")
            except FileExistsError:
                pass
            time.sleep(1)
        except Exception as e:
            logger.error(f"[PIPE] Listener error: {e}")
            time.sleep(5)


def _start_background_listener():
    global IS_REDIS_ACTIVE, _listener_thread, redis_client
    try:
        redis_client = redis.Redis.from_url(REDIS_URL)
        redis_client.ping()
        IS_REDIS_ACTIVE = True
        target = _redis_listener
        logger.info("[BOOT] Redis available; using Pub/Sub")
    except Exception as e:
        logger.info(f"[BOOT] Redis unavailable ({e}); falling back to named pipe")
        IS_REDIS_ACTIVE = False
        target = _pipe_listener

    _listener_thread = threading.Thread(target=target, daemon=True)
    _listener_thread.start()


def _stop_background_listener():
    _stop_listener.set()
    try:
        if pubsub:
            pubsub.close()
    except Exception:
        pass

async def _sse_generator(request: Request):
    """
    Streams new CAN messages as a JSON. The Frontend applies filtering.
    """
    last_idx = 0
    heartbeat_interval = 15  # seconds
    loop = asyncio.get_event_loop()
    next_heartbeat = loop.time() + heartbeat_interval

    while True:
        if await request.is_disconnected():
            break

        with lock:
            snapshot = list(CAN_MESSAGES)

        if last_idx < len(snapshot):
            new_msgs = snapshot[last_idx:]
            last_idx = len(snapshot)
            for m in new_msgs:
                yield f"data: {json.dumps(m)}\n\n"
            next_heartbeat = loop.time() + heartbeat_interval

        now = loop.time()
        if now >= next_heartbeat:
            yield ":\n\n"  # SSE comment as heartbeat
            next_heartbeat = now + heartbeat_interval
        try:
            await asyncio.wait_for(asyncio.to_thread(_new_msg_event.wait), timeout=1.0 )
        except asyncio.TimeoutError:
            pass
        finally:
            _new_msg_event.clear()

@app.get("/api/stream")
async def stream_messages(request: Request):
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # Disable buffering for nginx
    }
    return StreamingResponse(_sse_generator(request), headers=headers)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", response_model=Health)
def health_check():
    mode = "Redis Pub/Sub" if IS_REDIS_ACTIVE else "Named Pipe"
    return Health(health=f"Healthy ({mode})", status_code=200)


@app.post("/api/import", status_code=201)
def import_can_message(payload: ImportPayload):
    """
    Manual import endpoint (same semantics as Flask version).
    Useful for testing without Redis/pipe.
    """
    try:
        can_id_int = int(payload.id, 0)
        data_bytes = bytes(payload.data)
        if payload.time is not None:
            original_ts = datetime.fromtimestamp(
                payload.time / 1000.0, tz=timezone.utc
            ).astimezone()
        else:
            original_ts = datetime.now().astimezone()
        recv_ts = datetime.now().astimezone()
        decoded = decode_can_message(can_id_int, data_bytes)
        _append_message(decoded, original_ts, recv_ts)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Decoding failed: {e}")


@app.get("/api/messages", response_model=List[MessageOut])
def get_messages(
    filter_mode: FilterMode = Query(
        "received_time", description="received_time | count | original_time | all"
    ),
    time_range: int = Query(
        60,
        ge=1,
        le=3600,
        description="Seconds (for time-based modes) or count (when filter_mode=count)",
    ),
    can_id: Optional[str] = Query(
        None, description="Exact CAN ID match (decimal or hex, e.g. 291 or 0x123)"
    ),
    message_name: Optional[str] = Query(None, description="Exact message name match"),
    limit: int = Query(
        100,
        ge=1,
        le=500,
        description="Max rows returned (after filtering, newest first)",
    ),
):
    """
    Flexible fetch for React tables.
    Modes:
      - received_time: messages received in the last `time_range` seconds
      - original_time: messages whose original timestamp in the last `time_range` seconds
      - count: the most recent `time_range` messages
      - all: no time filtering
    Optional filters: can_id, message_name
    """
    with lock:
        msgs = list(CAN_MESSAGES)

    filtered: List[Dict[str, Any]] = []
    now_local = datetime.now().astimezone()
    if filter_mode == "all":
        filtered = msgs
    elif filter_mode == "count":
        filtered = msgs[-min(time_range, len(msgs)) :]
    elif filter_mode == "received_time":
        cutoff = now_local - timedelta(seconds=time_range)
        for m in msgs:
            t = datetime.fromisoformat(m["received_timestamp"])
            if t >= cutoff:
                filtered.append(m)
    else:
        cutoff = now_local - timedelta(seconds=time_range)
        for m in msgs:
            t = datetime.fromisoformat(m["timestamp"])
            if t >= cutoff:
                filtered.append(m)

    if can_id:
        try:
            target_id = int(can_id, 0)
            filtered = [m for m in filtered if int(m["can_id"]) == target_id]
        except Exception:
            filtered = []
    if message_name:
        filtered = [m for m in filtered if m.get("message_name") == message_name]

    filtered = list(reversed(filtered))[:limit]

    return [
        MessageOut(
            timestamp=m["timestamp"],
            received_timestamp=m["received_timestamp"],
            can_id=int(m["can_id"]),
            message_name=m.get("message_name", "Unknown"),
            signals=m.get("signals", {}),
            raw_data=list(m.get("raw_data", [])),
            error=m.get("error"),
        )
        for m in filtered
    ]

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)