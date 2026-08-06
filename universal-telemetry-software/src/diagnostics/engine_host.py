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
from .frame_source import frame_stream
from .rule_store import RuleStore

logger = logging.getLogger("diagnostics.engine")

SUBSCRIBER_QUEUE_SIZE = 500


class EngineHost:
    def __init__(self, config_path: Path, store: RuleStore) -> None:
        self._config_path = Path(config_path)
        self._store = store
        self.engine = WcarsEngine(load_config(self._config_path),
                                   user_rule_docs=store.list())
        self._subscribers: set[asyncio.Queue] = set()

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

    def feed(self, frame: dict, ts_ms: int) -> list[Alert]:
        alerts = self.engine.feed(frame, ts_ms)
        for alert in alerts:
            self.publish(alert)
        return alerts

    def rules_changed(self) -> None:
        self.engine.set_user_rules(self._store.list())

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
