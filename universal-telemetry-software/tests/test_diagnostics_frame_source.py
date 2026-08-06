"""Frame source tests: pure parsing of bridge messages, and the reconnecting
WebSocket client against a real local websockets server."""
import asyncio
import contextlib
import json
import logging
import time

import websockets

from src.diagnostics import frame_source
from src.log_throttle import LogThrottle
from src.diagnostics.frame_source import parse_frames, frame_stream


class TestParseFrames:
    def test_batch_of_frames(self):
        raw = json.dumps([
            {"canId": 256, "data": [1, 2], "time": 1700000000000},
            {"canId": 257, "data": [3], "time": 1700000000001},
        ])
        out = parse_frames(raw)
        assert [(f["canId"], ts) for f, ts in out] == [
            (256, 1700000000000), (257, 1700000000001)]

    def test_single_frame_dict(self):
        out = parse_frames(json.dumps({"canId": 1, "data": [], "time": 5}))
        assert len(out) == 1

    def test_non_frame_messages_ignored(self):
        assert parse_frames(json.dumps({"type": "system_stats", "cpu": 40})) == []
        assert parse_frames(json.dumps({"canId": "x", "data": []})) == []
        assert parse_frames("not json at all") == []

    def test_non_byte_data_elements_rejected(self):
        # Would reach the decoder and raise there instead of being dropped here.
        assert parse_frames(json.dumps({"canId": 1, "data": ["ff"], "time": 5})) == []
        assert parse_frames(json.dumps({"canId": 1, "data": [1, None], "time": 5})) == []
        assert parse_frames(json.dumps({"canId": 1, "data": [300], "time": 5})) == []
        assert parse_frames(json.dumps({"canId": 1, "data": [-1], "time": 5})) == []
        assert parse_frames(json.dumps({"canId": 1, "data": [True], "time": 5})) == []
        assert len(parse_frames(json.dumps({"canId": 1, "data": [0, 255], "time": 5}))) == 1

    def test_bad_time_falls_back_to_wall_clock(self):
        before = int(time.time() * 1000)
        ((_, ts),) = parse_frames(json.dumps({"canId": 1, "data": [], "time": -3}))
        assert ts >= before

    def test_missing_time_falls_back_to_wall_clock(self):
        before = int(time.time() * 1000)
        ((_, ts),) = parse_frames(json.dumps({"canId": 1, "data": []}))
        assert ts >= before

    def test_present_but_unusable_time_warns_and_is_rate_limited(self, caplog, monkeypatch):
        monkeypatch.setattr(frame_source, "_bad_frame_ts_throttle", LogThrottle())
        caplog.set_level(logging.WARNING, logger="diagnostics.frames")
        parse_frames(json.dumps({"canId": 1, "data": [], "time": -3}))
        parse_frames(json.dumps({"canId": 1, "data": [], "time": "x"}))
        warnings = [r for r in caplog.records if "unusable 'time'" in r.getMessage()]
        assert len(warnings) == 1

    def test_absent_time_does_not_warn(self, caplog, monkeypatch):
        monkeypatch.setattr(frame_source, "_bad_frame_ts_throttle", LogThrottle())
        caplog.set_level(logging.WARNING, logger="diagnostics.frames")
        parse_frames(json.dumps({"canId": 1, "data": []}))
        assert not [r for r in caplog.records if "unusable 'time'" in r.getMessage()]


class TestFrameStream:
    async def test_yields_frames_and_survives_reconnect(self):
        # Batches arrive over two connections: the server closes after the
        # first send, so receiving the second batch proves reconnection works.
        batches = [
            json.dumps([{"canId": 10, "data": [1], "time": 100}]),
            json.dumps([{"canId": 20, "data": [2], "time": 200}]),
        ]
        sent = 0

        async def handler(ws):
            nonlocal sent
            await ws.send(batches[min(sent, 1)])
            sent += 1
            if sent == 1:
                await ws.close()
            else:
                await shutdown.wait()

        shutdown = asyncio.Event()
        async with websockets.serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            got = []
            async with contextlib.aclosing(
                    frame_stream(f"ws://127.0.0.1:{port}", shutdown)) as stream:
                async for frame, ts in stream:
                    got.append((frame["canId"], ts))
                    if len(got) == 2:
                        shutdown.set()
                        break
        assert got == [(10, 100), (20, 200)]

    async def test_shutdown_observed_while_bridge_is_silent(self):
        # The car keyed off means no frames at all; shutdown must still land.
        # The server holds on its own event so the client cannot escape by
        # way of the socket closing underneath it.
        server_hold = asyncio.Event()

        async def handler(ws):
            await server_hold.wait()

        shutdown = asyncio.Event()
        async with websockets.serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]

            async def consume():
                async with contextlib.aclosing(
                        frame_stream(f"ws://127.0.0.1:{port}", shutdown)) as stream:
                    async for _ in stream:
                        pass

            task = asyncio.create_task(consume())
            await asyncio.sleep(0.15)  # let the client connect and park on recv
            shutdown.set()
            try:
                await asyncio.wait_for(task, timeout=0.5)
            finally:
                server_hold.set()

    async def test_cancel_while_parked_does_not_leak_recv_task(self):
        # asyncio.wait() does not cancel its member futures when the wait
        # itself is cancelled, so cancelling the consumer while parked on
        # recv() must not abandon recv_task with an unretrieved exception
        # (that surfaces later as a spurious "exception was never retrieved"
        # traceback dumped into the diagnostics log).
        server_hold = asyncio.Event()

        async def handler(ws):
            await server_hold.wait()

        loop = asyncio.get_running_loop()
        leaked = []
        prior_handler = loop.get_exception_handler()

        def capturing_handler(loop, context):
            if "never retrieved" in context.get("message", ""):
                leaked.append(context)
            elif prior_handler is not None:
                prior_handler(loop, context)

        loop.set_exception_handler(capturing_handler)
        try:
            shutdown = asyncio.Event()
            async with websockets.serve(handler, "127.0.0.1", 0) as server:
                port = server.sockets[0].getsockname()[1]

                async def consume():
                    async with contextlib.aclosing(
                            frame_stream(f"ws://127.0.0.1:{port}", shutdown)) as stream:
                        async for _ in stream:
                            pass

                task = asyncio.create_task(consume())
                await asyncio.sleep(0.15)  # let the client connect and park on recv
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                server_hold.set()
                # The leak (if any) surfaces on the abandoned task's own
                # finalization, not synchronously with the await above.
                import gc
                gc.collect()
                await asyncio.sleep(0)
                await asyncio.sleep(0)
        finally:
            loop.set_exception_handler(prior_handler)
        assert leaked == []

    async def test_backoff_escalates_when_bridge_accepts_then_closes(self, caplog, monkeypatch):
        # A crash-looping bridge accepts the handshake and drops it; resetting
        # the backoff on connect alone would spin at reconnect rate forever.
        monkeypatch.setattr(frame_source, "RECONNECT_MIN_S", 0.01)
        caplog.set_level(logging.WARNING, logger="diagnostics.frames")
        shutdown = asyncio.Event()
        attempts = 0

        async def handler(ws):
            nonlocal attempts
            attempts += 1
            if attempts >= 4:
                shutdown.set()
            await ws.close(code=1011, reason="crash-loop")

        async with websockets.serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            async with contextlib.aclosing(
                    frame_stream(f"ws://127.0.0.1:{port}", shutdown)) as stream:
                async for _ in stream:
                    pass
        delays = [r.args[1] for r in caplog.records if "retrying in" in r.msg]
        assert delays[:3] == [0.01, 0.02, 0.04]


def test_bridge_alias_still_exists():
    # Guards the Task 4 refactor: the bridge must keep exposing the validator
    # under its old name with identical behavior.
    from src.websocket_bridge import _is_valid_frame_ts
    from src.frame_time import is_valid_frame_ts
    for probe in (1700000000000, 0, -1, True, None, 1.5, "x"):
        assert _is_valid_frame_ts(probe) == is_valid_frame_ts(probe)
