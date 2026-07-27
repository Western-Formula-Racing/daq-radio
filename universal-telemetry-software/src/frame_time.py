"""Validation for the per-frame epoch-ms 'time' field data.py publishes.

Shared by the base bridge's engine feed and the car diagnostics service so
the two ingestion paths can never disagree about what a usable timestamp is.
"""


def is_valid_frame_ts(ts_ms) -> bool:
    """True only for a genuine positive-integer epoch-ms timestamp (bool is not an int here)."""
    return isinstance(ts_ms, int) and not isinstance(ts_ms, bool) and ts_ms > 0
