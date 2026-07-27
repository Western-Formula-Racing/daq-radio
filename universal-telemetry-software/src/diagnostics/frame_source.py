"""Consumes frame JSON from the local websocket bridge (ws://127.0.0.1:9080).

The car runs Redis-less: data.py hands frames to the bridge through an
in-process queue and the bridge broadcasts to any WebSocket client. Being a
plain client means this service can never disturb the telemetry path; when
the bridge restarts we just reconnect."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncIterator

import websockets

from ..frame_time import is_valid_frame_ts

logger = logging.getLogger("diagnostics.frames")

RECONNECT_MIN_S = 0.2
RECONNECT_MAX_S = 10.0


def parse_frames(raw: str | bytes) -> list[tuple[dict, int]]:
    """Extract (frame, ts_ms) pairs from one bridge message.

    The bridge multiplexes CAN frame batches with stats, heartbeat, and lock
    messages on one socket; anything without an int canId and list data is
    ignored. A missing or unusable 'time' falls back to wall-clock ms, the
    same policy as the base bridge's engine feed."""
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError, UnicodeDecodeError, ValueError):
        return []
    items = parsed if isinstance(parsed, list) else [parsed]
    out: list[tuple[dict, int]] = []
    for f in items:
        if not isinstance(f, dict):
            continue
        if not isinstance(f.get("canId"), int) or not isinstance(f.get("data"), list):
            continue
        raw_ts = f.get("time")
        ts_ms = raw_ts if is_valid_frame_ts(raw_ts) else int(time.time() * 1000)
        out.append((f, ts_ms))
    return out


async def frame_stream(url: str, shutdown: asyncio.Event) -> AsyncIterator[tuple[dict, int]]:
    """Yield (frame, ts_ms) forever, reconnecting with backoff until shutdown."""
    delay = RECONNECT_MIN_S
    while not shutdown.is_set():
        try:
            async with websockets.connect(url) as ws:
                logger.info("Connected to bridge at %s", url)
                delay = RECONNECT_MIN_S
                async for message in ws:
                    for pair in parse_frames(message):
                        yield pair
                    if shutdown.is_set():
                        return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Bridge connection lost (%s); retrying in %.1fs", exc, delay)
        if shutdown.is_set():
            return
        await asyncio.sleep(delay)
        delay = min(delay * 2, RECONNECT_MAX_S)
