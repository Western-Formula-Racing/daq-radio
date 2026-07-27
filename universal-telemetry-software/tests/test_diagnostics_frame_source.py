"""Frame source tests: pure parsing of bridge messages, and the reconnecting
WebSocket client against a real local websockets server."""
import asyncio
import json
import time

import pytest
import websockets

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

    def test_bad_time_falls_back_to_wall_clock(self):
        before = int(time.time() * 1000)
        ((_, ts),) = parse_frames(json.dumps({"canId": 1, "data": [], "time": -3}))
        assert ts >= before

    def test_missing_time_falls_back_to_wall_clock(self):
        before = int(time.time() * 1000)
        ((_, ts),) = parse_frames(json.dumps({"canId": 1, "data": []}))
        assert ts >= before


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
                await asyncio.sleep(30)

        shutdown = asyncio.Event()
        async with websockets.serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            got = []
            async for frame, ts in frame_stream(f"ws://127.0.0.1:{port}", shutdown):
                got.append((frame["canId"], ts))
                if len(got) == 2:
                    shutdown.set()
                    break
        assert got == [(10, 100), (20, 200)]


def test_bridge_alias_still_exists():
    # Guards the Task 4 refactor: the bridge must keep exposing the validator
    # under its old name with identical behavior.
    from src.websocket_bridge import _is_valid_frame_ts
    from src.frame_time import is_valid_frame_ts
    for probe in (1700000000000, 0, -1, True, None, 1.5, "x"):
        assert _is_valid_frame_ts(probe) == is_valid_frame_ts(probe)
