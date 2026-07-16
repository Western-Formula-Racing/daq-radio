from datetime import datetime, timedelta, timezone

import pytest

from backend import series_queries as sq


UTC = timezone.utc
T0 = datetime(2025, 9, 9, 3, 21, 8, tzinfo=UTC)


class TestValidateTableName:
    def test_accepts_season_table(self):
        sq.validate_table_name("wfr26")

    def test_rejects_uppercase_and_injection(self):
        with pytest.raises(ValueError):
            sq.validate_table_name("wfr26; DROP TABLE wfr26")
        with pytest.raises(ValueError):
            sq.validate_table_name('wfr26"')


class TestValidateRequest:
    def test_accepts_normal_request(self):
        sq.validate_request(["Max_Temp"], T0, T0 + timedelta(minutes=5), 4000)

    def test_rejects_empty_signals(self):
        with pytest.raises(ValueError, match="signal"):
            sq.validate_request([], T0, T0 + timedelta(minutes=5), 4000)

    def test_rejects_too_many_signals(self):
        signals = [f"Sig_{i}" for i in range(sq.MAX_SIGNALS + 1)]
        with pytest.raises(ValueError, match="signal"):
            sq.validate_request(signals, T0, T0 + timedelta(minutes=5), 4000)

    def test_rejects_bad_signal_name(self):
        with pytest.raises(ValueError, match="signal"):
            sq.validate_request(['Max"; DROP--'], T0, T0 + timedelta(minutes=5), 4000)

    def test_rejects_start_after_end(self):
        with pytest.raises(ValueError, match="start"):
            sq.validate_request(["Max_Temp"], T0, T0, 4000)

    def test_rejects_window_over_max(self):
        end = T0 + timedelta(days=sq.MAX_WINDOW_DAYS, seconds=1)
        with pytest.raises(ValueError, match="window"):
            sq.validate_request(["Max_Temp"], T0, end, 4000)

    def test_rejects_bad_target_points(self):
        with pytest.raises(ValueError, match="target_points"):
            sq.validate_request(["Max_Temp"], T0, T0 + timedelta(minutes=5), 0)
        with pytest.raises(ValueError, match="target_points"):
            sq.validate_request(["Max_Temp"], T0, T0 + timedelta(minutes=5), 100_001)


class TestBucketInterval:
    def test_five_minutes_at_4000_points(self):
        # 300 s / 4000 = 0.075 s buckets
        assert sq.bucket_interval(T0, T0 + timedelta(minutes=5), 4000) == "0.075 seconds"

    def test_one_day_at_4000_points(self):
        assert sq.bucket_interval(T0, T0 + timedelta(days=1), 4000) == "21.6 seconds"

    def test_floors_at_one_millisecond(self):
        assert sq.bucket_interval(T0, T0 + timedelta(seconds=1), 100_000) == "0.001 seconds"


class TestChooseModes:
    def test_all_raw_when_under_threshold(self):
        modes = sq.choose_modes({"A": 30_000, "B": 50_000})
        assert modes == {"A": "raw", "B": "raw"}

    def test_envelope_when_over_threshold(self):
        modes = sq.choose_modes({"A": sq.RAW_THRESHOLD + 1})
        assert modes["A"] == "envelope"

    def test_forces_envelope_when_total_exceeds_budget(self):
        # 20 signals x 90k raw points = 1.8M > MAX_TOTAL_POINTS: all forced to envelope
        estimates = {f"S{i}": 90_000 for i in range(20)}
        modes = sq.choose_modes(estimates)
        assert all(m == "envelope" for m in modes.values())


class TestSqlBuilders:
    def test_raw_sql_quotes_signal_and_filters_null(self):
        sql = sq.build_raw_sql("wfr25", "INV_Motor_Temp")
        assert '"INV_Motor_Temp"' in sql
        assert '"INV_Motor_Temp" IS NOT NULL' in sql
        assert "%(start)s" in sql and "%(end)s" in sql
        assert "ORDER BY time" in sql
        assert "*" not in sql

    def test_envelope_sql_has_bucket_and_aggregates(self):
        sql = sq.build_envelope_sql("wfr25", "INV_Motor_Temp")
        assert "time_bucket(%(bucket)s::interval, time)" in sql
        assert 'min("INV_Motor_Temp")' in sql
        assert 'max("INV_Motor_Temp")' in sql
        assert 'avg("INV_Motor_Temp")' in sql
        assert "GROUP BY" in sql

    def test_estimate_sql_is_bounded(self):
        sql = sq.build_estimate_sql("wfr25", "INV_Motor_Temp")
        assert "LIMIT %(cap)s" in sql
        assert '"INV_Motor_Temp" IS NOT NULL' in sql
