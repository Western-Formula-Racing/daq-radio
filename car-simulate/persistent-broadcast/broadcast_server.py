import asyncio
import websockets
import json
import csv
import os
import ssl
from typing import List, Set
from websockets.server import WebSocketServerProtocol

# Configuration from environment variables
WS_PORT = int(os.getenv('WS_PORT', '9080'))
WSS_PORT = int(os.getenv('WSS_PORT', '9443'))
CSV_FILE = os.getenv('CSV_FILE', '2025-01-01-00-07-00.csv')
SSL_CERT = os.getenv('SSL_CERT', '/app/ssl/cert.pem')
SSL_KEY = os.getenv('SSL_KEY', '/app/ssl/key.pem')
DOMAIN = os.getenv('DOMAIN', 'ws-wfr.0001200.xyz')

# Global set to track connected clients
connected_clients: Set[WebSocketServerProtocol] = set()

def load_can_data(file_path: str) -> List[dict]:
    """Load CAN data from CSV file and format as JSON objects."""
    data = []
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} not found.")
        return data
    
    print(f"Loading CAN data from {file_path}...")
    with open(file_path, 'r') as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 11 or row[1] != 'CAN':
                continue  # Skip invalid rows
            try:
                message = {
                    'time': int(row[0]),
                    'canId': int(row[2]),
                    'data': [int(x) for x in row[3:11]]  # 8 data bytes
                }
                data.append(message)
            except ValueError as e:
                print(f"Skipping invalid row: {row} - {e}")
    
    print(f"Loaded {len(data)} CAN messages")
    return data

async def handle_client(websocket: WebSocketServerProtocol):
    connected_clients.add(websocket)
    client_info = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
    print(f"Client connected: {client_info} (Total clients: {len(connected_clients)})")
    
    try:
        async for message in websocket:
            print(f"Received from {client_info}: {message[:100]}")
    except websockets.exceptions.ConnectionClosed:
        print(f"Client disconnected: {client_info}")
    finally:
        connected_clients.remove(websocket)
        print(f"Client removed: {client_info} (Total clients: {len(connected_clients)})")

async def broadcast_can_data(can_data: List[dict]):
    """Continuously broadcast CAN data to all connected clients."""
    batch_size = 100
    interval = 1 / 5  # 5 Hz = 0.2 seconds
    index = 0
    
    print(f"Starting broadcast loop (batch_size={batch_size}, interval={interval}s)")
    
    while True:
        if connected_clients:
            # Get the next batch of messages, cycling through
            batch = can_data[index:index + batch_size]
            if len(batch) < batch_size:
                # Wrap around if necessary
                batch += can_data[:batch_size - len(batch)]
            
            # Prepare JSON message
            message = json.dumps(batch)
            
            # Broadcast to all connected clients
            disconnected = set()
            for client in connected_clients:
                try:
                    await client.send(message)
                except websockets.exceptions.ConnectionClosed:
                    disconnected.add(client)
                except Exception as e:
                    print(f"Error sending to client: {e}")
                    disconnected.add(client)
            
            # Remove disconnected clients
            for client in disconnected:
                connected_clients.discard(client)
            
            if connected_clients:
                print(f"Broadcasted {len(batch)} messages to {len(connected_clients)} clients")
            
            # Update index for next batch
            index = (index + batch_size) % len(can_data)
        
        # Wait for the interval
        await asyncio.sleep(interval)

async def start_ws_server(can_data: List[dict]):
    """Start the WebSocket server (ws://)."""
    print(f"Starting WebSocket server on port {WS_PORT}...")
    async with websockets.serve(handle_client, "0.0.0.0", WS_PORT):
        print(f"WebSocket server (ws) running on port {WS_PORT}")
        await asyncio.Future()  # Run forever

async def start_wss_server(can_data: List[dict]):
    """Start the secure WebSocket server (wss://)."""
    # Check if SSL certificates exist
    if not os.path.exists(SSL_CERT) or not os.path.exists(SSL_KEY):
        print(f"Warning: SSL certificates not found at {SSL_CERT} and {SSL_KEY}")
        print("WSS server will not start. Using self-signed certs or configure Cloudflare Tunnel.")
        return
    
    # Configure SSL context
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain(SSL_CERT, SSL_KEY)
    
    print(f"Starting secure WebSocket server on port {WSS_PORT}...")
    async with websockets.serve(handle_client, "0.0.0.0", WSS_PORT, ssl=ssl_context):
        print(f"Secure WebSocket server (wss) running on port {WSS_PORT}")
        await asyncio.Future()  # Run forever

async def main():
    """Main entry point."""
    # Load CAN data
    can_data = load_can_data(CSV_FILE)
    if not can_data:
        print("No CAN data loaded. Exiting.")
        return
    
    print(f"Starting broadcast server for domain: {DOMAIN}")
    print(f"WebSocket URL: ws://{DOMAIN}")
    print(f"Secure WebSocket URL: wss://{DOMAIN}")
    
    # Start both servers and the broadcast task
    tasks = [
        asyncio.create_task(start_ws_server(can_data)),
        asyncio.create_task(broadcast_can_data(can_data)),
    ]
    
    # Only start WSS if certificates exist
    if os.path.exists(SSL_CERT) and os.path.exists(SSL_KEY):
        tasks.append(asyncio.create_task(start_wss_server(can_data)))
    
    await asyncio.gather(*tasks)

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down broadcast server...")
