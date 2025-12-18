#!/bin/bash

# Default to test mode if no arguments provided
MODE="${1:-test}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== DAQ Radio System Startup ===${NC}"
echo -e "${BLUE}Mode: ${MODE}${NC}"

# Cleanup function
cleanup() {
    echo -e "\n${RED}Shutting down services...${NC}"
    kill $(jobs -p) 2>/dev/null
    echo -e "${GREEN}Shutdown complete.${NC}"
}
trap cleanup SIGINT SIGTERM

# 1. Start Redis (if not running)
if ! pgrep -x "redis-server" > /dev/null; then
    echo -e "${BLUE}[System] Starting Redis server...${NC}"
    redis-server &
    sleep 2
else
    echo -e "${GREEN}[System] Redis is already running.${NC}"
fi

# 2. Start Base Station (Receiver)
echo -e "${BLUE}[Base] Starting Base Station...${NC}"
if [ "$MODE" == "test" ]; then
    python3 base-station/base.py --test &
else
    python3 base-station/base.py &
fi

# 3. Start Redis->WebSocket Bridge
echo -e "${BLUE}[Bridge] Starting WebSocket Bridge...${NC}"
python3 base-station/redis_ws_bridge.py &

# 4. Start Frontend (Development Mode)
# Check if we should start the frontend (optional, maybe user runs it separately)
# Assuming user wants to run it here for convenience
echo -e "${BLUE}[Frontend] Starting Dashboard (Vite)...${NC}"
cd pecan/Frontend/pecan-live-dashboard
npm run dev &

# Wait for all background processes
wait
