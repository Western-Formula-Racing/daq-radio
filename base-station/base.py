import socket
import json
import cantools

# Configuration
PORT = 12345

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

while True:
    try:
        data, addr = sock.recvfrom(4096)
        try:
            # Try to decode as UTF-8 first (for JSON messages)
            decoded_str = data.decode('utf-8')
            try:
                # Parse as JSON (should be CAN message metadata)
                can_message = json.loads(decoded_str)
                
                # Check if it's a structured CAN message
                if isinstance(can_message, dict) and 'arbitration_id' in can_message and 'data' in can_message:
                    arbitration_id = can_message['arbitration_id']
                    msg_data = bytes(can_message['data'])
                    timestamp = can_message.get('timestamp', 'unknown')
                    
                    print(f"Received CAN message from {addr}:")
                    print(f"  ID: 0x{arbitration_id:X} ({arbitration_id})")
                    print(f"  Data: {list(msg_data)} (hex: {msg_data.hex()})")
                    print(f"  Timestamp: {timestamp}")
                    
                    # Try to decode with DBC if available
                    if db:
                        try:
                            decoded = db.decode_message(arbitration_id, msg_data)
                            print(f"  Decoded: {decoded}")
                        except Exception as decode_error:
                            print(f"  Could not decode with DBC: {decode_error}")
                    else:
                        print("  (No DBC file available for decoding)")
                    print()  # Empty line for readability
                else:
                    # If valid JSON but not CAN message format
                    print(f"Received JSON data from {addr}: {can_message}")
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
