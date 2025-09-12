import can
import socket
import time
import json
import random
import csv
import os

# Configuration
SIMULATE = True  # Set to True for simulation without hardware, False for real CAN
BASE_IP = '127.0.0.1' if SIMULATE else '192.168.4.255'  # Localhost for sim, broadcast for hotspot
PORT = 12345

# Load real data from CSV
messages = []
try:
    csv_path = '2025-09-08-23-47-13.csv'

    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) >= 11:
                ts = int(row[0])
                id_ = int(row[2])
                data = [int(x) for x in row[3:11]]
                messages.append((ts, id_, data))
    print(f"Loaded {len(messages)} messages from CSV: {csv_path}")
except Exception as e:
    print(f"Error loading CSV: {e}")
    messages = []

# CAN bus setup or simulation
if not SIMULATE:
    bus = can.interface.Bus(channel='can0', bustype='socketcan')
else:
    bus = None  # No real bus for simulation
    print("Simulation mode: Replaying CAN messages from CSV.")

# UDP socket setup
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

print("Car side: Listening to CAN bus and transmitting to base station...")

message_index = 0

while True:
    try:
        if not SIMULATE:
            msg = bus.recv(timeout=1.0)
        else:
            if messages:
                if message_index >= len(messages):
                    message_index = 0
                    start_time = time.time()
                    print("Restarting message replay from beginning")
                
                ts, id_, data = messages[message_index]
                
                # Calculate timing based on relative timestamps
                if message_index == 0:
                    # First message, no delay needed
                    sleep_time = 0
                else:
                    prev_ts = messages[message_index - 1][0]
                    # Calculate time difference between messages in seconds
                    time_diff = (ts - prev_ts) / 1000.0
                    sleep_time = max(0, time_diff)  # Ensure non-negative sleep time
                
                if sleep_time > 0 and sleep_time < 0.5:
                    # Avoid too short sleeps (artificially speed down)
                    time.sleep(0.5)
                elif sleep_time >= 0.5:
                    time.sleep(sleep_time)
                
                msg = can.Message(arbitration_id=id_, data=bytes(data), timestamp=time.time())
                message_index += 1
            else:
                # No messages available - skip this iteration
                msg = None
                time.sleep(0.1)

        if msg:
            # Create a structured message with CAN metadata
            can_message = {
                "timestamp": msg.timestamp,
                "arbitration_id": msg.arbitration_id,
                "data": list(msg.data),  # Convert bytes to list for JSON serialization
                "dlc": len(msg.data)
            }
            
            # Send as JSON
            payload = json.dumps(can_message).encode('utf-8')
            sock.sendto(payload, (BASE_IP, PORT))
            print(f"Sent CAN message: ID=0x{msg.arbitration_id:X}, Data={list(msg.data)}")
    except KeyboardInterrupt:
        break
    except Exception as e:
        print(f"Error: {e}")
        time.sleep(1)

sock.close()
