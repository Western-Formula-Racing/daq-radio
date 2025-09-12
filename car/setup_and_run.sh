#!/bin/bash

# Auto-setup script for Car RPi: Configure CAN, WiFi hotspot, and start Docker container
# For simulation on Mac, set SIMULATE=True in car.py and skip CAN/WiFi steps.
# Run with sudo: sudo ./setup_and_run.sh

set -e

echo "Starting auto-setup for Car DAQ..."

# Check if simulation mode (edit car.py to toggle)
if grep -q "SIMULATE = True" car.py; then
    echo "Simulation mode detected. Skipping CAN and WiFi setup."
else
    # Step 1: Configure CAN interface (adjust bitrate as needed)
    echo "Setting up CAN interface..."
    sudo ip link set can0 up type can bitrate 500000
    echo "CAN interface configured."

    # Step 2: Ensure WiFi hotspot is running (assumes hostapd and dnsmasq are installed and configured)
    echo "Checking WiFi hotspot..."
    if ! systemctl is-active --quiet hostapd; then
        echo "Starting hostapd..."
        sudo systemctl start hostapd
    fi
    if ! systemctl is-active --quiet dnsmasq; then
        echo "Starting dnsmasq..."
        sudo systemctl start dnsmasq
    fi
    echo "WiFi hotspot is active."
fi

# Step 3: Build and run the Docker container
echo "Building and starting Docker container..."
docker-compose up --build -d
echo "Car DAQ container is running. Check logs with: docker-compose logs -f"

echo "Setup complete! The car is now broadcasting CAN data over the hotspot."