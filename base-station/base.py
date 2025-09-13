import socket
import json
import cantools
import subprocess
import time
import threading

# Configuration
PORT = 12345
TIME_SYNC_PORT = 12346  # Dedicated port for time synchronization

# Load DBC file for CAN message interpretation
try:
    db = cantools.database.load_file('WFR25-6389976.dbc')
    print("DBC file loaded successfully - ready to decode CAN messages.")
except FileNotFoundError:
    db = None
    print("No DBC file found. Will display raw CAN data only.")
except Exception as e:
    db = None
    print(f"Error loading DBC: {e}. Will display raw CAN data only.")

# UDP socket setup
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('', PORT))
# Enable broadcast receiving (though bind to '' already allows it)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)

print("Base station: Listening for CAN messages from car...")

url = "http://127.0.0.1:8085/can"

def send_can_messages_batch(messages_batch):
    """Send a batch of CAN messages in the correct format"""
    try:
        # Forward the messages batch as-is to the remote server
        command = [
            'curl', '-X', 'POST', url,
            '-H', 'Content-Type: application/json',
            '-d', json.dumps(messages_batch)
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            # print(f"Successfully forwarded {len(messages_batch.get('messages', []))} CAN messages")
            pass
        else:
            print(f"Failed to forward messages: {result.stderr}")
    except Exception as e:
        print(f"Error forwarding messages: {e}")

def send_can_message(arbitration_id, data):
    """Legacy function - now creates proper timestamp format"""
    payload = {
        "messages": [
            {
                "id": str(arbitration_id),
                "data": list(data),
                "timestamp": time.time()  # This will be a decimal number
            }
        ]
    }
    command = [
        'curl', '-X', 'POST', url,
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(payload)
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            pass  # Removed print for performance
        else:
            pass  # Removed print for performance
    except Exception as e:
        pass  # Removed print for performance

# Function to send in a separate thread
def send_async(arbitration_id, data):
    thread = threading.Thread(target=send_can_message, args=(arbitration_id, data))
    thread.start()

def broadcast_time():
    """Broadcast Unix timestamp every second using simple binary protocol"""
    broadcast_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    broadcast_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    
    while True:
        try:
            # Get current Unix timestamp in milliseconds for better accuracy
            current_time_ms = int(time.time() * 1000)
            
            # Pack timestamp into 8 bytes (big-endian) - simple binary format
            time_bytes = current_time_ms.to_bytes(8, byteorder='big')
            
            # Broadcast simple 8-byte timestamp to ESP32's subnet on dedicated time sync port
            try:
                broadcast_sock.sendto(time_bytes, ('192.168.4.255', TIME_SYNC_PORT))
                print(f"Broadcasted time to ESP32 subnet: {current_time_ms}ms (simple binary)")
            except Exception as broadcast_error:
                print(f"Failed to broadcast to ESP32 subnet: {broadcast_error}")
            
        except Exception as e:
            print(f"Error broadcasting time: {e}")
        
        time.sleep(1)  # Broadcast every second

# Start time broadcasting thread
time_thread = threading.Thread(target=broadcast_time, daemon=True)
time_thread.start()
print("Time broadcasting thread started")

while True:
    try:
        data, addr = sock.recvfrom(4096)
        try:
            # Try to decode as UTF-8 first (for JSON messages)
            decoded_str = data.decode('utf-8')
            try:
                # Parse as JSON (should be CAN message metadata)
                can_message = json.loads(decoded_str)
                
                # Check if it's a batch of messages (ESP32 format)
                if isinstance(can_message, dict) and 'messages' in can_message:
                    # This is a batch of CAN messages from ESP32
                    messages = can_message['messages']
                    # print(f"Received batch of {len(messages)} CAN messages from {addr}")
                    
                    # Forward the entire batch to the remote server as-is
                    # ESP32 should already have proper epoch millisecond timestamps
                    send_can_messages_batch(can_message)
                    
                # Check if it's a single structured CAN message (legacy format)
                elif isinstance(can_message, dict) and 'arbitration_id' in can_message and 'data' in can_message:
                    arbitration_id = can_message['arbitration_id']
                    msg_data = bytes(can_message['data'])
                    timestamp = can_message.get('timestamp', 'unknown')
                    
                    # print(f"Received single CAN message from {addr}: ID=0x{arbitration_id:X}")
                    
                    # Try to decode with DBC if available
                    if db:
                        try:
                            decoded = db.decode_message(arbitration_id, msg_data)
                            # print(f"  Decoded: {decoded}")
                        except Exception as decode_error:
                            # print(f"  Could not decode with DBC: {decode_error}")
                            pass
                    
                    # Forward as single message
                    send_async(arbitration_id, msg_data)
                else:
                    # If valid JSON but not recognized format
                    print(f"Received unrecognized JSON from {addr}: {can_message}")
            except json.JSONDecodeError:
                # If valid UTF-8 but not JSON, print as string
                print(f"Received text data from {addr}: {decoded_str}")
        except UnicodeDecodeError:
            # If not valid UTF-8, treat as raw binary data (legacy support)
            print(f"Received raw binary data from {addr}: {data.hex()} (hex) = {list(data)} (bytes)")
    except KeyboardInterrupt:
        break
    except Exception as e:
        print(f"Error: {e}")

sock.close()
