"""EngineHost tests: single-loop alert fan-out, rule hot-swap, and config
persistence. Frames are built dynamically from the loaded DBC so the tests
pass with either secret-dbc or example.dbc."""
import asyncio
import contextlib
import json

import pytest
import websockets

from src.diagnostics.engine_host import EngineHost, SUBSCRIBER_QUEUE_SIZE
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
    assert (tmp_path / "wcars_config.json").exists()


async def test_run_returns_on_shutdown_while_bridge_is_silent(host):
    # Regression for run() abandoning frame_stream() without aclosing: a
    # silent bridge must not prevent shutdown from landing.
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
