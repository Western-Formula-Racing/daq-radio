#!/bin/bash
set -e

# Cleanup previous runs
docker rm -f redis-test car-sim web-tester 2>/dev/null || true
pkill -f "vite" || true

# Build Docker
echo "Building Backend Docker image..."
docker build -q -t universal-telemetry -f Dockerfile .

docker network create telemetry-net || true

# Redis
echo "Starting Redis..."
docker run -d --rm --name redis-test --network telemetry-net redis:alpine

# Car (Simulated with Video File)
echo "Starting Car (Streaming)..."
VIDEO_PATH="/app/assets/test-video.mp4"
docker run -d --rm --name car-sim \
  --network telemetry-net \
  -p 5051:5051 \
  -v $(pwd)/assets:/app/assets \
  -e ROLE=car \
  -e REMOTE_IP=web-tester \
  -e SIMULATE=true \
  -e ENABLE_VIDEO=true \
  -e ENABLE_AUDIO=false \
  -e VIDEO_FILE=$VIDEO_PATH \
  -e USE_HW_ENC=false \
  universal-telemetry \
  sh -c "python3 main.py & python3 web-tester/car_app.py"

# Web Tester Backend (Streams + SocketIO)
echo "Starting Web Tester Backend..."
docker run -d --rm --name web-tester \
  --network telemetry-net \
  -p 5050:5000 \
  -e REDIS_URL=redis://redis-test:6379/0 \
  -e REMOTE_IP=car-sim \
  -e ROLE=base \
  -e ENABLE_AUDIO=false \
  -e ENABLE_VIDEO=false \
  universal-telemetry \
  sh -c "python3 main.py & python3 web-tester/app.py"

# Pecan Frontend (Dev Mode)
echo "Starting Pecan Frontend (Dev Mode)..."
(cd ../pecan && npm run dev -- --host) &
PECAN_PID=$!

echo "System running."
echo "Access the Dashboard (Pecan) at: http://localhost:5173"
echo "Access the Car Interface at: http://localhost:5051"
echo "Backend Stream API at: http://localhost:5050"

trap "docker stop car-sim web-tester redis-test; kill $PECAN_PID; pkill -f 'vite'" SIGINT SIGTERM
wait
