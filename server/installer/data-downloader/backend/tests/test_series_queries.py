from datetime import datetime, timedelta, timezone

import pytest

from backend import series_queries as sq


UTC = timezone.utc
T0 = datetime(2026, 6, 20, 15, 0, tzinfo=UTC)


def test_validate_request_accepts_normal_request():
    sq.validate_request(["INV_Motor_Temp"], T0, T0 + timedelta(hours=1), 4000)


@pytest.mark.parametrize(
    ("signals", "start", "end", "target", "match"),
    [
        ([], T0, T0 + timedelta(hours=1), 4000, "signal"),
        ([f"S{i}" for i in range(13)], T0, T0 + timedelta(hours=1), 4000, "signal"),
        (["bad\"name"], T0, T0 + timedelta(hours=1), 4000, "signal"),
        (["A"], T0, T0, 4000, "start"),
        (["A"], T0, T0 + timedelta(days=8), 4000, "seven"),
        (["A"], T0, T0 + timedelta(hours=1), 0, "target"),
        (["A"], T0, T0 + timedelta(hours=1), 20_001, "target"),
    ],
)
def test_validate_request_rejects_invalid_values(signals, start, end, target, match):
    with pytest.raises(ValueError, match=match):
        sq.validate_request(signals, start, end, target)


def test_bucket_interval_uses_integer_milliseconds():
    value = sq.bucket_interval(T0, T0 + timedelta(seconds=10_000), 4000)
    assert value == "2500 milliseconds"


def test_choose_mode_uses_raw_threshold():
    assert sq.choose_mode(100_000) == "raw"
    assert sq.choose_mode(100_001) == "envelope"


def test_sql_quotes_signal_and_bounds_time():
    for sql in (
        sq.build_estimate_sql("wfr26", "INV_Motor_Temp"),
        sq.build_raw_sql("wfr26", "INV_Motor_Temp"),
        sq.build_envelope_sql("wfr26", "INV_Motor_Temp"),
    ):
        assert '"INV_Motor_Temp"' in sql
        assert "%(start)s" in sql
        assert "%(end)s" in sql
        assert '"INV_Motor_Temp" IS NOT NULL' in sql
        assert "SELECT *" not in sql.upper()


def test_envelope_sql_uses_time_bucket_and_aggregates():
    sql = sq.build_envelope_sql("wfr26", "INV_Motor_Temp")
    assert "time_bucket" in sql
    assert 'MIN("INV_Motor_Temp")' in sql
    assert 'MAX("INV_Motor_Temp")' in sql
    assert 'AVG("INV_Motor_Temp")' in sql


def test_response_estimate_uses_target_for_envelope():
    assert sq.response_estimate("raw", 120, 4000) == 120
    assert sq.response_estimate("envelope", 100_001, 4000) == 4000


class FakeCursor:
    def __init__(self, estimate, rows):
        self.estimate = estimate
        self.rows = rows
        self.executed = []
        self.last_sql = ""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, sql, params=None):
        self.last_sql = sql
        self.executed.append((sql, params))

    def fetchone(self):
        return (self.estimate,)

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def cursor(self):
        return self._cursor


def test_execute_series_query_sets_statement_timeout(monkeypatch):
    cursor = FakeCursor(1, [(T0, 47.2)])
    monkeypatch.setattr(
        sq.psycopg2,
        "connect",
        lambda _dsn: FakeConnection(cursor),
    )
    result = sq.execute_series_query(
        postgres_dsn="unused",
        table="wfr26",
        signals=["INV_Motor_Temp"],
        start=T0,
        end=T0 + timedelta(seconds=10),
        target_points=4000,
    )
    assert cursor.executed[0][0] == "SET LOCAL statement_timeout = 15000"
    assert result["INV_Motor_Temp"]["mode"] == "raw"
    assert result["INV_Motor_Temp"]["v"] == [47.2]


def test_execute_series_query_shapes_envelope(monkeypatch):
    cursor = FakeCursor(100_001, [(T0, 1.0, 3.0, 2.0)])
    monkeypatch.setattr(
        sq.psycopg2,
        "connect",
        lambda _dsn: FakeConnection(cursor),
    )
    result = sq.execute_series_query(
        postgres_dsn="unused",
        table="wfr26",
        signals=["INV_Motor_Temp"],
        start=T0,
        end=T0 + timedelta(seconds=10_000),
        target_points=4000,
    )
    series = result["INV_Motor_Temp"]
    assert series["mode"] == "envelope"
    assert series["resolution_ms"] == 2500
    assert series["min"] == [1.0]
    assert series["max"] == [3.0]
    assert series["avg"] == [2.0]
