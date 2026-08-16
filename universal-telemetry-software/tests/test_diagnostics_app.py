"""HTTP contract tests for the OMT API using FastAPI's TestClient. Rule
payloads are built dynamically from the loaded DBC so validation passes with
either secret-dbc or example.dbc."""
import asyncio
import contextlib

import pytest
from fastapi.testclient import TestClient

from src.diagnostics.app import create_app, parse_allowed_origins, signal_index
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


class TestUnwritableDataDir:
    """A full or read-only SD card is routine on a Pi test day; the tablet must
    be told the store is unavailable rather than shown a bare 500."""

    @staticmethod
    def _break_writes(monkeypatch, store):
        import errno as _errno

        def boom():
            raise OSError(_errno.EROFS, "Read-only file system")
        monkeypatch.setattr(store, "_write", boom)

    @pytest.fixture
    def broken(self, tmp_path, monkeypatch):
        db = load_db()
        store = RuleStore(tmp_path, db)
        host = EngineHost(tmp_path / "wcars_config.json", store)
        from pathlib import Path
        app = create_app(store, host, Path(DBC_PATH), db)
        c = TestClient(app)
        seeded = c.post("/api/rules", json=_payload(db)).json()
        self._break_writes(monkeypatch, store)
        return c, db, seeded, tmp_path

    def test_create_returns_503_naming_the_data_dir(self, broken):
        c, db, _, tmp_path = broken
        r = c.post("/api/rules", json=_payload(db))
        assert r.status_code == 503
        assert str(tmp_path) in str(r.json()["detail"])

    def test_update_returns_503(self, broken):
        c, db, seeded, _ = broken
        payload = _payload(db)
        payload["expected_rev"] = seeded["rev"]
        assert c.put(f"/api/rules/{seeded['id']}", json=payload).status_code == 503

    def test_delete_returns_503(self, broken):
        c, _, seeded, _ = broken
        assert c.delete(f"/api/rules/{seeded['id']}").status_code == 503

    def test_toggle_returns_503(self, broken):
        c, _, seeded, _ = broken
        r = c.post(f"/api/rules/{seeded['id']}/toggle", json={"enabled": False})
        assert r.status_code == 503

    def test_failed_create_is_not_listed(self, broken):
        c, db, seeded, _ = broken
        c.post("/api/rules", json=_payload(db))
        assert [r["id"] for r in c.get("/api/rules").json()["rules"]] == [seeded["id"]]


class TestHistoryRoutes:
    """A read failure must reach the tablet as an error. An empty fault log
    would tell whoever is deciding whether the car is safe that we saw
    nothing."""

    @staticmethod
    def _alert(rule="USER:r1", severity="WARNING", ts=1000, value=41.5):
        from src.wcars.serialization import Alert, Severity
        return Alert(id=f"{rule}-{ts}", rule=rule, severity=Severity(severity),
                     title="OVERTEMP", detail="Temp 41.5 C", value=value,
                     ts=ts, replay=False)

    @pytest.fixture
    def hist_client(self, tmp_path):
        from pathlib import Path
        from src.diagnostics.history import FaultHistory
        db = load_db()
        store = RuleStore(tmp_path, db)
        history = FaultHistory(tmp_path / "diagnostics.db")
        host = EngineHost(tmp_path / "wcars_config.json", store, history=history)
        app = create_app(store, host, Path(DBC_PATH), db, history=history)
        with TestClient(app) as c:
            yield c, history
        history.close()

    def test_history_returns_recorded_faults(self, hist_client):
        c, history = hist_client
        history.record(self._alert(), {"Temp": [[900, 41.5]]})
        events = c.get("/api/history").json()["events"]
        assert [e["rule_id"] for e in events] == ["USER:r1"]
        assert events[0]["severity"] == "WARNING"

    def test_history_filters_are_applied(self, hist_client):
        c, history = hist_client
        history.record(self._alert(rule="USER:a", ts=1000))
        history.record(self._alert(rule="USER:b", severity="MEMO", ts=5000))
        by_rule = c.get("/api/history", params={"rule_id": "USER:b"}).json()["events"]
        assert [e["rule_id"] for e in by_rule] == ["USER:b"]
        by_sev = c.get("/api/history", params={"severity": "MEMO"}).json()["events"]
        assert [e["rule_id"] for e in by_sev] == ["USER:b"]
        windowed = c.get("/api/history",
                         params={"from_ms": 2000, "to_ms": 9000}).json()["events"]
        assert [e["ts_ms"] for e in windowed] == [5000]
        assert len(c.get("/api/history", params={"limit": 1}).json()["events"]) == 1

    def test_freeze_route_returns_the_payload(self, hist_client):
        c, history = hist_client
        event_id = history.record(self._alert(), {"Temp": [[900, 41.5]]})
        body = c.get(f"/api/freeze/{event_id}").json()
        assert body["event_id"] == event_id
        assert body["freeze"] == {"Temp": [[900, 41.5]]}

    def test_unknown_event_id_is_404(self, hist_client):
        c, _ = hist_client
        assert c.get("/api/freeze/424242").status_code == 404

    def test_history_read_failure_is_503_not_an_empty_log(self, hist_client):
        c, history = hist_client
        history.record(self._alert())
        history.close()
        resp = c.get("/api/history")
        assert resp.status_code == 503
        assert "history" in str(resp.json()["detail"]).lower()

    def test_freeze_read_failure_is_503(self, hist_client):
        c, history = hist_client
        event_id = history.record(self._alert(), {"Temp": [[900, 41.5]]})
        history.close()
        assert c.get(f"/api/freeze/{event_id}").status_code == 503


class TestHistoryNotConfigured:
    """A Phase A deployment with no database must say so plainly rather than
    reporting an empty fault log."""

    def test_history_is_503_without_a_database(self, client):
        c, _ = client
        resp = c.get("/api/history")
        assert resp.status_code == 503
        assert "not configured" in str(resp.json()["detail"]).lower()

    def test_freeze_is_503_without_a_database(self, client):
        c, _ = client
        assert c.get("/api/freeze/1").status_code == 503


class TestBrowserOrigins:
    """PECAN fetches the car's rules to replay a log, which is a cross-origin
    call. Without the right header a browser refuses it and the user is told
    only "Load failed", which reads as the car being unreachable."""

    def _app(self, tmp_path, origins):
        from pathlib import Path
        db = load_db()
        store = RuleStore(tmp_path, db)
        host = EngineHost(tmp_path / "wcars_config.json", store)
        return TestClient(create_app(store, host, Path(DBC_PATH), db,
                                     allowed_origins=origins))

    def test_a_configured_origin_may_read_the_rules(self, tmp_path):
        c = self._app(tmp_path, ["http://pecan.local:5173"])
        resp = c.get("/api/rules", headers={"Origin": "http://pecan.local:5173"})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://pecan.local:5173"

    def test_an_unlisted_origin_gets_no_grant(self, tmp_path):
        c = self._app(tmp_path, ["http://pecan.local:5173"])
        resp = c.get("/api/rules", headers={"Origin": "http://evil.example"})
        assert "access-control-allow-origin" not in resp.headers

    def test_the_default_grants_nothing(self, tmp_path):
        # The service has no auth, so a page a team member opened while on the
        # car's hotspot must not be able to rewrite the fault rules by default.
        c = self._app(tmp_path, None)
        resp = c.get("/api/rules", headers={"Origin": "http://pecan.local:5173"})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers

    def test_a_write_from_a_configured_origin_is_preflighted(self, tmp_path):
        c = self._app(tmp_path, ["http://pecan.local:5173"])
        resp = c.options("/api/rules", headers={
            "Origin": "http://pecan.local:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert resp.status_code == 200
        assert "POST" in resp.headers["access-control-allow-methods"]


class TestParseAllowedOrigins:
    def test_splits_and_trims_a_comma_separated_list(self):
        assert parse_allowed_origins("http://a.local , http://b.local") == [
            "http://a.local", "http://b.local"]

    def test_unset_or_empty_means_no_origins(self):
        assert parse_allowed_origins(None) == []
        assert parse_allowed_origins("") == []
        assert parse_allowed_origins("  ,  ") == []
