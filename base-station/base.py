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

# Configuration
UDP_PORT = 12345               # incoming from ESP32
TIME_SYNC_PORT = 12346         # for time sync broadcast
CANSERVER_PORT = 54701         # SavvyCAN default CANserver TCP port
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

# TCP server socket for SavvyCAN (CANserver)
tcp_server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
tcp_server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
tcp_server.bind(('0.0.0.0', CANSERVER_PORT))
tcp_server.listen(1)

print(f"Base station listening for ESP32 CAN JSON on UDP {UDP_PORT}")
print(f"CANserver emulation ready on TCP port {CANSERVER_PORT} (connect SavvyCAN with CANserver option)")

# List of connected SavvyCAN clients
savvycan_clients = []
client_lock = threading.Lock()

def send_can_messages_batch(messages_batch):
    """Send a batch of CAN messages (JSON) to HTTP endpoint."""
    try:
        r = requests.post(HTTP_FORWARD_URL, json=messages_batch, timeout=5)
        if r.status_code != 200:
            print(f"HTTP forward error {r.status_code}")
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

def canserver_broadcast(arbitration_id, data):
    """
    Forward a CAN frame to all connected SavvyCAN clients in CANserver JSON format.
    Example per-frame line: {"time":123456.789,"bus":0,"id":123,"data":[1,2,3]}
    """
    # --- DIAGNOSTIC PRINT ---
    print(f"Broadcasting to {len(savvycan_clients)} SavvyCAN client(s)...")
    # ------------------------
    frame = {
        "time": time.time(),
        "bus": 0,
        "id": int(arbitration_id),
        "data": list(data)
    }
    line = json.dumps(frame) + "\n"
    dead_clients = []
    with client_lock:
        for c in savvycan_clients:
            try:
                c.sendall(line.encode('utf-8'))
            except Exception:
                dead_clients.append(c)
        for d in dead_clients:
            savvycan_clients.remove(d)
            try:
                d.close()
            except Exception:
                pass

def tcp_accept_loop():
    """Accept incoming SavvyCAN connections."""
    while True:
        conn, addr = tcp_server.accept()
        print(f"SavvyCAN connected from {addr}")
        with client_lock:
            savvycan_clients.append(conn)

def send_test_messages():
    """Send fake messages into UDP listener for testing."""
    test_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    msg = {
        "messages": [
            {"id": "6789", "data": [1,2,3,4,5,6,7,8], "timestamp": time.time()}
        ]
    }
    while True:
        test_sock.sendto(json.dumps(msg).encode(), ('127.0.0.1', UDP_PORT))
        time.sleep(1)

# Start background threads
threading.Thread(target=broadcast_time, daemon=True).start()
threading.Thread(target=tcp_accept_loop, daemon=True).start()
if args.test:
    threading.Thread(target=send_test_messages, daemon=True).start()
    print("--- TEST MODE ENABLED: Sending fake CAN messages every second. ---")

# Main loop
try:
    while True:
        data, addr = udp_sock.recvfrom(4096)
        # --- DIAGNOSTIC PRINT ---
        print(f"\nReceived {len(data)} bytes from {addr}")
        # ------------------------
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
                    canserver_broadcast(mid, mdata)
                except Exception as e:
                    # --- DIAGNOSTIC PRINT ---
                    print(f"!!! ERROR processing individual message: {e}")
                    print(f"    Problematic message data was: {m}")
                    # ------------------------
                    continue
        else:
            print(f"!!! WARNING: Received valid JSON but it was missing the 'messages' key. Data: {msg}")

except KeyboardInterrupt:
    print("Exiting...")
finally:
    udp_sock.close()
    tcp_server.close()
    with client_lock:
        for c in savvycan_clients:
            c.close()