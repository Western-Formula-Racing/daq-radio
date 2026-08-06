"""FastAPI app for OMT: rule CRUD, signal index, DBC download, threshold
config, and the live alert stream."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..wcars.serialization import encode_alert, encode_backlog
from .engine_host import EngineHost
from .rule_store import ConflictError, NotFoundError, RuleStore, ValidationError


def signal_index(db) -> list[dict]:
    out = []
    for msg in db.messages:
        for sig in msg.signals:
            out.append({
                "message": msg.name,
                "signal": sig.name,
                "unit": sig.unit,
                "minimum": sig.minimum,
                "maximum": sig.maximum,
                "choices": ({int(k): str(v) for k, v in sig.choices.items()}
                            if sig.choices else None),
            })
    return out


def create_app(store: RuleStore, host: EngineHost, dbc_path: Path, db,
               bridge_url: str | None = None,
               static_dir: Path | None = None) -> FastAPI:
    # Precomputed: the DBC only changes with a service restart.
    signals = signal_index(db)
    dbc_sha = hashlib.sha256(dbc_path.read_bytes()).hexdigest()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # bridge_url is None under TestClient so no feed task runs in tests.
        shutdown = asyncio.Event()
        task = None
        if bridge_url is not None:
            task = asyncio.create_task(host.run(bridge_url, shutdown))
        yield
        shutdown.set()
        if task is not None:
            # Give the feed a chance to observe the event and unwind cleanly
            # (aclosing the stream, proper websocket close) before resorting to
            # cancellation; setting the event and cancelling back to back never
            # yields the loop, so the graceful path would never run.
            with contextlib.suppress(asyncio.TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(task), timeout=2.0)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="WCARS OMT", lifespan=lifespan)
    app.state.host = host

    # Route handlers are async def, not the plain def the FastAPI docs default
    # to: a plain def runs in a worker threadpool, and engine_host.py's design
    # assumes rule CRUD, the frame feed, and WebSocket senders all share one
    # event loop with no locking. A threadpool handler would race the feed
    # loop over engine._rules and rules.json.
    # Accepted cost: store writes fsync the file and its directory inline on the
    # event loop, which can stall the frame feed for tens of milliseconds per
    # edit on the Pi's SD card. Rule edits are human-paced, and moving the write
    # to a thread would reintroduce exactly that race. Do not "fix" this.
    @app.get("/api/rules")
    async def list_rules():
        return {"rules": store.list()}

    @app.post("/api/rules", status_code=201)
    async def create_rule(payload: dict):
        try:
            created = store.create(payload.get("rule"), payload.get("by", "unknown"))
        except ValidationError as exc:
            raise HTTPException(422, detail=exc.errors) from exc
        host.rules_changed()
        return created

    @app.put("/api/rules/{rule_id}")
    async def update_rule(rule_id: str, payload: dict):
        expected_rev = payload.get("expected_rev")
        # Without this a missing or malformed rev compares unequal to the stored
        # one and the tablet is told someone else edited the rule, which is a lie.
        if not isinstance(expected_rev, int) or isinstance(expected_rev, bool):
            raise HTTPException(
                422, detail=["expected_rev must be an integer"]) from None
        try:
            updated = store.update(rule_id, payload.get("rule"), expected_rev,
                                   payload.get("by", "unknown"))
        except NotFoundError as exc:
            raise HTTPException(404, detail="rule not found") from exc
        except ConflictError as exc:
            raise HTTPException(409, detail=str(exc)) from exc
        except ValidationError as exc:
            raise HTTPException(422, detail=exc.errors) from exc
        host.rules_changed()
        return updated

    @app.delete("/api/rules/{rule_id}", status_code=204)
    async def delete_rule(rule_id: str):
        try:
            store.delete(rule_id, "unknown")
        except NotFoundError as exc:
            raise HTTPException(404, detail="rule not found") from exc
        host.rules_changed()

    @app.post("/api/rules/{rule_id}/toggle")
    async def toggle_rule(rule_id: str, payload: dict):
        try:
            toggled = store.toggle(rule_id, bool(payload.get("enabled")),
                                   payload.get("by", "unknown"))
        except NotFoundError as exc:
            raise HTTPException(404, detail="rule not found") from exc
        host.rules_changed()
        return toggled

    @app.get("/api/signals")
    async def get_signals():
        return {"signals": signals}

    @app.get("/api/dbc")
    async def get_dbc():
        return FileResponse(dbc_path, media_type="text/plain",
                            headers={"X-DBC-SHA256": dbc_sha})

    @app.get("/api/config")
    async def get_config():
        return host.engine.config

    @app.put("/api/config")
    async def put_config(cfg: dict):
        try:
            return host.apply_config(cfg)
        except (TypeError, ValueError) as exc:
            # An empty or non-numeric threshold field in the tablet UI is user
            # error, not a server fault.
            raise HTTPException(422, detail=[f"invalid config value: {exc}"]) from exc

    @app.websocket("/ws/alerts")
    async def ws_alerts(ws: WebSocket):
        await ws.accept()
        q = host.subscribe()

        async def sender():
            await ws.send_json(encode_backlog(host.backlog()))
            while True:
                alert = await q.get()
                await ws.send_json(encode_alert(alert))

        async def drain_client():
            while True:
                try:
                    await ws.receive_text()
                except KeyError:
                    # receive_text raises KeyError, not WebSocketDisconnect, on a
                    # binary frame. A stray binary frame is not a disconnect, so
                    # keep serving alerts instead of tearing the stream down.
                    continue

        # The send loop alone would never notice a disconnect (it blocks on
        # q.get, not on the socket) and the receive loop alone would never
        # notice a dead sender, leaving the tablet on a connected socket that
        # can no longer show a fault. Race them, and whichever ends first ends
        # both. asyncio.wait does not cancel its futures, not even when the wait
        # itself is cancelled, so the cleanup lives in finally and covers the
        # shutdown path too.
        send_task = asyncio.create_task(sender())
        recv_task = asyncio.create_task(drain_client())
        try:
            await asyncio.wait({send_task, recv_task},
                               return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in (send_task, recv_task):
                t.cancel()
                # Suppress broadly: a send that failed on a half-open socket must
                # not stop us from unsubscribing, or the queue stays in the
                # host's subscriber set for the life of the process.
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await t
            host.unsubscribe(q)

    if static_dir is not None and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="omt")

    return app
