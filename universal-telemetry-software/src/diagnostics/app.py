"""FastAPI app for OMT: rule CRUD, signal index, DBC download, threshold
config, and the live alert stream."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..wcars.serialization import encode_alert, encode_backlog
from .engine_host import EngineHost
from .history import DEFAULT_QUERY_LIMIT, HistoryError
from .rule_store import ConflictError, NotFoundError, RuleStore, ValidationError
from .watch import WatchState

logger = logging.getLogger("diagnostics.app")


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


def parse_allowed_origins(raw: str | None) -> list[str]:
    """Origins allowed to call this API from a browser, from a comma-separated env.

    The tablet loads OMT's own UI from this same service, so it needs nothing here.
    PECAN is the cross-origin caller: it fetches the car's rules to replay a log,
    and a browser refuses that without a matching Access-Control-Allow-Origin, which
    surfaces to the user as an unhelpful "Load failed". The default is empty rather
    than "*" because the service has no auth: any page a team member happened to
    open while on the car's hotspot could otherwise rewrite the fault rules.
    """
    if not raw:
        return []
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def create_app(store: RuleStore, host: EngineHost, dbc_path: Path, db,
               bridge_url: str | None = None,
               static_dir: Path | None = None,
               history=None,
               allowed_origins: list[str] | None = None) -> FastAPI:
    # Precomputed: the DBC only changes with a service restart.
    signals = signal_index(db)
    dbc_sha = hashlib.sha256(dbc_path.read_bytes()).hexdigest()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # bridge_url is None under TestClient so no feed task runs in tests. The
        # history writer is tied to the same condition: nothing queues history
        # without a feed, and tests drain it themselves.
        shutdown = asyncio.Event()
        tasks = []
        if bridge_url is not None:
            tasks.append(asyncio.create_task(host.run(bridge_url, shutdown)))
            if history is not None:
                tasks.append(asyncio.create_task(host.run_history_writer(shutdown)))
        yield
        shutdown.set()
        for task in tasks:
            # Give each task a chance to observe the event and unwind cleanly
            # (aclosing the stream, a final history drain, proper websocket
            # close) before resorting to cancellation; setting the event and
            # cancelling back to back never yields the loop, so the graceful
            # path would never run.
            with contextlib.suppress(asyncio.TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(task), timeout=2.0)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="WCARS OMT", lifespan=lifespan)
    app.state.host = host

    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_methods=["GET", "POST", "PUT", "DELETE"],
            allow_headers=["Content-Type"],
        )

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

    def _unavailable(exc: OSError) -> HTTPException:
        # A full or read-only SD card is routine on a Pi test day. 503 tells the
        # tablet the rule was not stored and the engine did not get it, where a
        # bare 500 would leave the team believing an unarmed rule is armed.
        logger.error("rule store write failed under %s: %s", store.data_dir, exc)
        return HTTPException(
            503, detail=f"rule store at {store.data_dir} is not writable: {exc}")

    @app.post("/api/rules", status_code=201)
    async def create_rule(payload: dict):
        try:
            created = store.create(payload.get("rule"), payload.get("by", "unknown"))
        except ValidationError as exc:
            raise HTTPException(422, detail=exc.errors) from exc
        except OSError as exc:
            raise _unavailable(exc) from exc
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
        except OSError as exc:
            raise _unavailable(exc) from exc
        host.rules_changed()
        return updated

    @app.delete("/api/rules/{rule_id}", status_code=204)
    async def delete_rule(rule_id: str):
        try:
            store.delete(rule_id, "unknown")
        except NotFoundError as exc:
            raise HTTPException(404, detail="rule not found") from exc
        except OSError as exc:
            raise _unavailable(exc) from exc
        host.rules_changed()

    @app.post("/api/rules/{rule_id}/toggle")
    async def toggle_rule(rule_id: str, payload: dict):
        try:
            toggled = store.toggle(rule_id, bool(payload.get("enabled")),
                                   payload.get("by", "unknown"))
        except NotFoundError as exc:
            raise HTTPException(404, detail="rule not found") from exc
        except OSError as exc:
            raise _unavailable(exc) from exc
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

    def _require_history():
        if history is None:
            # Not 200 with an empty list: a Phase A deployment has no database,
            # and an empty fault log would tell whoever is deciding whether the
            # car is safe that we looked and saw nothing.
            raise HTTPException(
                503, detail="fault history is not configured on this service")
        return history

    def _history_unavailable(exc: HistoryError) -> HTTPException:
        # Same reasoning as the empty log: a read that failed must reach the
        # tablet as a failure, never as an absence of faults.
        logger.error("fault history read failed: %s", exc)
        return HTTPException(503, detail=f"fault history is unreadable: {exc}")

    @app.get("/api/history")
    async def get_history(rule_id: str | None = None, severity: str | None = None,
                          from_ms: int | None = None, to_ms: int | None = None,
                          limit: int = DEFAULT_QUERY_LIMIT):
        h = _require_history()
        try:
            events = h.query(rule_id=rule_id, severity=severity,
                             from_ms=from_ms, to_ms=to_ms, limit=limit)
        except HistoryError as exc:
            raise _history_unavailable(exc) from exc
        return {"events": events}

    @app.get("/api/freeze/{event_id}")
    async def get_freeze(event_id: int):
        h = _require_history()
        try:
            payload = h.freeze_frame(event_id)
        except HistoryError as exc:
            raise _history_unavailable(exc) from exc
        if payload is None:
            raise HTTPException(404, detail=f"no freeze frame for event {event_id}")
        return {"event_id": event_id, "freeze": payload}

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
                # Never let a failed task stop us from unsubscribing, or the queue
                # stays in the host's subscriber set for the life of the process.
                # Log it though: a crashing sender is the fault this teardown was
                # built to survive, and swallowing it silently leaves a tablet
                # reconnect-flapping with nothing in the journal to explain it.
                try:
                    await t
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception("Alert socket task failed")
            host.unsubscribe(q)

    # Deliberately the same shape as /ws/alerts: a sender raced against a
    # drain_client, unsubscribe in finally, and KeyError tolerated on a binary
    # frame. Each of those was a review finding on that handler; a second socket
    # with a different shape would have to relearn all three.
    @app.websocket("/ws/watch")
    async def ws_watch(ws: WebSocket):
        await ws.accept()
        state = WatchState()
        q = host.subscribe_watch()

        async def sender():
            while True:
                signals, ts_ms = await q.get()
                # Swept on frame time, from whichever frame just arrived: any
                # message advances the clock, so a dead sensor on one message
                # surfaces as soon as any other traffic moves. The wall clock is
                # not an option here, and a bus that has gone entirely silent is
                # a different failure that /ws/alerts already shows.
                items = state.offer(signals, ts_ms) + state.sweep(ts_ms)
                if items:
                    await ws.send_json({"type": "wcars_watch", "items": items})

        async def drain_client():
            while True:
                try:
                    raw = await ws.receive_text()
                except KeyError:
                    # receive_text raises KeyError, not WebSocketDisconnect, on a
                    # binary frame. A stray binary frame is not a disconnect, so
                    # keep serving the watch list instead of tearing it down.
                    continue
                try:
                    names = json.loads(raw)["signals"]
                except (ValueError, TypeError, KeyError):
                    # A malformed selection must not close a socket the tablet
                    # is using to watch a signal it already asked for.
                    logger.warning("Ignoring an unparseable watch selection")
                    continue
                if isinstance(names, list):
                    state.set_signals(n for n in names if isinstance(n, str))

        send_task = asyncio.create_task(sender())
        recv_task = asyncio.create_task(drain_client())
        try:
            await asyncio.wait({send_task, recv_task},
                               return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in (send_task, recv_task):
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception("Watch socket task failed")
            host.unsubscribe_watch(q)

    if static_dir is not None and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="omt")

    return app
