"""Rolling per-signal buffer snapshotted when a rule fires on the car.

Bounded by construction: the tracked set comes from the loaded rules and each
signal keeps at most window_ms x max_hz samples, so a whole test day cannot grow
it. All timing is frame time, never the wall clock.

The browser replay path does not need this: it has every frame in memory and
queries a window after the fact."""
from __future__ import annotations

from collections import deque
from typing import Any, Iterable

from ..wcars.decoder import load_db

FREEZE_WINDOW_MS = 10_000
FREEZE_MAX_HZ = 20.0


class FreezeBuffer:
    def __init__(self, window_ms: int = FREEZE_WINDOW_MS,
                 max_hz: float = FREEZE_MAX_HZ) -> None:
        self._window_ms = window_ms
        self._min_gap_ms = 1000.0 / max_hz if max_hz > 0 else 0.0
        self._maxlen = (max(1, int(window_ms / self._min_gap_ms) + 2)
                        if self._min_gap_ms else 1)
        self._tracked: set[str] = set()
        self._series: dict[str, deque] = {}

    def track(self, names: Iterable[str]) -> None:
        self._tracked = set(names)
        for name in list(self._series):
            if name not in self._tracked:
                del self._series[name]

    def observe(self, signals: dict[str, Any], ts_ms: int) -> None:
        for name, value in signals.items():
            if name not in self._tracked:
                continue
            series = self._series.get(name)
            if series is None:
                series = self._series[name] = deque(maxlen=self._maxlen)
            if series:
                last_ts = series[-1][0]
                # Out-of-order arrival is routine on the RF link. Dropping a
                # backwards sample keeps the series sorted, which is what a
                # sparkline needs without re-sorting on every render.
                if ts_ms < last_ts:
                    continue
                # Bucket by flooring, NOT by the gap since the last stored
                # sample. An earlier draft compared against series[-1][0] after
                # overwriting it, so the reference advanced with every frame,
                # the gap never reopened, and 100 Hz collapsed to a single
                # retained sample: a freeze frame that looks plausible and is
                # useless. Verified: 100 frames in, 1 sample out.
                if self._min_gap_ms and (
                        int(ts_ms // self._min_gap_ms)
                        == int(last_ts // self._min_gap_ms)):
                    # Same bucket: keep the newest so the sample nearest the
                    # fire moment survives.
                    series[-1] = [ts_ms, value]
                    continue
            series.append([ts_ms, value])
            cutoff = ts_ms - self._window_ms
            while series and series[0][0] < cutoff:
                series.popleft()

    def snapshot(self, names: set[str] | None = None) -> dict[str, list[list]]:
        wanted = self._tracked if names is None else (names & self._series.keys())
        return {name: [list(s) for s in self._series[name]]
                for name in wanted if name in self._series}


def tracked_signals(engine) -> set[str]:
    """Every signal any loaded rule reads, so a freeze frame covers what fired it."""
    names: set[str] = set()
    for doc in engine._user_docs:
        for cond in doc.get("conditions", []):
            signal = cond.get("signal")
            if isinstance(signal, str):
                names.add(signal)
    # load_db is the module's public accessor for the same cached database the
    # decoder holds, so this needs no new attribute on Decoder.
    for msg in load_db().messages:
        if engine.decoder.is_whitelisted(msg.frame_id):
            names.update(s.name for s in msg.signals)
    return names
