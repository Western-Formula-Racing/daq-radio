#!/bin/bash

# Test script for DAQ Radio Voice Communication
echo "Testing DAQ Radio Voice Communication Setup..."

# Check if Murmur container is running
if docker ps | grep -q murmur; then
    echo "✓ Murmur server container is running"
else
    echo "✗ Murmur server container is not running"
    echo "  Start it with: docker-compose up -d murmur"
    exit 1
fi

# Check if port 64738 is open
if nc -z localhost 64738 2>/dev/null; then
    echo "✓ Murmur port 64738 is accessible"
else
    echo "✗ Murmur port 64738 is not accessible"
    echo "  Check firewall settings and container logs"
    exit 1
fi

# Check base station CAN receiver
if docker ps | grep -q base-station; then
    echo "✓ Base station service is running"
else
    echo "✗ Base station service is not running"
    echo "  Start it with: cd base-station && docker-compose up -d"
fi

# Check car service
if docker ps | grep -q car_car; then
    echo "✓ Car service is running"
else
    echo "✗ Car service is not running"
    echo "  Start it with: cd car && docker-compose up -d"
fi

echo ""
echo "Voice communication setup test complete!"
echo "Next steps:"
echo "1. Install Mumble client: https://www.mumble.info/downloads/"
echo "2. Connect to server: localhost:64738"
echo "3. Test voice communication between car and base station"