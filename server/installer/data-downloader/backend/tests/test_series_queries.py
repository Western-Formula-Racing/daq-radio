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
