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
        """Return (emit, is_first, suppressed_since_last_emit).

        A whole quiet interval with nothing suppressed re-arms the throttle, so
        a transient fault at startup cannot cost every later fault its traceback
        for the rest of the process's life. A genuinely continuous fault always
        has suppressed takes in the gap, so it stays throttled.
        """
        now = self._monotonic()
        if self._last_emit is None or (
                now - self._last_emit >= self.interval_s and self._suppressed == 0):
            self._last_emit = now
            return True, True, 0
        if now - self._last_emit >= self.interval_s:
            dropped = self._suppressed
            self._suppressed = 0
            self._last_emit = now
            return True, False, dropped
        self._suppressed += 1
        return False, False, 0


def suppressed_suffix(dropped: int, interval_s: float) -> str:
    """Clause naming how many lines were dropped, empty when none were.

    '(0 more suppressed)' on a first line reads as though something had already
    been lost, which sends whoever reads the journal hunting for it.
    """
    if dropped <= 0:
        return ""
    return f" ({dropped} more suppressed in the last {interval_s:.0f}s)"


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
        # Without the class name a throttled KeyError('canId') logs as just
        # 'canId', which identifies nothing once the traceback is gone.
        logger.error("%s: %s: %s%s", message, type(exc).__name__, exc,
                     suppressed_suffix(dropped, throttle.interval_s))
