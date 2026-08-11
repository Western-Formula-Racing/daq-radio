"""Watch-list tests: throttling, extremes, staleness, and the /ws/watch socket.

A threshold rule cannot fire on a signal that never updates, so a dead sensor is
invisible to the rules; the watch list is where staleness surfaces. All timing
here is frame time (ts_ms), never the wall clock, so these tests never sleep to
make something go stale."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.diagnostics.app import create_app
from src.diagnostics.engine_host import EngineHost
from src.diagnostics.rule_store import RuleStore
from src.diagnostics.watch import WatchState
from src.wcars.decoder import DBC_PATH, load_db
from src.wcars.user_rules import STALENESS_MS


def _by_signal(items):
    return {item["signal"]: item for item in items}


def test_watched_signals_are_emitted():
    w = WatchState()
    w.set_signals(["Temp"])
    items = _by_signal(w.offer({"Temp": 41.5}, 1000))
    assert items["Temp"]["value"] == 41.5
    assert items["Temp"]["ts_ms"] == 1000
    assert items["Temp"]["stale"] is False


def test_unwatched_signals_are_ignored():
    w = WatchState()
    w.set_signals(["Temp"])
    assert w.offer({"Volts": 400.0}, 1000) == []


def test_updates_are_throttled_to_max_hz():
    w = WatchState(max_hz=5.0)
    w.set_signals(["Temp"])
    assert w.offer({"Temp": 1.0}, 1000)
    # Inside the 200 ms window: recorded, but not sent again.
    assert w.offer({"Temp": 2.0}, 1100) == []
    assert w.offer({"Temp": 3.0}, 1200)


def test_throttled_update_still_carries_the_newest_value():
    w = WatchState(max_hz=5.0)
    w.set_signals(["Temp"])
    w.offer({"Temp": 1.0}, 1000)
    w.offer({"Temp": 2.0}, 1100)
    items = _by_signal(w.offer({"Temp": 3.0}, 1200))
    assert items["Temp"]["value"] == 3.0


def test_min_and_max_track_the_extremes():
    w = WatchState(max_hz=1000.0)
    w.set_signals(["Temp"])
    for ts, value in ((1000, 20.0), (1001, 45.0), (1002, 5.0), (1003, 30.0)):
        items = _by_signal(w.offer({"Temp": value}, ts))
    assert items["Temp"]["min"] == 5.0
    assert items["Temp"]["max"] == 45.0


def test_string_values_have_no_min_or_max():
    w = WatchState()
    w.set_signals(["State"])
    items = _by_signal(w.offer({"State": "PRECHARGE"}, 1000))
    assert items["State"]["value"] == "PRECHARGE"
    assert items["State"]["min"] is None
    assert items["State"]["max"] is None


def test_changing_the_signal_set_resets_extremes():
    w = WatchState(max_hz=1000.0)
    w.set_signals(["Temp"])
    w.offer({"Temp": 90.0}, 1000)
    w.set_signals(["Temp", "Volts"])
    items = _by_signal(w.offer({"Temp": 20.0}, 1001))
    assert items["Temp"]["min"] == 20.0
    assert items["Temp"]["max"] == 20.0


def test_sweep_reports_a_signal_unseen_past_staleness_as_stale():
    w = WatchState()
    w.set_signals(["Temp"])
    w.offer({"Temp": 41.5}, 1000)
    assert w.sweep(1000 + STALENESS_MS) == []
    items = _by_signal(w.sweep(1001 + STALENESS_MS))
    assert items["Temp"]["stale"] is True
    assert items["Temp"]["ts_ms"] == 1000


def test_sweep_reports_each_signal_stale_only_once():
    w = WatchState()
    w.set_signals(["Temp"])
    w.offer({"Temp": 41.5}, 1000)
    assert w.sweep(20_000)
    assert w.sweep(30_000) == []


def test_a_signal_never_seen_is_reported_stale_once():
    """A sensor dead before the tablet connected is the case that matters most."""
    w = WatchState()
    w.set_signals(["Temp"])
    items = _by_signal(w.sweep(1000))
    assert items["Temp"]["stale"] is True
    assert items["Temp"]["value"] is None
    assert w.sweep(2000) == []


def test_recovery_from_stale_is_emitted_immediately():
    w = WatchState(max_hz=5.0)
    w.set_signals(["Temp"])
    w.offer({"Temp": 41.5}, 1000)
    w.sweep(20_000)
    items = _by_signal(w.offer({"Temp": 42.0}, 20_001))
    assert items["Temp"]["stale"] is False


def test_an_older_sample_never_overwrites_a_newer_one():
    """Out-of-order arrival is routine on the RF link; newest sample wins."""
    w = WatchState(max_hz=1000.0)
    w.set_signals(["Temp"])
    w.offer({"Temp": 41.5}, 2000)
    assert w.offer({"Temp": 10.0}, 1000) == []
    items = _by_signal(w.offer({"Temp": 42.0}, 2001))
    assert items["Temp"]["value"] == 42.0
    assert items["Temp"]["min"] == 41.5


@pytest.fixture
def client(tmp_path):
    db = load_db()
    store = RuleStore(tmp_path, db)
    host = EngineHost(tmp_path / "wcars_config.json", store)
    app = create_app(store, host, Path(DBC_PATH), db)
    return TestClient(app), host


def test_ws_watch_streams_the_requested_signals(client):
    c, host = client
    with c.websocket_connect("/ws/watch") as ws:
        ws.send_json({"signals": ["Temp"]})
        # Round-trips the app's event loop so the set has certainly landed
        # before the frame is fed.
        assert c.get("/api/rules").status_code == 200
        host.publish_signals({"Temp": 41.5, "Volts": 400.0}, 1000)
        # A second round trip wakes the app's loop so the sender has run.
        assert c.get("/api/rules").status_code == 200
        payload = ws.receive_json()
    assert payload["type"] == "wcars_watch"
    assert _by_signal(payload["items"])["Temp"]["value"] == 41.5
    assert "Volts" not in _by_signal(payload["items"])


def test_ws_watch_unsubscribes_on_disconnect(client):
    c, host = client
    with c.websocket_connect("/ws/watch"):
        assert c.get("/api/rules").status_code == 200
        assert len(host._watchers) == 1
    assert len(host._watchers) == 0


def test_ws_watch_survives_a_binary_frame(client):
    """receive_text raises KeyError, not WebSocketDisconnect, on a binary frame."""
    c, host = client
    with c.websocket_connect("/ws/watch") as ws:
        ws.send_bytes(b"\x00\x01")
        ws.send_json({"signals": ["Temp"]})
        assert c.get("/api/rules").status_code == 200
        host.publish_signals({"Temp": 41.5}, 1000)
        assert c.get("/api/rules").status_code == 200
        assert ws.receive_json()["type"] == "wcars_watch"
        assert len(host._watchers) == 1
    assert len(host._watchers) == 0


def test_ws_watch_replaces_the_signal_set(client):
    c, host = client
    with c.websocket_connect("/ws/watch") as ws:
        ws.send_json({"signals": ["Temp"]})
        assert c.get("/api/rules").status_code == 200
        host.publish_signals({"Temp": 41.5}, 1000)
        assert c.get("/api/rules").status_code == 200
        assert _by_signal(ws.receive_json()["items"]).keys() == {"Temp"}
        ws.send_json({"signals": ["Volts"]})
        assert c.get("/api/rules").status_code == 200
        host.publish_signals({"Temp": 42.0, "Volts": 400.0}, 2000)
        assert c.get("/api/rules").status_code == 200
        assert _by_signal(ws.receive_json()["items"]).keys() == {"Volts"}
