"""
series_queries.py - Density-aware series queries for the /api/series endpoint.

Pure request/SQL logic lives here so it is unit-testable without a database.
execute_series (added in the endpoint task) is the only function that connects.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import psycopg2

RAW_THRESHOLD = int(os.getenv("SERIES_RAW_THRESHOLD", "100000"))
DEFAULT_TARGET_POINTS = int(os.getenv("SERIES_TARGET_POINTS", "4000"))
MAX_TARGET_POINTS = 100_000
MAX_SIGNALS = 12
MAX_WINDOW_DAYS = int(os.getenv("SERIES_MAX_WINDOW_DAYS", "7"))
MAX_TOTAL_POINTS = int(os.getenv("SERIES_MAX_TOTAL_POINTS", "1500000"))
STATEMENT_TIMEOUT_MS = int(os.getenv("SERIES_STATEMENT_TIMEOUT_MS", "15000"))

_TABLE_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
_SIGNAL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,62}$")


def normalize_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def validate_table_name(table: str) -> None:
    if not _TABLE_RE.match(table):
        raise ValueError(f"invalid table name: {table!r}")


def validate_request(
    signals: list[str], start: datetime, end: datetime, target_points: int
) -> None:
    if not signals:
        raise ValueError("at least one signal is required")
    if len(signals) > MAX_SIGNALS:
        raise ValueError(f"at most {MAX_SIGNALS} signals per request")
    for sig in signals:
        if not _SIGNAL_RE.match(sig):
            raise ValueError(f"invalid signal name: {sig!r}")
    if normalize_utc(start) >= normalize_utc(end):
        raise ValueError("start must be before end")
    if normalize_utc(end) - normalize_utc(start) > timedelta(days=MAX_WINDOW_DAYS):
        raise ValueError(f"window exceeds maximum of {MAX_WINDOW_DAYS} days")
    if not (1 <= target_points <= MAX_TARGET_POINTS):
        raise ValueError(f"target_points must be in [1, {MAX_TARGET_POINTS}]")


def bucket_interval(start: datetime, end: datetime, target_points: int) -> str:
    window_s = (normalize_utc(end) - normalize_utc(start)).total_seconds()
    # 1 ms floor: below that, buckets would be finer than any CAN signal rate
    seconds = max(window_s / target_points, 0.001)
    return f"{round(seconds, 3):g} seconds"


def choose_modes(estimates: dict[str, int]) -> dict[str, str]:
    modes = {
        sig: "raw" if n <= RAW_THRESHOLD else "envelope"
        for sig, n in estimates.items()
    }
    raw_total = sum(n for sig, n in estimates.items() if modes[sig] == "raw")
    # Combined raw payload would blow the client point budget: degrade all to envelope
    if raw_total > MAX_TOTAL_POINTS:
        modes = {sig: "envelope" for sig in modes}
    return modes


def build_raw_sql(table: str, signal: str) -> str:
    return (
        f'SELECT time, "{signal}" FROM {table} '
        f"WHERE time >= %(start)s AND time <= %(end)s "
        f'AND "{signal}" IS NOT NULL ORDER BY time'
    )


def build_envelope_sql(table: str, signal: str) -> str:
    return (
        f"SELECT time_bucket(%(bucket)s::interval, time) AS bucket, "
        f'min("{signal}"), max("{signal}"), avg("{signal}") '
        f"FROM {table} "
        f"WHERE time >= %(start)s AND time <= %(end)s "
        f'AND "{signal}" IS NOT NULL '
        f"GROUP BY bucket ORDER BY bucket"
    )


def build_estimate_sql(table: str, signal: str) -> str:
    # Inner LIMIT caps the scan so counting a huge window stays cheap
    return (
        f"SELECT count(*) FROM (SELECT 1 FROM {table} "
        f"WHERE time >= %(start)s AND time <= %(end)s "
        f'AND "{signal}" IS NOT NULL LIMIT %(cap)s) q'
    )


def _get_table_columns(conn, table: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %(t)s",
            {"t": table},
        )
        return {row[0] for row in cur.fetchall()}


def _estimate_rows(conn, table: str, signal: str, start, end) -> int:
    with conn.cursor() as cur:
        cur.execute(
            build_estimate_sql(table, signal),
            {"start": start, "end": end, "cap": RAW_THRESHOLD + 1},
        )
        return int(cur.fetchone()[0])


def execute_series(settings, season, signals, start, end, target_points):
    start = normalize_utc(start)
    end = normalize_utc(end)
    table = season.lower()
    validate_table_name(table)
    validate_request(signals, start, end, target_points)

    conn = psycopg2.connect(
        settings.postgres_dsn,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}",
    )
    try:
        columns = _get_table_columns(conn, table)
        if not columns:
            raise ValueError(f"unknown season table: {table!r}")
        unknown = [s for s in signals if s not in columns]
        if unknown:
            raise ValueError(f"unknown signals for {table}: {unknown}")

        estimates = {
            s: _estimate_rows(conn, table, s, start, end) for s in signals
        }
        modes = choose_modes(estimates)

        series: dict = {}
        params = {"start": start, "end": end}
        for sig in signals:
            with conn.cursor() as cur:
                if modes[sig] == "raw":
                    cur.execute(build_raw_sql(table, sig), params)
                    rows = cur.fetchall()
                    series[sig] = {
                        "mode": "raw",
                        "resolution_ms": None,
                        "point_count": len(rows),
                        "t": [int(ts.timestamp() * 1000) for ts, _ in rows],
                        "v": [float(v) for _, v in rows],
                    }
                else:
                    bucket = bucket_interval(start, end, target_points)
                    cur.execute(
                        build_envelope_sql(table, sig),
                        {**params, "bucket": bucket},
                    )
                    rows = cur.fetchall()
                    res_ms = int(
                        float(bucket.split(" ")[0]) * 1000
                    )
                    series[sig] = {
                        "mode": "envelope",
                        "resolution_ms": res_ms,
                        "point_count": len(rows),
                        "t": [int(b.timestamp() * 1000) for b, *_ in rows],
                        "min": [float(mn) for _, mn, _, _ in rows],
                        "max": [float(mx) for _, _, mx, _ in rows],
                        "avg": [float(av) for _, _, _, av in rows],
                    }
    finally:
        conn.close()

    return {
        "season": table,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "series": series,
    }
