#!/usr/bin/env python3
"""
Simple test client to connect to the base station's CANserver port
and display incoming CAN messages.
"""

import socket
import json
import threading
import time

def connect_to_canserver():
    """Connect to the base station and display CAN messages."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect(('127.0.0.1', 54701))
        print("Connected to base station CANserver on port 54701")
        print("Waiting for CAN messages...")
        print("-" * 50)
        
        buffer = ""
        while True:
            data = sock.recv(1024).decode('utf-8')
            if not data:
                break
                
            buffer += data
            while '\n' in buffer:
                line, buffer = buffer.split('\n', 1)
                if line.strip():
                    try:
                        msg = json.loads(line)
                        can_id = msg.get('id', 'unknown')
                        can_data = msg.get('data', [])
                        timestamp = msg.get('time', time.time())
                        
                        # Convert data to hex for better readability
                        hex_data = ' '.join(f"{b:02X}" for b in can_data)
                        
                        print(f"Time: {timestamp:.3f} | ID: 0x{can_id:03X} | Data: {hex_data}")
                    except json.JSONDecodeError as e:
                        print(f"Error parsing JSON: {e}")
                        print(f"Raw line: {line}")
                        
    except KeyboardInterrupt:
        print("\nDisconnecting...")
    except Exception as e:
        print(f"Connection error: {e}")
    finally:
        try:
            sock.close()
        except:
            pass

if __name__ == "__main__":
    connect_to_canserver()