import asyncio
import redis.asyncio as redis
import websockets
import os
import signal

# Config
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_CHANNEL = "can_messages"
WS_PORT = int(os.getenv("WS_PORT", 9080))

connected_clients = set()
shutdown_event = asyncio.Event()

async def redis_listener():
    """Listens to Redis and broadcasts to all WS clients."""
    try:
        r = redis.from_url(REDIS_URL)
        pubsub = r.pubsub()
        await pubsub.subscribe(REDIS_CHANNEL)
        print(f"[*] Subscribed to Redis channel: {REDIS_CHANNEL}")

        async for message in pubsub.listen():
            if shutdown_event.is_set():
                break
                
            if message['type'] == 'message':
                data = message['data']
                if isinstance(data, bytes):
                    data = data.decode('utf-8')
                
                # Broadcast to all connected clients
                if connected_clients:
                    # Create tasks for sending to each client to avoid blocking
                    await asyncio.gather(
                        *[client.send(data) for client in connected_clients],
                        return_exceptions=True
                    )
    except Exception as e:
        print(f"[!] Redis error: {e}")
    finally:
        print("[*] Redis listener stopping...")

async def ws_handler(websocket):
    """Manages WebSocket connections."""
    connected_clients.add(websocket)
    client_info = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
    print(f"[+] Client connected: {client_info}. Total: {len(connected_clients)}")
    
    try:
        await websocket.wait_closed()
    except Exception as e:
        print(f"[!] Error while waiting for websocket {client_info} to close: {e}")
    finally:
        connected_clients.remove(websocket)
        print(f"[-] Client disconnected: {client_info}. Total: {len(connected_clients)}")

async def main():
    loop = asyncio.get_running_loop()
    
    # Handle graceful shutdown
    def handle_signal():
        print("\n[*] Shutting down...")
        shutdown_event.set()
        
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    print(f"[*] Starting WebSocket Bridge on port {WS_PORT}...")
    
    # Start WebSocket server
    async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
        print(f"[*] WebSocket server running at ws://0.0.0.0:{WS_PORT}")
        
        # Run Redis listener until shutdown
        await redis_listener()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[*] Keyboard interrupt received, exiting...")
