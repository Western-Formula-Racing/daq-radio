"""Per-signal watch list for the tablet: latest value, extremes, and staleness.

This exists because a threshold rule cannot fire on a signal that never updates.
A dead sensor is invisible to the rules, so staleness has to surface somewhere,
and sweep() is that somewhere.

All timing is frame time (ts_ms), never the wall clock: the Pi's clock has run
about 59 minutes behind before NTP settles, and a watch list that called a live
signal stale because of that would send the team hunting a healthy sensor."""
from __future__ import annotations

from typing import Any, Iterable

from ..wcars.user_rules import STALENESS_MS

WATCH_MAX_HZ = 5.0


class _Entry:
    __slots__ = ("value", "ts_ms", "min", "max", "stale", "last_emit_ms")

    def __init__(self) -> None:
        self.value: Any = None
        self.ts_ms: int | None = None
        self.min: float | None = None
        self.max: float | None = None
        self.stale = False
        self.last_emit_ms: int | None = None


def _numeric(value: Any) -> bool:
    # bool is an int in Python, but a min and max over an on/off flag is noise.
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class WatchState:
    """Tracks the watched signals for one tablet connection.

    Not shared between connections: two tablets watching different signals must
    not see each other's extremes."""

    def __init__(self, max_hz: float = WATCH_MAX_HZ) -> None:
        self._min_gap_ms = 1000.0 / max_hz if max_hz > 0 else 0.0
        self._entries: dict[str, _Entry] = {}

    def set_signals(self, names: Iterable[str]) -> None:
        """Replace the watched set, dropping all accumulated state.

        A new selection is a new question: carrying extremes over would show a
        min the operator never asked to see and cannot date."""
        self._entries = {str(n): _Entry() for n in names}

    def signals(self) -> set[str]:
        return set(self._entries)

    def offer(self, signals: dict[str, Any], ts_ms: int) -> list[dict]:
        """Record one decoded frame; returns the items worth sending now."""
        out = []
        for name, value in signals.items():
            entry = self._entries.get(name)
            if entry is None:
                continue
            # Out-of-order arrival is routine on the RF link, and a late frame
            # carrying an older reading must not become the latest value.
            if entry.ts_ms is not None and ts_ms < entry.ts_ms:
                continue
            entry.value = value
            entry.ts_ms = ts_ms
            if _numeric(value):
                entry.min = value if entry.min is None else min(entry.min, value)
                entry.max = value if entry.max is None else max(entry.max, value)
            recovered = entry.stale
            entry.stale = False
            # Recovery is a state change the tablet must see at once; only the
            # ordinary value stream is worth throttling.
            if recovered or self._due(entry, ts_ms):
                entry.last_emit_ms = ts_ms
                out.append(self._item(name, entry))
        return out

    def sweep(self, ts_ms: int) -> list[dict]:
        """Items that just went stale, at most one per signal per stale period."""
        out = []
        for name, entry in self._entries.items():
            if entry.stale:
                continue
            # A signal never seen at all is the worst case, not an exempt one:
            # a sensor already dead when the tablet connected would otherwise
            # sit blank forever with nothing saying why.
            if entry.ts_ms is not None and ts_ms - entry.ts_ms <= STALENESS_MS:
                continue
            entry.stale = True
            out.append(self._item(name, entry))
        return out

    def _due(self, entry: _Entry, ts_ms: int) -> bool:
        if entry.last_emit_ms is None or not self._min_gap_ms:
            return True
        return ts_ms - entry.last_emit_ms >= self._min_gap_ms

    @staticmethod
    def _item(name: str, entry: _Entry) -> dict:
        return {
            "signal": name,
            "value": entry.value,
            "ts_ms": entry.ts_ms,
            "min": entry.min,
            "max": entry.max,
            "stale": entry.stale,
        }
