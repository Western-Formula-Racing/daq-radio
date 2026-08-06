"""HTTP contract tests for the OMT API using FastAPI's TestClient. Rule
payloads are built dynamically from the loaded DBC so validation passes with
either secret-dbc or example.dbc."""
import asyncio
import contextlib

import pytest
from fastapi.testclient import TestClient

from src.diagnostics.app import create_app, signal_index
from src.diagnostics.engine_host import EngineHost
from src.diagnostics.rule_store import RuleStore
from src.wcars.decoder import load_db, DBC_PATH


def _any_numeric_signal(db):
    for msg in db.messages:
        if msg.is_multiplexed():
            continue
        for sig in msg.signals:
            if not sig.choices:
                return msg.name, sig.name
    pytest.skip("no numeric signal in this DBC")


@pytest.fixture
def client(tmp_path):
    db = load_db()
    store = RuleStore(tmp_path, db)
    host = EngineHost(tmp_path / "wcars_config.json", store)
    from pathlib import Path
    app = create_app(store, host, Path(DBC_PATH), db)
    return TestClient(app), db


def _payload(db, **overrides):
    msg, sig = _any_numeric_signal(db)
    rule = {
        "name": "API test rule",
        "enabled": True,
        "severity": "MEMO",
        "message": "API TEST",
        "conditions": [{"message": msg, "signal": sig, "op": ">", "value": 1.0}],
        "for_seconds": 0.0,
        "rearm_seconds": 0.0,
    }
    rule.update(overrides)
    return {"rule": rule, "by": "tester"}


def test_create_list_roundtrip(client):
    c, db = client
    created = c.post("/api/rules", json=_payload(db))
    assert created.status_code == 201
    listed = c.get("/api/rules").json()["rules"]
    assert [r["id"] for r in listed] == [created.json()["id"]]


def test_create_invalid_is_422_with_errors(client):
    c, db = client
    resp = c.post("/api/rules", json=_payload(db, severity="FATAL"))
    assert resp.status_code == 422
    assert any("severity" in e for e in resp.json()["detail"])


def test_update_conflict_is_409(client):
    c, db = client
    doc = c.post("/api/rules", json=_payload(db)).json()
    body = _payload(db) | {"expected_rev": doc["rev"]}
    assert c.put(f"/api/rules/{doc['id']}", json=body).status_code == 200
    assert c.put(f"/api/rules/{doc['id']}", json=body).status_code == 409


def test_unknown_rule_is_404(client):
    c, db = client
    body = _payload(db) | {"expected_rev": 1}
    assert c.put("/api/rules/nope", json=body).status_code == 404
    assert c.delete("/api/rules/nope").status_code == 404


def test_toggle_and_delete(client):
    c, db = client
    doc = c.post("/api/rules", json=_payload(db)).json()
    resp = c.post(f"/api/rules/{doc['id']}/toggle",
                  json={"enabled": False, "by": "tester"})
    assert resp.json()["enabled"] is False
    assert c.delete(f"/api/rules/{doc['id']}").status_code == 204
    assert c.get("/api/rules").json()["rules"] == []


def test_signals_index(client):
    c, db = client
    signals = c.get("/api/signals").json()["signals"]
    assert len(signals) == sum(len(m.signals) for m in db.messages)
    assert {"message", "signal", "unit", "minimum", "maximum", "choices"} <= set(signals[0])


def test_dbc_download_matches_file(client):
    c, _ = client
    resp = c.get("/api/dbc")
    assert resp.status_code == 200
    assert "X-DBC-SHA256" in resp.headers
    with open(DBC_PATH, "rb") as f:
        assert resp.content == f.read()


def test_config_roundtrip(client):
    c, _ = client
    cfg = c.get("/api/config").json()
    assert "thresholds" in cfg
    updated = c.put("/api/config", json={"thresholds": {"torch_cell_temp_c": 61.0}})
    assert updated.json()["thresholds"]["torch_cell_temp_c"] == 61.0


def test_ws_alerts_sends_backlog_on_connect(client):
    c, _ = client
    with c.websocket_connect("/ws/alerts") as ws:
        first = ws.receive_json()
        assert first["type"] == "wcars_backlog"


def test_ws_alerts_unsubscribes_on_disconnect(client):
    c, _ = client
    host = c.app.state.host
    with c.websocket_connect("/ws/alerts") as ws:
        assert ws.receive_json()["type"] == "wcars_backlog"
        assert len(host._subscribers) == 1
    assert len(host._subscribers) == 0


def test_ws_alerts_unsubscribes_when_sender_fails(client, monkeypatch):
    """A send that fails on a half-open socket must not leak the subscription."""
    c, _ = client
    host = c.app.state.host

    def boom(_backlog):
        raise RuntimeError("transport went away")

    monkeypatch.setattr("src.diagnostics.app.encode_backlog", boom)
    with contextlib.suppress(Exception):
        with c.websocket_connect("/ws/alerts"):
            # Round-trips the app's event loop so the sender has certainly run
            # and failed before the client disconnects.
            assert c.get("/api/rules").status_code == 200
    assert len(host._subscribers) == 0


def test_ws_alerts_survives_a_binary_frame(client):
    """receive_text raises KeyError, not WebSocketDisconnect, on a binary frame."""
    c, _ = client
    host = c.app.state.host
    with c.websocket_connect("/ws/alerts") as ws:
        assert ws.receive_json()["type"] == "wcars_backlog"
        ws.send_bytes(b"\x00\x01")
        ws.send_text("ping")
        assert c.get("/api/rules").status_code == 200
        assert len(host._subscribers) == 1
    assert len(host._subscribers) == 0


def test_ws_alerts_unsubscribes_when_the_handler_is_cancelled(client):
    """asyncio.wait leaves its futures alone when the wait itself is cancelled,
    so shutdown cancelling the handler must still reach the cleanup."""
    c, _ = client
    host = c.app.state.host
    endpoint = next(r.endpoint for r in c.app.routes
                    if getattr(r, "path", None) == "/ws/alerts")

    class ParkedWebSocket:
        async def accept(self):
            pass

        async def send_json(self, _payload):
            await asyncio.sleep(3600)

        async def receive_text(self):
            await asyncio.sleep(3600)

    async def scenario():
        task = asyncio.create_task(endpoint(ParkedWebSocket()))
        for _ in range(20):
            await asyncio.sleep(0)
        assert len(host._subscribers) == 1
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        assert len(host._subscribers) == 0

    asyncio.run(scenario())


def test_config_with_non_numeric_threshold_is_422(client):
    c, _ = client
    resp = c.put("/api/config", json={"thresholds": {"torch_cell_temp_c": "hot"}})
    assert resp.status_code == 422
    assert any("invalid config value" in e for e in resp.json()["detail"])


@pytest.mark.parametrize("rev", [None, "3", 1.5, True])
def test_update_with_bad_expected_rev_is_422(client, rev):
    c, db = client
    doc = c.post("/api/rules", json=_payload(db)).json()
    body = _payload(db)
    if rev is not None:
        body["expected_rev"] = rev
    resp = c.put(f"/api/rules/{doc['id']}", json=body)
    assert resp.status_code == 422
    assert any("expected_rev" in e for e in resp.json()["detail"])


def test_create_registers_rule_in_engine(client):
    c, db = client
    payload = _payload(db)
    c.post("/api/rules", json=payload)
    app_host = c.app.state.host
    assert any(r.rule_id.startswith("USER:") for r in app_host.engine._rules)
