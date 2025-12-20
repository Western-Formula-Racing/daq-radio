#!/bin/bash

# Kill any existing processes
pkill -f "telemetry.py"
docker rm -f redis-test 2>/dev/null

echo "Starting Redis..."
docker run -d --name redis-test -p 6379:6379 redis:alpine

echo "Starting Base Station..."
# Run Base Station (Listen on UDP 5005, Publish to Redis)
export ROLE=base
export UDP_PORT=5005
export TCP_PORT=5006
export REDIS_URL=redis://localhost:6379/0
# Assuming we are running on host, so we use localhost
python3 universal-telemetry-software/telemetry.py &
BASE_PID=$!

sleep 2

echo "Starting Car (Simulated)..."
# Run Car (Send to localhost UDP 5005, Simulate CAN)
export ROLE=car
export SIMULATE=true
export REMOTE_IP=127.0.0.1
export UDP_PORT=5005
export TCP_PORT=5006
python3 universal-telemetry-software/telemetry.py &
CAR_PID=$!

echo "System running. Press Ctrl+C to stop."
echo "You can now run 'python3 base-station/redis_ws_bridge.py' in another terminal to bridge to the frontend."

# Wait for user interrupt
trap "kill $BASE_PID $CAR_PID; docker rm -f redis-test; exit" SIGINT SIGTERM
wait