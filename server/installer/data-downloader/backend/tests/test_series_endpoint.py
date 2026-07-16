import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp()
os.environ["POSTGRES_DSN"] = "postgresql://test:test@127.0.0.1:1/test"

from fastapi.testclient import TestClient  # noqa: E402

from backend import app as app_module  # noqa: E402
from backend import series_queries as sq  # noqa: E402

client = TestClient(app_module.app)

GOOD_BODY = {
    "season": "wfr25",
    "signals": ["INV_Motor_Temp"],
    "start": "2025-09-09T03:21:08Z",
    "end": "2025-09-09T03:23:38Z",
}


def test_series_returns_executor_result(monkeypatch):
    fake = {"season": "wfr25", "start": "s", "end": "e", "series": {}}
    monkeypatch.setattr(sq, "execute_series", lambda *a, **k: fake)
    resp = client.post("/api/series", json=GOOD_BODY)
    assert resp.status_code == 200
    assert resp.json() == fake


def test_series_validation_error_is_400(monkeypatch):
    def boom(*a, **k):
        raise ValueError("at most 12 signals per request")

    monkeypatch.setattr(sq, "execute_series", boom)
    resp = client.post("/api/series", json=GOOD_BODY)
    assert resp.status_code == 400
    assert "12 signals" in resp.json()["detail"]


def test_series_timeout_is_504(monkeypatch):
    import psycopg2.errors

    def boom(*a, **k):
        raise psycopg2.errors.QueryCanceled()

    monkeypatch.setattr(sq, "execute_series", boom)
    resp = client.post("/api/series", json=GOOD_BODY)
    assert resp.status_code == 504
    assert "narrow" in resp.json()["detail"].lower()


def test_series_db_error_is_503(monkeypatch):
    import psycopg2

    def boom(*a, **k):
        raise psycopg2.OperationalError("connection refused")

    monkeypatch.setattr(sq, "execute_series", boom)
    resp = client.post("/api/series", json=GOOD_BODY)
    assert resp.status_code == 503


def test_series_rejects_malformed_body():
    resp = client.post("/api/series", json={"season": "wfr25"})
    assert resp.status_code == 422


def test_gzip_enabled(monkeypatch):
    fake = {
        "season": "wfr25", "start": "s", "end": "e",
        "series": {"A": {"mode": "raw", "resolution_ms": None,
                         "point_count": 5000,
                         "t": list(range(5000)), "v": [1.0] * 5000}},
    }
    monkeypatch.setattr(sq, "execute_series", lambda *a, **k: fake)
    resp = client.post(
        "/api/series", json=GOOD_BODY, headers={"Accept-Encoding": "gzip"}
    )
    assert resp.headers.get("content-encoding") == "gzip"
