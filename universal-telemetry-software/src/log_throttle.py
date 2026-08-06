"""A rate limit for log lines emitted on the per-frame path.

CAN frames arrive at bus rate, so a condition that makes one frame fail makes
every frame fail: an unthrottled logger.exception writes a traceback per frame
to journald and the Pi's SD card, which is its own outage. Shared by the base
bridge, the WCARS engine, and the diagnostics service so the three per-frame
paths cannot drift into three different throttling rules.
"""
from __future__ import annotations

import time

DEFAULT_INTERVAL_S = 30.0


class LogThrottle:
    """Allows the first occurrence through, then at most one line per interval."""

    def __init__(self, interval_s: float = DEFAULT_INTERVAL_S, monotonic=time.monotonic) -> None:
        self.interval_s = interval_s
        self._monotonic = monotonic
        self._last_emit: float | None = None
        self._suppressed = 0

    def take(self) -> tuple[bool, bool, int]:
        """Return (emit, is_first, suppressed_since_last_emit)."""
        now = self._monotonic()
        if self._last_emit is None:
            self._last_emit = now
            return True, True, 0
        if now - self._last_emit >= self.interval_s:
            dropped = self._suppressed
            self._suppressed = 0
            self._last_emit = now
            return True, False, dropped
        self._suppressed += 1
        return False, False, 0


def log_throttled_exception(logger, throttle: LogThrottle, message: str, exc: BaseException) -> None:
    """Full traceback for the first occurrence, then a periodic count.

    The traceback is what identifies the bug; repeating it adds nothing but
    bytes, so later lines carry only how many were dropped.
    """
    emit, is_first, dropped = throttle.take()
    if not emit:
        return
    if is_first:
        logger.exception("%s: %s", message, exc)
    else:
        logger.error("%s: %s (%d more suppressed in the last %.0fs)",
                     message, exc, dropped, throttle.interval_s)
