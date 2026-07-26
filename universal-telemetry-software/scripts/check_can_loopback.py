"""Probe whether a frame written on one SocketCAN socket is seen on another.

WCARS publishes its verdicts onto can0 and relies on the normal UTS reader
picking them up so they land in the log. That only works if SocketCAN local
loopback delivers a transmitted frame to other sockets on the same host.
Run this on the car Pi before building anything that depends on it.

Usage:  uv run python scripts/check_can_loopback.py [channel]
Exit:   0 = loopback works, 1 = probe sent but never seen (loopback does not
        work), 2 = could not probe at all (missing interface, bus-off, send
        failure, or other setup error) - not a loopback verdict either way
"""
import sys
import time

import can

CHANNEL = sys.argv[1] if len(sys.argv) > 1 else "can0"
PROBE_ID = 0x5AF  # unused in the DBC, so a real ECU cannot be the source
PROBE_DATA = bytes([0xDE, 0xAD, 0xBE, 0xEF, 0, 0, 0, 0])
DRAIN_BUDGET_S = 0.5  # a live racecar bus is never idle, so draining cannot wait for empty


def main() -> int:
    reader = None
    writer = None
    try:
        try:
            reader = can.interface.Bus(channel=CHANNEL, bustype="socketcan")
            writer = can.interface.Bus(channel=CHANNEL, bustype="socketcan")
        except Exception as exc:
            print(f"ERROR: could not open {CHANNEL}: {exc}")
            print("This is not a loopback verdict, the probe never ran.")
            return 2

        # Bounded drain: on a busy bus the queue may never report empty, and that is fine.
        drain_deadline = time.time() + DRAIN_BUDGET_S
        while time.time() < drain_deadline:
            if reader.recv(0.0) is None:
                break

        try:
            writer.send(can.Message(arbitration_id=PROBE_ID, data=PROBE_DATA,
                                    is_extended_id=False))
        except Exception as exc:
            print(f"ERROR: send failed on {CHANNEL}: {exc}")
            print("This is not a loopback verdict, the probe was not sent.")
            return 2

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
        # Closing a socket is best-effort cleanup, not part of the verdict: one shutdown
        # raising must not skip the other or mask the return value already decided above.
        if reader is not None:
            try:
                reader.shutdown()
            except Exception:
                pass
        if writer is not None:
            try:
                writer.shutdown()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
