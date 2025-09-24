#!/usr/bin/env python3
"""
Base station with memory diagnostics and safeguards
"""

import socket
import json
import time
import threading
import requests
import argparse
import psutil
import os
from collections import deque
import redis

REDIS_URL = ""
REDIS_CHANNEL_NAME = "can_messages"
IS_REDIS_ACTIVE:bool


# Setting up Redis client
try: 
    redis_client = redis.Redis()
    redis_client.setex("test", 10, "True") # To test redis connection
    print("redis client initialized")
    IS_REDIS_ACTIVE = True
except Exception as e:
    print(e)
    IS_REDIS_ACTIVE = False
    print("redis database couldn't be reached. Switching to Named Pipes")

# Optional cantools import
try:
    import cantools
    try:
        try: 
            db = cantools.database.load_file('WFR25-6389976.dbc')
        except FileNotFoundError:
            db = cantools.database.load_file('base-station/WFR25-6389976.dbc')
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
UDP_PORT = 12345
TIME_SYNC_PORT = 12346
NAMED_PIPE_PATH = "/tmp/can_data_pipe"
HTTP_FORWARD_URL = "http://127.0.0.1:8085/can"

# Memory safeguards
MAX_BATCH_SIZE = 1000  # Maximum frames to batch before forcing flush
MAX_BATCH_AGE = 5      # Maximum seconds to hold frames before forcing flush

parser = argparse.ArgumentParser(description='Base station with memory diagnostics')
parser.add_argument('--test', action='store_true', help='Enable testing mode')
args = parser.parse_args()

# UDP listener socket
udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
udp_sock.bind(('', UDP_PORT))

def setup_named_pipe():
    """Create a named pipe for local communication."""
    try:
        if os.path.exists(NAMED_PIPE_PATH):
            os.unlink(NAMED_PIPE_PATH)
            print(f"Removed existing named pipe: {NAMED_PIPE_PATH}")
        os.mkfifo(NAMED_PIPE_PATH)
        print(f"Created named pipe: {NAMED_PIPE_PATH}")
    except FileExistsError:
        print(f"Named pipe already exists: {NAMED_PIPE_PATH}")
    except Exception as e:
        print(f"Error creating named pipe: {e}")


if not IS_REDIS_ACTIVE: 
    setup_named_pipe()
print(f"Base station listening for ESP32 CAN JSON on UDP {UDP_PORT}")
print(f"CAN data available via Redis pub/sub")

# Use deque with maxlen for automatic memory management
batched_frames = deque(maxlen=MAX_BATCH_SIZE)
batch_lock = threading.Lock()
if not IS_REDIS_ACTIVE:
    pipe_fd = None
    pipe_file = None
last_batch_time = time.time()

# Statistics
stats = {
    'udp_messages_received': 0,
    'can_frames_processed': 0,
    'messages_published_success': 0,
    'messages_published_failed': 0,
    'http_forwards_success': 0,
    'http_forwards_failed': 0,
    'last_message_time': 0.0
}

def print_stats():
    """Print diagnostic statistics periodically."""
    while True:
        time.sleep(10)  # Print stats every 10 seconds
        process = psutil.Process()
        memory_mb = process.memory_info().rss / 1024 / 1024
        
        with batch_lock:
            batch_size = len(batched_frames)
        
        time_since_last = time.time() - stats['last_message_time']
        
        print(f"\n=== DIAGNOSTICS ===")
        print(f"Memory usage: {memory_mb:.1f} MB")
        print(f"Batched frames: {batch_size}/{MAX_BATCH_SIZE}")
        print(f"UDP messages received: {stats['udp_messages_received']}")
        print(f"CAN frames processed: {stats['can_frames_processed']}")
        print(f"Pipe writes: {stats['messages_published_success']} success, {stats['messages_published_failed']} failed")
        print(f"HTTP forwards: {stats['http_forwards_success']} success, {stats['http_forwards_failed']} failed")
        print(f"Time since last message: {time_since_last:.1f}s")
        print(f"==================")

# When testing piping on macOS, uncomment the pipe_fd with os.0RDWR as one of the args

def open_pipe():
    """Open the named pipe for writing."""
    global pipe_fd, pipe_file
    try:
        if pipe_fd is not None:
            return True
        pipe_fd = os.open(NAMED_PIPE_PATH, os.O_WRONLY | os.O_NONBLOCK) # Uncomment on Base Station / comment out when testing on macOS
        # pipe_fd = os.open(NAMED_PIPE_PATH, os.O_RDWR | os.O_NONBLOCK) # Added for macOS testing / comment out when on base station
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
    """Write CAN frames to named pipe with error handling."""
    if not frames:
        return

    try:
        if IS_REDIS_ACTIVE:
            for frame in frames:
                line = json.dumps(frame) + "\n"
                redis_client.publish(REDIS_CHANNEL_NAME, line)
            stats['messages_published_success'] += 1
            print(f"Successfully published {len(frames)} frames to Redis pub/sub")
        elif not IS_REDIS_ACTIVE:
            if not open_pipe():
                print("Failed to open pipe for writing")
                stats['messages_published_failed'] += 1
                return
            
            for frame in frames:
                line = json.dumps(frame) + "\n"
                pipe_file.write(line) # type:ignore
            pipe_file.flush()  # type:ignore
            stats['messages_published_success'] += 1
            print(f"Successfully wrote {len(frames)} frames to pipe")

            # else:
            #     print("Failed to open pipe for writing")
            #     stats['messages_published_failed'] += 1
            #     return
        else:
            print("Both Methods (Named Pipe and Redis Pub/Sub) have failed")
            return
    except (OSError, IOError) as e:
        if not IS_REDIS_ACTIVE:
            stats['messages_published_failed'] += 1
            if e.errno != 32:  # Ignore "Broken pipe" when no reader
                print(f"Pipe write error: {e}")
            close_pipe()
        else:
            stats['messages_published_failed'] += 1
            print(f"Failed uploading to Redis: {e}")
    except Exception as e:
        if not IS_REDIS_ACTIVE:
            stats['messages_published_failed'] += 1
            print(f"Unexpected pipe error: {e}")
            close_pipe()
        else:
            stats['messages_published_failed'] += 1
            print(f"Failed uploading to Redis: {e}")

def send_can_messages_batch(messages_batch):
    """Send a batch of CAN messages to HTTP endpoint."""
    try:
        r = requests.post(HTTP_FORWARD_URL, json=messages_batch, timeout=5)
        if r.status_code == 200:
            stats['http_forwards_success'] += 1
        else:
            stats['http_forwards_failed'] += 1
    except Exception as e:
        stats['http_forwards_failed'] += 1
        print(f"Error forwarding batch: {e}")

def broadcast_time():
    """Broadcast timestamp for ESP32 sync."""
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
    """Broadcast accumulated CAN frames with memory safeguards."""
    global last_batch_time
    while True:
        time.sleep(1)
        current_time = time.time()
        
        with batch_lock:
            # Force flush if batch is full, old, or has any frames
            should_flush = (len(batched_frames) >= MAX_BATCH_SIZE or 
                          (batched_frames and current_time - last_batch_time >= MAX_BATCH_AGE) or
                          len(batched_frames) > 0)
            
            if should_flush and batched_frames:
                frames_to_send = list(batched_frames)  # Convert deque to list
                batched_frames.clear()
                last_batch_time = current_time
                canserver_broadcast(frames_to_send)

def send_test_messages():
    """Send fake messages for testing."""
    test_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    test_id = 1200
    while True:
        msg = {
            "messages": [
                {"id": str(test_id), "data": [1,2,3,4,5,6,7,8], "timestamp": int(time.time() * 1000)}
            ]
        }
        test_sock.sendto(json.dumps(msg).encode(), ('127.0.0.1', UDP_PORT))
        # test_id += 1  # Increment ID to see different messages
        time.sleep(1)

# Start background threads
threading.Thread(target=broadcast_time, daemon=True).start()
threading.Thread(target=broadcast_batch_timer, daemon=True).start()
threading.Thread(target=print_stats, daemon=True).start()

if args.test:
    threading.Thread(target=send_test_messages, daemon=True).start()
    print("--- TEST MODE ENABLED: Sending fake CAN messages ---")

# Main UDP listener loop
try:
    print("Starting main UDP listener loop...")
    while True:
        data, addr = udp_sock.recvfrom(4096)
        stats['udp_messages_received'] += 1
        stats['last_message_time'] = time.time()
        
        if stats['udp_messages_received'] % 50 == 0:
            print(f"Received {stats['udp_messages_received']} UDP messages so far...")
        
        try:
            decoded = data.decode('utf-8')
            msg = json.loads(decoded)
        except Exception as e:
            print(f"!!! ERROR: Could not decode JSON from {addr}. Error: {e}")
            print(f"    Raw data was: {data}")
            continue

        if isinstance(msg, dict) and "messages" in msg:
            send_can_messages_batch(msg)
            processed_count = 0
            
            for m in msg["messages"]:
                try:
                    mid = int(m["id"], 0) if isinstance(m["id"], str) else int(m["id"])
                    mdata = m["data"]
                    if not isinstance(mdata, list):
                        continue
                    
                    frame = {
                        "time": m.get("timestamp"),
                        "bus": 0,
                        "id": mid,
                        "data": list(mdata)
                    }
                    
                    with batch_lock:
                        batched_frames.append(frame)
                    
                    processed_count += 1
                    stats['can_frames_processed'] += 1
                    
                except Exception as e:
                    print(f"!!! ERROR processing message: {e}")
                    print(f"    Problematic message: {m}")
                    continue
            
            if args.test:
                if processed_count > 0:
                    print(f"Processed {processed_count} CAN frames from batch")
                else:
                    print(f"!!! WARNING: Invalid message format from {addr}: {msg}")
        else:
            print(f"!!! WARNING: Invalid message format from {addr}: {msg}")

except KeyboardInterrupt:
    print("Exiting...")
finally:
    udp_sock.close()
    if IS_REDIS_ACTIVE:
        redis_client.close()
    elif not IS_REDIS_ACTIVE:
        close_pipe()
        try:
            os.unlink(NAMED_PIPE_PATH)
            # print(f"Cleaned up named pipe: {NAMED_PIPE_PATH}")
        except FileNotFoundError:
            pass
