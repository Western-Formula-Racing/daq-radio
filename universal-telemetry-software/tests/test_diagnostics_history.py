"""FaultHistory tests: record/query roundtrip, freeze-frame storage, filters,
retention that cascades to freeze frames, durability across reopen, and honest
failure when the SD card refuses a write."""
import sqlite3

import pytest

from src.diagnostics.history import LIVE_RETENTION, FaultHistory, HistoryError
from src.wcars.serialization import Alert, Severity


def alert(rule="r1", severity=Severity.WARNING, ts=1000, value=41.5,
          title="OVERTEMP", detail="Temp 41.5 C", alert_id="a1"):
    return Alert(id=alert_id, rule=rule, severity=severity, title=title,
                 detail=detail, value=value, ts=ts, replay=False)


@pytest.fixture
def history(tmp_path):
    h = FaultHistory(tmp_path / "diagnostics.db")
    yield h
    h.close()


def test_record_and_query_roundtrip(history):
    history.record(alert())
    rows = history.query()
    assert len(rows) == 1
    row = rows[0]
    assert row["rule_id"] == "r1"
    assert row["severity"] == "WARNING"
    assert row["title"] == "OVERTEMP"
    assert row["detail"] == "Temp 41.5 C"
    assert row["value"] == 41.5
    assert row["ts_ms"] == 1000
    assert row["created_at"]
    assert row["id"] > 0


def test_record_returns_the_event_id(history):
    event_id = history.record(alert())
    assert history.query()[0]["id"] == event_id


def test_is_replay_defaults_to_false(history):
    """Nothing sets it to 1 in this phase; the column exists so a future change
    cannot conflate live faults with recomputed replay results."""
    history.record(alert())
    assert history.query()[0]["is_replay"] is False


def test_freeze_frame_roundtrip(history):
    freeze = {"Temp": [[900, 40.0], [1000, 41.5]]}
    event_id = history.record(alert(), freeze)
    assert history.freeze_frame(event_id) == freeze


def test_an_alert_with_no_freeze_frame_yields_none(history):
    event_id = history.record(alert())
    assert history.freeze_frame(event_id) is None


def test_freeze_frame_of_an_unknown_event_is_none(history):
    assert history.freeze_frame(9999) is None


def test_a_null_value_survives_the_roundtrip(history):
    history.record(alert(value=None))
    assert history.query()[0]["value"] is None


def test_query_filters_by_rule(history):
    history.record(alert(rule="r1", ts=1000))
    history.record(alert(rule="r2", ts=2000))
    assert [r["rule_id"] for r in history.query(rule_id="r2")] == ["r2"]


def test_query_filters_by_severity(history):
    history.record(alert(rule="r1", severity=Severity.WARNING, ts=1000))
    history.record(alert(rule="r2", severity=Severity.MEMO, ts=2000))
    assert [r["rule_id"] for r in history.query(severity="MEMO")] == ["r2"]


def test_query_filters_by_time_window(history):
    for ts in (1000, 2000, 3000):
        history.record(alert(ts=ts))
    kept = [r["ts_ms"] for r in history.query(from_ms=2000, to_ms=3000)]
    assert kept == [2000, 3000]


def test_query_returns_oldest_first_but_limits_to_the_newest(history):
    """A naive ORDER BY id ASC LIMIT n returns the oldest N, the opposite of
    what a fault log should show; the display order must still be ascending so a
    timeline renders without reversing."""
    for ts in (1000, 2000, 3000, 4000, 5000):
        history.record(alert(ts=ts))
    assert [r["ts_ms"] for r in history.query(limit=3)] == [3000, 4000, 5000]


def test_retention_deletes_the_oldest_events(tmp_path):
    h = FaultHistory(tmp_path / "d.db", retention=3)
    try:
        for ts in (1000, 2000, 3000, 4000, 5000):
            h.record(alert(ts=ts))
        assert [r["ts_ms"] for r in h.query()] == [3000, 4000, 5000]
    finally:
        h.close()


def test_retention_deletes_the_freeze_frames_with_their_events(tmp_path):
    """SQLite defaults foreign keys OFF per connection, so without the pragma
    ON DELETE CASCADE silently does nothing and pruning leaves orphan payloads
    that grow the database forever."""
    db_path = tmp_path / "d.db"
    h = FaultHistory(db_path, retention=2)
    try:
        ids = [h.record(alert(ts=ts), {"Temp": [[ts, 1.0]]})
               for ts in (1000, 2000, 3000, 4000)]
        assert h.freeze_frame(ids[0]) is None
        assert h.freeze_frame(ids[1]) is None
        assert h.freeze_frame(ids[3]) is not None
    finally:
        h.close()
    con = sqlite3.connect(db_path)
    try:
        orphans = con.execute(
            "SELECT COUNT(*) FROM freeze_frames WHERE fault_event_id NOT IN "
            "(SELECT id FROM fault_events)").fetchone()[0]
        total = con.execute("SELECT COUNT(*) FROM freeze_frames").fetchone()[0]
    finally:
        con.close()
    assert orphans == 0
    assert total == 2


def test_reopening_the_database_preserves_events(tmp_path):
    db_path = tmp_path / "d.db"
    h = FaultHistory(db_path)
    event_id = h.record(alert(), {"Temp": [[1000, 1.0]]})
    h.close()
    h2 = FaultHistory(db_path)
    try:
        assert [r["ts_ms"] for r in h2.query()] == [1000]
        assert h2.freeze_frame(event_id) == {"Temp": [[1000, 1.0]]}
    finally:
        h2.close()


def test_wal_and_foreign_keys_pragmas_are_on(history):
    assert history.journal_mode() == "wal"
    assert history.foreign_keys_on() is True


def test_live_retention_default_is_ten_thousand():
    assert LIVE_RETENTION == 10_000


class _BrokenConnection:
    """Stands in for a connection on a card that has started refusing I/O."""

    def execute(self, *args, **kwargs):
        raise sqlite3.OperationalError("disk I/O error")

    def rollback(self):
        raise sqlite3.OperationalError("disk I/O error")

    def commit(self):
        raise sqlite3.OperationalError("disk I/O error")


def test_a_write_failure_raises_rather_than_reporting_success(tmp_path):
    """A full or read-only SD card is a routine test-day condition. Failing
    silently would leave the tablet showing a fault log the card never took.

    query_only makes SQLite refuse the write exactly as a read-only card does."""
    h = FaultHistory(tmp_path / "d.db")
    try:
        h._con.execute("PRAGMA query_only=ON")
        with pytest.raises(HistoryError):
            h.record(alert())
        h._con.execute("PRAGMA query_only=OFF")
        # Still usable once the card recovers: the failure must not wedge it.
        assert h.record(alert()) > 0
    finally:
        h.close()


def test_a_write_failure_leaves_no_half_written_event(tmp_path):
    h = FaultHistory(tmp_path / "d.db")
    try:
        h._con.execute("PRAGMA query_only=ON")
        with pytest.raises(HistoryError):
            h.record(alert(), {"Temp": [[1000, 1.0]]})
        h._con.execute("PRAGMA query_only=OFF")
        assert h.query() == []
    finally:
        h.close()


def test_a_read_failure_raises_rather_than_reporting_an_empty_log(tmp_path):
    h = FaultHistory(tmp_path / "d.db")
    try:
        h.record(alert())
        h._con, real = _BrokenConnection(), h._con
        with pytest.raises(HistoryError):
            h.query()
        with pytest.raises(HistoryError):
            h.freeze_frame(1)
        h._con = real
    finally:
        h.close()


def test_opening_an_unusable_path_raises_history_error(tmp_path):
    # A directory where the database file should be: the card is not usable and
    # the caller has to be able to tell.
    (tmp_path / "d.db").mkdir()
    with pytest.raises(HistoryError):
        FaultHistory(tmp_path / "d.db")


def test_close_is_idempotent(tmp_path):
    h = FaultHistory(tmp_path / "d.db")
    h.close()
    h.close()


def test_using_a_closed_history_raises_history_error(tmp_path):
    h = FaultHistory(tmp_path / "d.db")
    h.close()
    with pytest.raises(HistoryError):
        h.record(alert())


def test_a_string_severity_is_accepted_like_the_enum(history):
    """Severity is a str Enum, so the stored value must be the bare name either
    way or a filter on 'WARNING' would never match."""
    history.record(alert(severity="CAUTION"))
    assert history.query()[0]["severity"] == "CAUTION"
    assert len(history.query(severity="CAUTION")) == 1
