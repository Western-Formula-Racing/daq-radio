"""Consumes frame JSON from the local websocket bridge (ws://127.0.0.1:9080).

The car runs Redis-less: data.py hands frames to the bridge through an
in-process queue and the bridge broadcasts to any WebSocket client. Being a
plain client means this service can never disturb the telemetry path; when
the bridge restarts we just reconnect."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import AsyncIterator

import websockets
from websockets.exceptions import ConnectionClosedOK

from ..frame_time import is_valid_frame_ts
from ..log_throttle import LogThrottle, suppressed_suffix

logger = logging.getLogger("diagnostics.frames")

RECONNECT_MIN_S = 0.2
RECONNECT_MAX_S = 10.0

_bad_frame_ts_throttle = LogThrottle()


def _warn_bad_frame_ts(raw_ts) -> None:
    """Rate-limited: frames arrive at bus rate, so an unthrottled warning would be its own outage."""
    emit, _is_first, dropped = _bad_frame_ts_throttle.take()
    if emit:
        logger.warning(
            "Frame has unusable 'time' value %r, falling back to wall clock%s",
            raw_ts, suppressed_suffix(dropped, _bad_frame_ts_throttle.interval_s))


def parse_frames(raw: str | bytes) -> list[tuple[dict, int]]:
    """Extract (frame, ts_ms) pairs from one bridge message.

    The bridge multiplexes CAN frame batches with stats, heartbeat, and lock
    messages on one socket; anything without an int canId and a list of byte
    values is ignored. This is the service's trust boundary, so a malformed
    payload is dropped here rather than raising inside a consumer task later.
    A missing or unusable 'time' falls back to wall-clock ms, the same policy
    as the base bridge's engine feed."""
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError, UnicodeDecodeError, ValueError):
        return []
    items = parsed if isinstance(parsed, list) else [parsed]
    out: list[tuple[dict, int]] = []
    for f in items:
        if not isinstance(f, dict):
            continue
        payload = f.get("data")
        if not isinstance(f.get("canId"), int) or not isinstance(payload, list):
            continue
        # bool is an int in Python but is never a real payload byte, and a
        # value outside 0..255 would blow up bytes() in the decoder.
        if not all(isinstance(b, int) and not isinstance(b, bool) and 0 <= b <= 255
                   for b in payload):
            continue
        raw_ts = f.get("time")
        if is_valid_frame_ts(raw_ts):
            ts_ms = raw_ts
        else:
            ts_ms = int(time.time() * 1000)
            # Key present but unusable is a data.py regression; absent is just
            # an older publisher. Only the former is worth logging.
            if "time" in f:
                _warn_bad_frame_ts(raw_ts)
        out.append((f, ts_ms))
    return out


async def frame_stream(url: str, shutdown: asyncio.Event) -> AsyncIterator[tuple[dict, int]]:
    """Yield (frame, ts_ms) forever, reconnecting with backoff until shutdown.

    Wrap consumption in contextlib.aclosing() so breaking out of the loop
    closes the socket deterministically; otherwise the generator is abandoned
    suspended at the yield and the connection is only torn down whenever the
    asyncgen finalizer hook (or GC) gets to it."""
    delay = RECONNECT_MIN_S
    shutdown_task = asyncio.ensure_future(shutdown.wait())
    try:
        while not shutdown.is_set():
            try:
                async with websockets.connect(url) as ws:
                    logger.info("Connected to bridge at %s", url)
                    while True:
                        recv_task = asyncio.ensure_future(ws.recv())
                        try:
                            done, _ = await asyncio.wait(
                                {recv_task, shutdown_task},
                                return_when=asyncio.FIRST_COMPLETED)
                            if recv_task not in done:
                                # Shutdown won the race: a silent bridge must
                                # not keep us parked on recv() until
                                # cancellation.
                                return
                            try:
                                message = recv_task.result()
                            except ConnectionClosedOK:
                                break  # bridge restart, expected; reconnect quietly
                            # Backoff resets only once the bridge has actually
                            # delivered something, so an accept-then-close
                            # crash-loop still escalates instead of spinning.
                            delay = RECONNECT_MIN_S
                            for pair in parse_frames(message):
                                yield pair
                            if shutdown.is_set():
                                return
                        finally:
                            # asyncio.wait() never cancels its member futures,
                            # including when the wait itself is cancelled (the
                            # consumer cancelling while parked here). Without
                            # this, an abandoned recv_task's ConnectionClosed
                            # surfaces later as an unretrieved-exception
                            # traceback instead of just going away.
                            if not recv_task.done():
                                recv_task.cancel()
                                with contextlib.suppress(asyncio.CancelledError, Exception):
                                    await recv_task
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Bridge connection lost (%s); retrying in %.1fs", exc, delay)
            if shutdown.is_set():
                return
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX_S)
    finally:
        shutdown_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await shutdown_task
