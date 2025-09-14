#!/usr/bin/env python3
"""
Enhanced CAN message viewer with DBC decoding support.
Connects to the base station's CANserver port and displays decoded CAN messages.
"""

import socket
import json
import threading
import time
import sys

# Try to import cantools for DBC decoding
try:
    import cantools
    try:
        db = cantools.database.load_file('WFR25-6389976.dbc')
        print("DBC file loaded successfully - messages will be decoded.")
        DBC_AVAILABLE = True
    except FileNotFoundError:
        db = None
        print("No DBC file found. Will display raw CAN data only.")
        DBC_AVAILABLE = False
    except Exception as e:
        db = None
        print(f"Error loading DBC: {e}. Will display raw CAN data only.")
        DBC_AVAILABLE = False
except ImportError:
    cantools = None
    db = None
    print("cantools not installed. Install with: pip install cantools")
    print("Will display raw CAN data only.")
    DBC_AVAILABLE = False

def decode_can_message(can_id, data):
    """Decode CAN message using DBC if available."""
    if not DBC_AVAILABLE or not db:
        return None
    
    try:
        # Find message by ID - iterate through messages to find matching frame_id
        for message in db.messages:
            if message.frame_id == can_id:
                decoded = message.decode(bytes(data))
                return {
                    'name': message.name,
                    'signals': decoded
                }
        return None
    except Exception as e:
        return None

def format_can_data(can_id, data, timestamp):
    """Format CAN data for display."""
    # Convert data to hex for better readability
    hex_data = ' '.join(f"{b:02X}" for b in data)
    
    # Basic info line
    info_line = f"Time: {timestamp:.3f} | ID: 0x{can_id:03X} ({can_id}) | Data: {hex_data}"
    
    # Try to decode with DBC
    decoded = decode_can_message(can_id, data)
    if decoded:
        decode_line = f"  └─ {decoded['name']}: {decoded['signals']}"
        return info_line + "\n" + decode_line
    else:
        return info_line

def connect_to_canserver():
    """Connect to the base station and display CAN messages."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect(('127.0.0.1', 54701))
        print("Connected to base station CANserver on port 54701")
        print("Waiting for CAN messages...")
        print("=" * 80)
        
        buffer = ""
        message_count = 0
        
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
                        
                        message_count += 1
                        
                        # Format and display the message
                        formatted_msg = format_can_data(can_id, can_data, timestamp)
                        print(f"[{message_count:04d}] {formatted_msg}")
                        
                        # Add some spacing every 10 messages for readability
                        if message_count % 10 == 0:
                            print("-" * 80)
                            
                    except json.JSONDecodeError as e:
                        print(f"Error parsing JSON: {e}")
                        print(f"Raw line: {line}")
                        
    except KeyboardInterrupt:
        print(f"\nDisconnecting... (Received {message_count} messages)")
    except Exception as e:
        print(f"Connection error: {e}")
    finally:
        try:
            sock.close()
        except:
            pass

if __name__ == "__main__":
    print("Enhanced CAN Message Viewer")
    print(f"DBC decoding: {'Enabled' if DBC_AVAILABLE else 'Disabled'}")
    print()
    connect_to_canserver()