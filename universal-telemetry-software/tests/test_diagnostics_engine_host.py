"""EngineHost tests: single-loop alert fan-out, rule hot-swap, and config
persistence. Frames are built dynamically from the loaded DBC so the tests
pass with either secret-dbc or example.dbc."""
import asyncio
import json

import pytest
import websockets

from src.diagnostics.engine_host import (
    HISTORY_QUEUE_SIZE, SUBSCRIBER_QUEUE_SIZE, EngineHost,
)
from src.diagnostics.history import HistoryError
from src.diagnostics.rule_store import RuleStore
from src.wcars.decoder import load_db
from src.wcars.serialization import Alert, Severity
from tests.wcars_dbc_utils import encodable_user_signal as _encodable_user_signal


def _draft(msg, sig, value):
    return {
        "name": "Host test rule",
        "enabled": True,
        "severity": "CAUTION",
        "message": "HOST TEST",
        "conditions": [
            {"message": msg.name, "signal": sig.name, "op": ">=", "value": value - 1.0},
        ],
        "for_seconds": 0.0,
        "rearm_seconds": 0.0,
    }


@pytest.fixture
def host(tmp_path):
    store = RuleStore(tmp_path, load_db())
    return EngineHost(tmp_path / "wcars_config.json", store), store


async def test_feed_fans_out_to_subscribers(host):
    h, store = host
    msg, sig, payload, value = _encodable_user_signal()
    store.create(_draft(msg, sig, value), by="t")
    h.rules_changed()
    q = h.subscribe()
    alerts = h.feed({"canId": msg.frame_id & 0x7FFFFFFF, "data": payload}, 1000)
    assert len(alerts) == 1
    assert q.get_nowait() is alerts[0]


async def test_full_subscriber_dropped_not_blocking(host):
    h, _ = host
    q = h.subscribe()
    fake = Alert(id="x", rule="USER:t", severity=Severity.MEMO, title="T",
                 detail="d", value=None, ts=1, replay=False)
    for _ in range(SUBSCRIBER_QUEUE_SIZE + 5):
        h.publish(fake)
    assert q.qsize() == SUBSCRIBER_QUEUE_SIZE


async def test_unsubscribe_stops_delivery(host):
    h, _ = host
    q = h.subscribe()
    h.unsubscribe(q)
    fake = Alert(id="x", rule="USER:t", severity=Severity.MEMO, title="T",
                 detail="d", value=None, ts=1, replay=False)
    h.publish(fake)
    assert q.qsize() == 0


async def test_apply_config_persists(host, tmp_path):
    h, _ = host
    cfg = h.apply_config({"thresholds": {"torch_cell_temp_c": 60.0}})
    assert cfg["thresholds"]["torch_cell_temp_c"] == 60.0
    on_disk = json.loads((tmp_path / "wcars_config.json").read_text())
    assert on_disk["thresholds"]["torch_cell_temp_c"] == 60.0


async def test_run_returns_on_shutdown_while_bridge_is_silent(host):
    # A silent bridge must not prevent shutdown from landing.
    h, _ = host
    server_hold = asyncio.Event()

    async def handler(ws):
        await server_hold.wait()

    shutdown = asyncio.Event()
    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        task = asyncio.create_task(h.run(f"ws://127.0.0.1:{port}", shutdown))
        await asyncio.sleep(0.15)  # let the client connect and park on recv
        shutdown.set()
        try:
            await asyncio.wait_for(task, timeout=0.5)
        finally:
            server_hold.set()


class _Bail(BaseException):
    """Not an Exception subclass, so run()'s `except Exception` cannot swallow it."""


async def test_run_aclosing_closes_socket_when_loop_exits_abnormally(host):
    # Regression for run() abandoning frame_stream() without aclosing: when
    # the loop body raises something except Exception won't catch, the
    # generator is left parked at its yield with the socket still open unless
    # something forces its cleanup. aclosing forces frame_stream's finally
    # blocks (and the websocket close) to run synchronously as run() unwinds,
    # instead of waiting on the asyncgen finalizer/GC to get around to it.
    h, _ = host
    closed_event = asyncio.Event()

    async def handler(ws):
        await ws.send(json.dumps([{"canId": 1, "data": [0], "time": 1000}]))
        await ws.wait_closed()
        closed_event.set()

    def boom(frame, ts_ms):
        raise _Bail("engine feed blew up mid-stream")

    h.feed = boom

    shutdown = asyncio.Event()
    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        task = asyncio.create_task(h.run(f"ws://127.0.0.1:{port}", shutdown))
        with pytest.raises(_Bail):
            await asyncio.wait_for(task, timeout=0.5)
        # Checked with no intervening await: aclosing's __aexit__ drives the
        # close handshake to completion inside run()'s own call stack, so by
        # the time the task is done the server has already observed the
        # close. An abandoned generator instead relies on the asyncgen
        # finalizer, which is only scheduled via call_soon for a later tick,
        # so it would not have run yet at this exact point.
        assert closed_event.is_set()


async def test_run_loop_feed_error_logged_once_not_per_frame(host, caplog, monkeypatch):
    """A feed that fails on every frame must not fill the SD card with tracebacks."""
    h, _ = host

    async def fake_stream(url, shutdown):
        for i in range(200):
            yield {"canId": 1, "data": [0] * 8}, 1000 + i

    monkeypatch.setattr("src.diagnostics.engine_host.frame_stream", fake_stream)

    def boom(frame, ts_ms):
        raise RuntimeError("engine down")

    h.engine.feed = boom
    with caplog.at_level("ERROR", logger="diagnostics.engine"):
        await h.run("ws://unused", asyncio.Event())

    records = [r for r in caplog.records if r.name == "diagnostics.engine"]
    assert len(records) == 1
    assert records[0].exc_info is not None


class _FakeHistory:
    """Stands in for FaultHistory: records rows, or refuses like a full card."""

    def __init__(self, fail: bool = False) -> None:
        self.rows: list[tuple] = []
        self.fail = fail

    def record(self, alert, freeze=None) -> int:
        if self.fail:
            raise HistoryError("read-only file system")
        self.rows.append((alert, freeze))
        return len(self.rows)


def _armed_host(tmp_path, history):
    """Host whose single user rule fires on every frame of one message."""
    store = RuleStore(tmp_path, load_db())
    h = EngineHost(tmp_path / "wcars_config.json", store, history=history)
    msg, sig, payload, value = _encodable_user_signal()
    store.create(_draft(msg, sig, value), by="t")
    h.rules_changed()
    frame = {"canId": msg.frame_id & 0x7FFFFFFF, "data": payload}
    return h, frame, (sig.name, value)


async def test_fired_alert_reaches_history_with_its_freeze_frame(tmp_path):
    hist = _FakeHistory()
    h, frame, (signal_name, value) = _armed_host(tmp_path, hist)
    h.feed(frame, 1000)
    assert h.drain_history() == 1
    alert, freeze = hist.rows[0]
    assert alert.rule.startswith("USER:")
    assert freeze[signal_name] == [[1000, value]]


async def test_history_write_is_queued_not_inline(tmp_path):
    """A sick SD card must not be on the frame feed's critical path."""
    hist = _FakeHistory()
    h, frame, _sig = _armed_host(tmp_path, hist)
    h.feed(frame, 1000)
    assert hist.rows == []


async def test_history_write_failure_does_not_break_the_feed(tmp_path, caplog):
    hist = _FakeHistory(fail=True)
    h, frame, (signal_name, _value) = _armed_host(tmp_path, hist)
    q = h.subscribe()
    with caplog.at_level("ERROR", logger="diagnostics.engine"):
        alerts = h.feed(frame, 1000)
        # The failed write is reported, not raised, and it is reported off the
        # frame path.
        assert h.drain_history() == 0
        h.feed(frame, 2000)
    # The alert the tablet needs went out over /ws/alerts regardless, and the
    # feed carried on observing frames after the write failed.
    assert q.get_nowait() is alerts[0]
    assert h.freeze.snapshot()[signal_name][-1][0] == 2000
    assert any("history" in r.message.lower() for r in caplog.records)


async def test_history_queue_full_drops_rather_than_blocking(tmp_path, caplog):
    hist = _FakeHistory()
    h, frame, _sig = _armed_host(tmp_path, hist)
    fake = Alert(id="x", rule="USER:t", severity=Severity.MEMO, title="T",
                 detail="d", value=None, ts=1, replay=False)
    h.engine.feed = lambda _frame, _ts: [fake]
    with caplog.at_level("WARNING", logger="diagnostics.engine"):
        for i in range(HISTORY_QUEUE_SIZE + 5):
            h.feed(frame, 1000 + i)
    assert h.drain_history() == HISTORY_QUEUE_SIZE
    assert any("drop" in r.message.lower() for r in caplog.records)


async def test_host_without_history_still_feeds(tmp_path):
    h, frame, _sig = _armed_host(tmp_path, None)
    q = h.subscribe()
    assert len(h.feed(frame, 1000)) == 1
    assert q.qsize() == 1
    assert h.drain_history() == 0


async def test_history_writer_drains_until_shutdown(tmp_path):
    hist = _FakeHistory()
    h, frame, _sig = _armed_host(tmp_path, hist)
    shutdown = asyncio.Event()
    task = asyncio.create_task(h.run_history_writer(shutdown))
    h.feed(frame, 1000)
    for _ in range(30):
        await asyncio.sleep(0.05)
        if hist.rows:
            break
    assert len(hist.rows) == 1
    # Queued in the last moment before shutdown: the writer must flush what it
    # already has rather than losing it on the way out. The rule latches after
    # its first alert, so a second one is injected rather than provoked.
    fake = Alert(id="x", rule="USER:t", severity=Severity.MEMO, title="T",
                 detail="d", value=None, ts=2000, replay=False)
    h.engine.feed = lambda _frame, _ts: [fake]
    h.feed(frame, 2000)
    shutdown.set()
    await asyncio.wait_for(task, timeout=2.0)
    assert len(hist.rows) == 2
