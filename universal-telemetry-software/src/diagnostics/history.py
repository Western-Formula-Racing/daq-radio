"""Durable fault history for the car, so 'did we see this last week too' is
answerable after the tablet has been closed and the car power-cycled.

SQLite in WAL mode: the tablet polling history must never block the writer
draining live alerts, and vice versa. Every failure surfaces as HistoryError
rather than a silent no-op, because a full or read-only SD card is a routine
test-day condition and a fault log that quietly stops recording is worse than
one that says it cannot.

Replay results are deliberately not stored. Replay is stateless and recomputed
in the browser; is_replay exists only so a future change cannot conflate the
two."""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("FaultHistory")

LIVE_RETENTION = 10_000

DEFAULT_QUERY_LIMIT = 200

_SCHEMA = """
CREATE TABLE IF NOT EXISTS fault_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    is_replay  INTEGER NOT NULL DEFAULT 0,
    rule_id    TEXT NOT NULL,
    severity   TEXT NOT NULL,
    title      TEXT NOT NULL,
    detail     TEXT NOT NULL,
    value      REAL,
    ts_ms      INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS freeze_frames (
    fault_event_id INTEGER PRIMARY KEY
        REFERENCES fault_events(id) ON DELETE CASCADE,
    payload_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fault_events_ts ON fault_events(ts_ms);
CREATE INDEX IF NOT EXISTS idx_fault_events_rule ON fault_events(rule_id);
"""

_EVENT_COLUMNS = ("id, is_replay, rule_id, severity, title, detail, value, "
                  "ts_ms, created_at")


class HistoryError(Exception):
    """Anything that stopped the database doing what was asked of it.

    One type for open, read and write: the caller's decision is the same in
    every case, and none of them may be mistaken for success."""


def _now_iso() -> str:
    # Display metadata only. Never used for retention or ordering, because this
    # Pi's clock has run about 59 minutes behind before NTP settles.
    return datetime.now(timezone.utc).isoformat()


class FaultHistory:
    def __init__(self, db_path: Path | str,
                 retention: int = LIVE_RETENTION) -> None:
        """Raises HistoryError if the database could not be opened or created."""
        self.path = Path(db_path)
        self.retention = int(retention)
        # Serializes access so a reader on another thread cannot interleave
        # with the writer's cursor on the one shared connection.
        self._lock = threading.Lock()
        self._con: sqlite3.Connection | None = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            con = sqlite3.connect(str(self.path), check_same_thread=False)
        except (OSError, sqlite3.Error) as exc:
            raise HistoryError(f"could not open {self.path}: {exc}") from exc
        try:
            con.row_factory = sqlite3.Row
            # WAL so the tablet reading history is never blocked by the writer.
            con.execute("PRAGMA journal_mode=WAL")
            # Off by default per connection, and without it ON DELETE CASCADE
            # silently does nothing, so retention would orphan every freeze
            # frame it pruned and the file would grow without bound.
            con.execute("PRAGMA foreign_keys=ON")
            con.executescript(_SCHEMA)
            con.commit()
        except sqlite3.Error as exc:
            con.close()
            raise HistoryError(f"could not initialize {self.path}: {exc}") from exc
        self._con = con

    def record(self, alert, freeze: dict[str, Any] | None = None) -> int:
        """Store one fired alert and its freeze frame; returns the event id.

        Raises HistoryError if the write did not land, so a caller is never told
        a fault was recorded when the card refused it."""
        severity = getattr(alert.severity, "value", alert.severity)
        value = None if alert.value is None else float(alert.value)
        row = (str(alert.rule), str(severity), str(alert.title),
               str(alert.detail), value, int(alert.ts), _now_iso())
        payload = None if freeze is None else json.dumps(freeze)
        with self._lock:
            con = self._require_open()
            try:
                cur = con.execute(
                    "INSERT INTO fault_events (rule_id, severity, title, detail,"
                    " value, ts_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", row)
                event_id = int(cur.lastrowid)
                if payload is not None:
                    con.execute(
                        "INSERT INTO freeze_frames (fault_event_id, payload_json)"
                        " VALUES (?, ?)", (event_id, payload))
                self._prune_live(con)
                con.commit()
            except sqlite3.Error as exc:
                self._rollback(con)
                raise HistoryError(f"could not record fault {alert.rule}: {exc}") from exc
        return event_id

    def query(self, rule_id: str | None = None, severity: str | None = None,
              from_ms: int | None = None, to_ms: int | None = None,
              limit: int = DEFAULT_QUERY_LIMIT) -> list[dict[str, Any]]:
        """The newest `limit` matching events, returned oldest-first.

        The two orderings are deliberately different: the limit has to take the
        newest rows, but a timeline renders ascending, so reversing here saves
        every caller from doing it and getting it wrong."""
        where: list[str] = []
        params: list[Any] = []
        if rule_id is not None:
            where.append("rule_id = ?")
            params.append(str(rule_id))
        if severity is not None:
            where.append("severity = ?")
            params.append(str(getattr(severity, "value", severity)))
        if from_ms is not None:
            where.append("ts_ms >= ?")
            params.append(int(from_ms))
        if to_ms is not None:
            where.append("ts_ms <= ?")
            params.append(int(to_ms))
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        sql = (f"SELECT {_EVENT_COLUMNS} FROM (SELECT {_EVENT_COLUMNS} FROM"
               f" fault_events{clause} ORDER BY ts_ms DESC, id DESC LIMIT ?)"
               " ORDER BY ts_ms ASC, id ASC")
        params.append(max(0, int(limit)))
        with self._lock:
            con = self._require_open()
            try:
                rows = con.execute(sql, params).fetchall()
            except sqlite3.Error as exc:
                raise HistoryError(f"could not read fault history: {exc}") from exc
        return [self._as_event(r) for r in rows]

    def freeze_frame(self, event_id: int) -> dict[str, Any] | None:
        """The stored freeze frame, or None if that event never had one.

        None means absence, not failure: a read that failed raises."""
        with self._lock:
            con = self._require_open()
            try:
                row = con.execute(
                    "SELECT payload_json FROM freeze_frames WHERE fault_event_id = ?",
                    (int(event_id),)).fetchone()
            except sqlite3.Error as exc:
                raise HistoryError(
                    f"could not read the freeze frame for event {event_id}: {exc}") from exc
        if row is None:
            return None
        try:
            return json.loads(row["payload_json"])
        except (ValueError, TypeError) as exc:
            # Corrupt payload is not absence; saying "no freeze frame" here
            # would hide a damaged card behind a plausible answer.
            raise HistoryError(
                f"the freeze frame for event {event_id} is unreadable: {exc}") from exc

    def journal_mode(self) -> str:
        with self._lock:
            con = self._require_open()
            try:
                return str(con.execute("PRAGMA journal_mode").fetchone()[0]).lower()
            except sqlite3.Error as exc:
                raise HistoryError(f"could not read journal_mode: {exc}") from exc

    def foreign_keys_on(self) -> bool:
        with self._lock:
            con = self._require_open()
            try:
                return bool(con.execute("PRAGMA foreign_keys").fetchone()[0])
            except sqlite3.Error as exc:
                raise HistoryError(f"could not read foreign_keys: {exc}") from exc

    def close(self) -> None:
        with self._lock:
            con, self._con = self._con, None
            if con is None:
                return
            try:
                con.close()
            except sqlite3.Error as exc:
                # Already detached from the instance, so there is nothing a
                # caller could retry; a failed close must not mask the work
                # that already committed.
                logger.warning("could not close %s cleanly: %s", self.path, exc)

    def _require_open(self) -> sqlite3.Connection:
        if self._con is None:
            raise HistoryError(f"fault history {self.path} is closed")
        return self._con

    def _prune_live(self, con: sqlite3.Connection) -> None:
        """Keep the newest `retention` rows by id, cascading to freeze frames.

        By id, not ts_ms: insertion order is the only monotonic clock on this
        machine, and a frame timestamped in 1970 must not be able to evict real
        history. The OFFSET subquery yields NULL below the limit, and `id <=
        NULL` matches nothing, so this is a no-op until the table is full."""
        if self.retention <= 0:
            return
        con.execute(
            "DELETE FROM fault_events WHERE id <= (SELECT id FROM fault_events"
            " ORDER BY id DESC LIMIT 1 OFFSET ?)", (self.retention,))

    @staticmethod
    def _rollback(con: sqlite3.Connection) -> None:
        try:
            con.rollback()
        except sqlite3.Error:
            # The original failure is what the caller needs to hear about.
            logger.debug("rollback after a failed history write also failed",
                         exc_info=True)

    @staticmethod
    def _as_event(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "is_replay": bool(row["is_replay"]),
            "rule_id": row["rule_id"],
            "severity": row["severity"],
            "title": row["title"],
            "detail": row["detail"],
            "value": row["value"],
            "ts_ms": int(row["ts_ms"]),
            "created_at": row["created_at"],
        }
