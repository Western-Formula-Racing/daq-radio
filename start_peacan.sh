#!/bin/bash

# Activate virtual environment
source /home/wfr-daq/daq-radio/.venv/bin/activate

# Change to peacan directory
cd /home/wfr-daq/daq-radio/peacan

# Start Cloudflare tunnel in background (handles both can and grafana)
echo "Starting Cloudflare tunnel..."
cloudflared tunnel run can-tunnel &

# Wait a moment for tunnel to initialize
sleep 3

# Start the PEACAN app
echo "Starting PEACAN application..."
python app.pyivate virtual environment
source /home/wfr-daq/daq-radio/.venv/bin/activate

# Change to peacan directory
cd /home/wfr-daq/daq-radio/peacan

# Start Cloudflare tunnel in background (handles both dbc and grafana)
echo "Starting Cloudflare tunnel..."
cloudflared tunnel run dbc-tunnel &

# Wait a moment for tunnel to initialize
sleep 3

# Start the PEACAN app
echo "Starting PEACAN application..."
python app.py