#!/usr/bin/env python3
"""
Voice-CAN Integration Monitor
Monitors both voice communication and CAN data transmission
"""

import socket
import time
import subprocess
import json
from datetime import datetime

def check_murmur_status():
    """Check if Murmur server is running and accessible"""
    try:
        # Try to connect to Murmur port
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('127.0.0.1', 64738))
        sock.close()
        return result == 0
    except:
        return False

def check_can_server():
    """Check if CAN server is responding"""
    try:
        # Try to connect to CAN server
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('127.0.0.1', 8085))
        sock.close()
        return result == 0
    except:
        return False

def get_docker_status():
    """Get status of Docker containers"""
    try:
        result = subprocess.run(['docker', 'ps', '--format', 'json'],
                              capture_output=True, text=True)
        containers = [json.loads(line) for line in result.stdout.strip().split('\n') if line]
        status = {}
        for container in containers:
            name = container.get('Names', '')
            if 'murmur' in name:
                status['murmur'] = container.get('State', 'unknown')
            elif 'base-station' in name:
                status['base_station'] = container.get('State', 'unknown')
            elif 'car' in name:
                status['car'] = container.get('State', 'unknown')
        return status
    except:
        return {}

def main():
    print("Voice-CAN Integration Monitor")
    print("=" * 40)

    while True:
        timestamp = datetime.now().strftime("%H:%M:%S")

        # Check services
        murmur_up = check_murmur_status()
        can_server_up = check_can_server()
        docker_status = get_docker_status()

        print(f"\n[{timestamp}] System Status:")
        print(f"  Murmur Voice Server: {'✓ UP' if murmur_up else '✗ DOWN'}")
        print(f"  CAN Data Server: {'✓ UP' if can_server_up else '✗ DOWN'}")

        if docker_status:
            print("  Docker Containers:")
            for name, state in docker_status.items():
                print(f"    {name}: {state}")

        # Check for active voice connections (basic)
        if murmur_up:
            try:
                # This is a simplified check - in production you'd use Murmur's Ice interface
                print("  Voice Status: Server running (connections not monitored)")
            except:
                pass

        time.sleep(5)  # Check every 5 seconds

if __name__ == "__main__":
    main()