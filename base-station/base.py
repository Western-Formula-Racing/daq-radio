#!/usr/bin/env python3
"""
Base station for receiving CAN-over-UDP JSON from ESP32, forwarding batches
to an HTTP endpoint, and exposing a CANserver-compatible TCP service for SavvyCAN.

Usage:
    python3 base.py [--test]
"""

import socket
import json
import time
import threading
import requests
import argparse

# Optional cantools import (for DBC decoding)
try:
    import cantools
    try:
        db = cantools.database.load_file('WFR25-6389976.dbc')
        print("DBC file loaded successfully - ready to decode CAN messages.")
    except FileNotFoundError:
        db = None
        print("No DBC file found. Will display raw CAN data only.")
    except Exception as e:
        db = None
        print(f"Error loading DBC: {e}. Will display raw CAN data only.")
except ImportError:
    cantools = None
    db = None
    print("cantools not installed. Install with: pip install cantools")

import os

# Configuration
UDP_PORT = 12345               # incoming from ESP32
TIME_SYNC_PORT = 12346         # for time sync broadcast
NAMED_PIPE_PATH = "/tmp/can_data_pipe"  # Named pipe for local communication
HTTP_FORWARD_URL = "http://127.0.0.1:8085/can"

# Command-line arguments
parser = argparse.ArgumentParser(description='Base station with CANserver interface')
parser.add_argument('--test', action='store_true', help='Enable testing mode with fake CAN messages')
args = parser.parse_args()

# UDP listener socket for incoming CAN-over-UDP JSON
udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
udp_sock.bind(('', UDP_PORT))

# Setup named pipe for local communication
def setup_named_pipe():
    """Create a named pipe for local communication."""
    try:
        os.mkfifo(NAMED_PIPE_PATH)
        print(f"Created named pipe: {NAMED_PIPE_PATH}")
    except FileExistsError:
        print(f"Named pipe already exists: {NAMED_PIPE_PATH}")
    except Exception as e:
        print(f"Error creating named pipe: {e}")

setup_named_pipe()

print(f"Base station listening for ESP32 CAN JSON on UDP {UDP_PORT}")
print(f"CAN data available via named pipe: {NAMED_PIPE_PATH}")

# Batch for named pipe broadcasts
batched_frames = []
batch_lock = threading.Lock()
pipe_fd = None
pipe_file = None

def open_pipe():
    """Open the named pipe for writing."""
    global pipe_fd, pipe_file
    try:
        if pipe_fd is not None:
            return True
        pipe_fd = os.open(NAMED_PIPE_PATH, os.O_WRONLY | os.O_NONBLOCK)
        pipe_file = os.fdopen(pipe_fd, 'w')
        print("Opened named pipe for writing")
        return True
    except Exception as e:
        print(f"Error opening pipe: {e}")
        pipe_fd = None
        pipe_file = None
        return False

def close_pipe():
    """Close the named pipe."""
    global pipe_fd, pipe_file
    try:
        if pipe_file:
            pipe_file.close()
        pipe_fd = None
        pipe_file = None
    except Exception as e:
        print(f"Error closing pipe: {e}")

def canserver_broadcast(frames):
    """
    Write CAN frames to named pipe for local communication.
    Each frame: {"time":123456.789,"bus":0,"id":123,"data":[1,2,3]}
    """
    global pipe_file
    if not frames:
        return
    print(f"Writing {len(frames)} frame(s) to named pipe...")
    
    try:
        if not open_pipe():
            return
            
        for frame in frames:
            line = json.dumps(frame) + "\n"
            pipe_file.write(line)
        pipe_file.flush()
    except (OSError, IOError) as e:
        if e.errno != 32:  # Ignore "Broken pipe" when no reader
            print(f"Pipe write error: {e}")
        close_pipe()  # Close and will reopen on next write
    except Exception as e:
        print(f"Unexpected pipe error: {e}")
        close_pipe()

def send_can_messages_batch(messages_batch):
    """Send a batch of CAN messages (JSON) to HTTP endpoint."""
    try:
        r = requests.post(HTTP_FORWARD_URL, json=messages_batch, timeout=5)
        if r.status_code != 200:
            # print(f"HTTP forward error {r.status_code}")
            pass
    except Exception as e:
        print(f"Error forwarding batch: {e}")

def broadcast_time():
    """Broadcast 8-byte big-endian timestamp for ESP32 sync."""
    b_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    b_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    while True:
        try:
            now_ms = int(time.time() * 1000)
            ts = now_ms.to_bytes(8, 'big')
            b_sock.sendto(ts, ('192.168.4.255', TIME_SYNC_PORT))
        except Exception as e:
            print(f"Time broadcast error: {e}")
        time.sleep(1)

def broadcast_batch_timer():
    """Broadcast accumulated CAN frames every second."""
    while True:
        time.sleep(1)
        with batch_lock:
            if batched_frames:
                frames_to_send = batched_frames[:]
                batched_frames.clear()
                canserver_broadcast(frames_to_send)

def send_test_messages():
    """Send fake messages into UDP listener for testing."""
    test_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    while True:
        msg = {
            "messages": [
                # time in ms
                {"id": "6789", "data": [1,2,3,4,5,6,7,8], "timestamp": int(time.time() * 1000)}
            ]
        }
        test_sock.sendto(json.dumps(msg).encode(), ('127.0.0.1', UDP_PORT))
        time.sleep(1)

# Start background threads
threading.Thread(target=broadcast_time, daemon=True).start()
threading.Thread(target=broadcast_batch_timer, daemon=True).start()
if args.test:
    threading.Thread(target=send_test_messages, daemon=True).start()
    print("--- TEST MODE ENABLED: Sending fake CAN messages every second. ---")

# Main loop
try:
    while True:
        data, addr = udp_sock.recvfrom(4096)
        #  {len(data)} bytes from {addr}")
        try:
            decoded = data.decode('utf-8')
            msg = json.loads(decoded)
        except Exception as e:
            # --- DIAGNOSTIC PRINT ---
            print(f"!!! ERROR: Could not decode or parse JSON from {addr}. Error: {e}")
            print(f"    Raw data was: {data}")
            # ------------------------
            continue

        if isinstance(msg, dict) and "messages" in msg:
            send_can_messages_batch(msg)
            for m in msg["messages"]:
                try:
                    mid = int(m["id"], 0) if isinstance(m["id"], str) else int(m["id"])
                    mdata = m["data"]
                    if not isinstance(mdata, list):
                        continue
                    # Accumulate frame for batch broadcast
                    frame = {
                        "time": m.get("timestamp"),
                        "bus": 0,
                        "id": mid,
                        "data": list(mdata)
                    }
                    with batch_lock:
                        batched_frames.append(frame)
                except Exception as e:
                    # --- DIAGNOSTIC PRINT ---
                    print(f"!!! ERROR processing individual message: {e}")
                    print(f"    Problematic message data was: {m}")
                    # ------------------------
                    continue
            # print(f"Successfully processed batch with {len(msg['messages'])} messages")
        else:
            print(f"!!! WARNING: Received valid JSON but it was missing the 'messages' key. Data: {msg}")

except KeyboardInterrupt:
    print("Exiting...")
finally:
    udp_sock.close()
    close_pipe()  # Close pipe file descriptor
    # Clean up named pipe
    try:
        os.unlink(NAMED_PIPE_PATH)
        print(f"Cleaned up named pipe: {NAMED_PIPE_PATH}")
    except FileNotFoundError:
        pass