#!/bin/bash

# Activate virtual environment
source /home/wfr-daq/daq-radio/.venv/bin/activate

# Change to pecan directory
cd /home/wfr-daq/daq-radio/pecan

# Start Cloudflare tunnel in background (handles both can and grafana)
echo "Starting Cloudflare tunnel..."
cloudflared tunnel run can-tunnel &

# Wait a moment for tunnel to initialize
sleep 3

# Start the Unified app
echo "Starting PECAN application..."
python unified_app_v2.py