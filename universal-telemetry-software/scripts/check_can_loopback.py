"""Probe whether a frame written on one SocketCAN socket is seen on another.

WCARS publishes its verdicts onto can0 and relies on the normal UTS reader
picking them up so they land in the log. That only works if SocketCAN local
loopback delivers a transmitted frame to other sockets on the same host.
Run this on the car Pi before building anything that depends on it.

Usage:  uv run python scripts/check_can_loopback.py [channel]
Exit:   0 = loopback works, 1 = it does not
"""
import sys
import time

import can

CHANNEL = sys.argv[1] if len(sys.argv) > 1 else "can0"
PROBE_ID = 0x5AF  # unused in the DBC, so a real ECU cannot be the source
PROBE_DATA = bytes([0xDE, 0xAD, 0xBE, 0xEF, 0, 0, 0, 0])


def main() -> int:
    reader = can.interface.Bus(channel=CHANNEL, bustype="socketcan")
    writer = can.interface.Bus(channel=CHANNEL, bustype="socketcan")
    try:
        # Drain anything already queued so we do not match a stale frame.
        while reader.recv(0.0) is not None:
            pass

        writer.send(can.Message(arbitration_id=PROBE_ID, data=PROBE_DATA,
                                is_extended_id=False))
        print(f"sent 0x{PROBE_ID:X} on {CHANNEL}")

        deadline = time.time() + 2.0
        while time.time() < deadline:
            msg = reader.recv(timeout=0.2)
            if msg is None:
                continue
            if msg.arbitration_id == PROBE_ID and bytes(msg.data) == PROBE_DATA:
                print("PASS: the reader socket saw the transmitted frame")
                return 0
        print("FAIL: transmitted frame was never seen by the reader socket")
        return 1
    finally:
        reader.shutdown()
        writer.shutdown()


if __name__ == "__main__":
    sys.exit(main())
