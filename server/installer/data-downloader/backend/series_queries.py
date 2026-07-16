from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from typing import Literal


RAW_THRESHOLD = 100_000
DEFAULT_TARGET_POINTS = 4_000
MAX_TARGET_POINTS = 20_000
MAX_SIGNALS = 12
MAX_WINDOW_DAYS = 7
MAX_TOTAL_POINTS = 1_500_000
STATEMENT_TIMEOUT_MS = 15_000

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def normalize_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def validate_request(
    signals: list[str],
    start: datetime,
    end: datetime,
    target_points: int,
) -> None:
    start_utc = normalize_utc(start)
    end_utc = normalize_utc(end)
    if not signals or len(signals) > MAX_SIGNALS:
        raise ValueError(f"select between 1 and {MAX_SIGNALS} signals")
    if len(set(signals)) != len(signals):
        raise ValueError("signal names must be unique")
    if any(not _IDENTIFIER.fullmatch(signal) for signal in signals):
        raise ValueError("invalid signal name")
    if start_utc >= end_utc:
        raise ValueError("start must be before end")
    if end_utc - start_utc > timedelta(days=MAX_WINDOW_DAYS):
        raise ValueError("window cannot exceed seven days")
    if not 1 <= target_points <= MAX_TARGET_POINTS:
        raise ValueError(f"target_points must be between 1 and {MAX_TARGET_POINTS}")


def bucket_interval(start: datetime, end: datetime, target_points: int) -> str:
    total_ms = int((normalize_utc(end) - normalize_utc(start)).total_seconds() * 1000)
    return f"{max(1, (total_ms + target_points - 1) // target_points)} milliseconds"


def choose_mode(estimate: int) -> Literal["raw", "envelope"]:
    return "raw" if estimate <= RAW_THRESHOLD else "envelope"


def _quoted(signal: str) -> str:
    if not _IDENTIFIER.fullmatch(signal):
        raise ValueError("invalid signal name")
    return f'"{signal}"'


def _table(table: str) -> str:
    if not re.fullmatch(r"[a-z][a-z0-9_]*", table):
        raise ValueError("invalid season table")
    return table


def build_estimate_sql(table: str, signal: str) -> str:
    column = _quoted(signal)
    return (
        "SELECT COUNT(*) FROM ("
        f"SELECT 1 FROM {_table(table)} "
        "WHERE time >= %(start)s AND time <= %(end)s "
        f"AND {column} IS NOT NULL LIMIT {RAW_THRESHOLD + 1}"
        ") AS bounded_count"
    )


def build_raw_sql(table: str, signal: str) -> str:
    column = _quoted(signal)
    return (
        f"SELECT time, {column} FROM {_table(table)} "
        "WHERE time >= %(start)s AND time <= %(end)s "
        f"AND {column} IS NOT NULL ORDER BY time"
    )


def build_envelope_sql(table: str, signal: str) -> str:
    column = _quoted(signal)
    return (
        "SELECT time_bucket(%(bucket)s::interval, time) AS bucket, "
        f"MIN({column}), MAX({column}), AVG({column}) "
        f"FROM {_table(table)} "
        "WHERE time >= %(start)s AND time <= %(end)s "
        f"AND {column} IS NOT NULL "
        "GROUP BY bucket ORDER BY bucket"
    )


def response_estimate(
    mode: Literal["raw", "envelope"],
    raw_estimate: int,
    target_points: int,
) -> int:
    return raw_estimate if mode == "raw" else target_points
