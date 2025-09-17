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

# Start the Base Station in the background
cd ../base-station
echo "Starting Base Station..."
python base.py --test &

sleep 2 
# Start the PECAN app in the current terminal
cd /home/wfr-daq/daq-radio/pecan
echo "Starting PECAN application..."
python app.py

