"""Owns the diagnostics-side WCARS engine and fans alerts out to subscribers.

Everything runs on one event loop: the frame feed, rule CRUD handlers, and
WebSocket senders, so no locking is needed. Slow consumers get their queue
capped rather than back-pressuring the feed."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path

from ..log_throttle import LogThrottle, log_throttled_exception
from ..wcars.config import load_config, save_config
from ..wcars.engine import WcarsEngine
from ..wcars.serialization import Alert
from .freeze import FreezeBuffer, tracked_signals
from .frame_source import frame_stream
from .rule_store import RuleStore

logger = logging.getLogger("diagnostics.engine")

SUBSCRIBER_QUEUE_SIZE = 500
WATCHER_QUEUE_SIZE = 500
HISTORY_QUEUE_SIZE = 1000
HISTORY_TICK_S = 0.5


class EngineHost:
    def __init__(self, config_path: Path, store: RuleStore, history=None) -> None:
        self._config_path = Path(config_path)
        self._store = store
        self.engine = WcarsEngine(load_config(self._config_path),
                                   user_rule_docs=store.list())
        self._subscribers: set[asyncio.Queue] = set()
        self._watchers: set[asyncio.Queue] = set()
        self.freeze = FreezeBuffer()
        self.freeze.track(tracked_signals(self.engine))
        self._history = history
        # Bounded and drained off the frame path: a full or read-only SD card is
        # a routine test-day condition, and blocking the feed on a sick card is
        # far worse than losing an archive row for an alert every subscriber has
        # already been sent.
        self._history_q: asyncio.Queue = asyncio.Queue(maxsize=HISTORY_QUEUE_SIZE)
        self._history_drop_throttle = LogThrottle()
        self._history_error_throttle = LogThrottle()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def backlog(self) -> list[Alert]:
        return self.engine.backlog()

    def publish(self, alert: Alert) -> None:
        for q in self._subscribers:
            try:
                q.put_nowait(alert)
            except asyncio.QueueFull:
                # A stalled tablet must not block the feed; that client just
                # misses alerts until it drains or reconnects.
                pass

    def subscribe_watch(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=WATCHER_QUEUE_SIZE)
        self._watchers.add(q)
        return q

    def unsubscribe_watch(self, q: asyncio.Queue) -> None:
        self._watchers.discard(q)

    def publish_signals(self, signals: dict, ts_ms: int) -> None:
        for q in self._watchers:
            try:
                q.put_nowait((signals, ts_ms))
            except asyncio.QueueFull:
                # Same bargain as alerts: a stalled tablet loses updates rather
                # than back-pressuring the feed. The watch list is a live view,
                # so the next frame supersedes whatever was dropped anyway.
                pass

    def feed(self, frame: dict, ts_ms: int) -> list[Alert]:
        # Decoded here and again inside engine.feed. WcarsEngine is the contract
        # shared with the browser port and takes raw frames only, so the freeze
        # buffer and the watch list cannot borrow its decode without changing
        # that contract. The cost is one extra cantools decode per whitelisted
        # frame; the alternative was a second decode path that could drift.
        decoded = self.engine.decoder.decode(frame)
        if decoded is not None:
            self.freeze.observe(decoded["signals"], ts_ms)
            self.publish_signals(decoded["signals"], ts_ms)
        alerts = self.engine.feed(frame, ts_ms)
        for alert in alerts:
            self.publish(alert)
            self._queue_history(alert)
        return alerts

    def _queue_history(self, alert: Alert) -> None:
        if self._history is None:
            return
        try:
            self._history_q.put_nowait((alert, self.freeze.snapshot()))
        except asyncio.QueueFull:
            emit, is_first, dropped = self._history_drop_throttle.take()
            if emit:
                logger.warning(
                    "Fault history queue is full; dropping the archive row for "
                    "%s%s. The alert itself already reached every subscriber.",
                    alert.rule,
                    "" if is_first else f" ({dropped} more suppressed)")

    def drain_history(self) -> int:
        """Write every queued fault to history; returns how many landed.

        Never raises: a database that refuses a write is an operator problem to
        be logged, not a reason to stop the writer or the feed."""
        written = 0
        while True:
            try:
                alert, freeze = self._history_q.get_nowait()
            except asyncio.QueueEmpty:
                return written
            try:
                self._history.record(alert, freeze)
                written += 1
            except Exception as exc:
                # Throttled: a card that refuses one write refuses them all, and
                # a traceback per fault would fill the card it is complaining about.
                log_throttled_exception(logger, self._history_error_throttle,
                                        "Fault history write failed", exc)

    async def run_history_writer(self, shutdown: asyncio.Event) -> None:
        while not shutdown.is_set():
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(shutdown.wait(), timeout=HISTORY_TICK_S)
            self.drain_history()

    def rules_changed(self) -> None:
        self.engine.set_user_rules(self._store.list())
        # The tracked set is derived from the loaded rules, so a freeze frame
        # taken after an edit covers what the new rules actually read.
        self.freeze.track(tracked_signals(self.engine))

    def apply_config(self, cfg: dict) -> dict:
        self.engine.set_config(cfg)
        save_config(self._config_path, self.engine.config)
        return self.engine.config

    async def run(self, ws_url: str, shutdown: asyncio.Event) -> None:
        # aclosing ensures the socket is torn down as soon as the loop exits
        # (shutdown, error) rather than left for the asyncgen finalizer/GC.
        feed_errors = LogThrottle()
        async with contextlib.aclosing(frame_stream(ws_url, shutdown)) as frames:
            async for frame, ts_ms in frames:
                try:
                    self.feed(frame, ts_ms)
                except Exception as exc:
                    # Throttled: whatever breaks one frame breaks them all, and
                    # a traceback per frame would fill the Pi's SD card.
                    log_throttled_exception(logger, feed_errors,
                                            "Engine feed error", exc)
