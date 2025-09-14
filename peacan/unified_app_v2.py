#!/usr/bin/env python3
"""
PEACAN Dashboard - Unified CAN Viewer & Broadcasting System (Version 2)

This is the main entry point for the PEACAN Dashboard application, which combines 
both a CAN base station and web visualization interface in a single process using 
threading architecture.

Architecture:
- Main Thread: System monitoring, logging, and graceful shutdown handling
- PEACAN Thread: Flask/Dash web server on port 9998 with real-time dashboard
- BASE Thread: CAN broadcasting, UDP transmission, and test data generation

The application provides:
- Real-time CAN message visualization
- DBC file support for message decoding
- Named pipe communication between services
- Docker-style logging with color-coded service prefixes
- Cross-platform executable building with PyInstaller

Author: Western Formula Racing Team
Version: 2.0.0
Python: 3.8+
"""

import sys
import os
import threading
import time
import signal
from datetime import datetime
import platform
import socket
import json
import requests

class Colors:
    """
    ANSI color codes for terminal output formatting.
    
    Provides color constants for different service types to create 
    Docker-style logging with visual service identification.
    """
    PEACAN = '\033[36m'  # Cyan - for web service logs
    BASE = '\033[33m'    # Yellow - for base station logs  
    SYSTEM = '\033[35m'  # Magenta - for system lifecycle logs
    RESET = '\033[0m'    # Reset to default terminal color
    BOLD = '\033[1m'     # Bold text formatting

def get_timestamp():
    """
    Generate current timestamp in Docker-style format.
    
    Returns:
        str: Formatted timestamp string (YYYY-MM-DD HH:MM:SS)
    """
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def print_service_log(service_name, message, color=Colors.RESET):
    """
    Print message with Docker-style service prefix and timestamp.
    
    Args:
        service_name (str): Name of the service (SYSTEM, PEACAN, BASE)
        message (str): Log message to display
        color (str): ANSI color code for the service prefix
        
    Example:
        2025-09-14 01:48:03 [PEACAN] Starting web server...
    """
    timestamp = get_timestamp()
    service_prefix = f"{color}{Colors.BOLD}[{service_name}]{Colors.RESET}"
    print(f"{timestamp} {service_prefix} {message}")

# Global shutdown event
shutdown_event = threading.Event()

def run_peacan_service():
    """
    Run the PEACAN web application service in a separate thread.
    
    This function:
    1. Imports the Flask/Dash web application components
    2. Starts the web server on port 9998
    3. Handles DBC file loading for message decoding
    4. Provides real-time CAN data visualization
    
    The service runs continuously until the shutdown_event is set.
    All errors are caught and logged with appropriate service prefixes.
    """
    try:
        print_service_log("PEACAN", "Importing PEACAN modules...", Colors.PEACAN)
        
        # Import app components
        from app import start_server
        
        print_service_log("PEACAN", "Starting PEACAN web server...", Colors.PEACAN)
        # Start the Flask server
        start_server()
        
    except Exception as e:
        print_service_log("PEACAN", f"Error in PEACAN service: {e}", Colors.PEACAN)

def run_base_service():
    """
    Run the base station service with integrated CAN broadcasting logic.
    
    This function implements the base station functionality including:
    1. UDP broadcasting on port 12345 for CAN data distribution
    2. Time synchronization on port 12346
    3. Named pipe creation for inter-service communication
    4. DBC file loading for message decoding
    5. Test mode with fake CAN message generation
    
    The service runs continuously until shutdown_event is set.
    In test mode, generates fake CAN frames every second for demonstration.
    
    Network Configuration:
        - UDP_PORT: 12345 (CAN data broadcast)
        - TIME_SYNC_PORT: 12346 (time synchronization)
        - NAMED_PIPE_PATH: /tmp/can_data_pipe (inter-service communication)
        - HTTP_FORWARD_URL: http://127.0.0.1:8085/can (external forwarding)
    """
    try:
        print_service_log("BASE", "Initializing BASE station...", Colors.BASE)
        
        # Base station configuration
        UDP_PORT = 12345
        TIME_SYNC_PORT = 12346
        NAMED_PIPE_PATH = "/tmp/can_data_pipe"
        HTTP_FORWARD_URL = "http://127.0.0.1:8085/can"
        
        # Load DBC file with fallback paths
        try:
            import cantools
            # Try multiple DBC file locations for maximum compatibility
            dbc_paths = [
                'WFR25-6389976.dbc',                                    # Root directory
                'dbc_files/WFR25-6389976.dbc',                         # Subfolder
                os.path.join(os.path.dirname(__file__), 'WFR25-6389976.dbc'),  # Script directory
                os.path.join(os.path.dirname(__file__), 'dbc_files', 'WFR25-6389976.dbc')  # Script subdirectory
            ]
            
            db = None
            for dbc_path in dbc_paths:
                try:
                    if os.path.exists(dbc_path):
                        db = cantools.database.load_file(dbc_path)
                        print_service_log("BASE", f"DBC file loaded: {dbc_path}", Colors.BASE)
                        break
                except Exception as e:
                    continue
            
            if db is None:
                print_service_log("BASE", "No DBC file found - raw CAN data only", Colors.BASE)
                
        except ImportError:
            print_service_log("BASE", "cantools not available - raw CAN data only", Colors.BASE)
            db = None

        # Create UDP socket for CAN data broadcasting
        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        udp_sock.bind(('', UDP_PORT))
        
        # Create named pipe for inter-service communication
        try:
            if os.path.exists(NAMED_PIPE_PATH):
                os.unlink(NAMED_PIPE_PATH)
            os.mkfifo(NAMED_PIPE_PATH)
            print_service_log("BASE", f"Created named pipe: {NAMED_PIPE_PATH}", Colors.BASE)
        except Exception as e:
            print_service_log("BASE", f"Named pipe exists or error: {e}", Colors.BASE)

        print_service_log("BASE", f"Base station listening on UDP {UDP_PORT}", Colors.BASE)
        print_service_log("BASE", f"Named pipe: {NAMED_PIPE_PATH}", Colors.BASE)
        print_service_log("BASE", "TEST MODE: Sending fake CAN messages", Colors.BASE)

        # Test mode - generate fake CAN messages for demonstration
        def generate_test_data():
            """
            Generate fake CAN messages for testing and demonstration.
            
            Creates incrementing CAN frames with:
            - ID: 0x123 (291 decimal)
            - Data: [0x01, 0x02, counter, 0x04]
            - Timestamp: Current time in milliseconds
            
            Messages are sent to the named pipe every second.
            """
            frame_count = 0
            while not shutdown_event.is_set():
                try:
                    frame_count += 1
                    # Generate fake CAN frame with incrementing counter
                    fake_frame = {
                        "id": 0x123,
                        "data": [0x01, 0x02, frame_count & 0xFF, 0x04],
                        "time": int(time.time() * 1000)
                    }
                    
                    # Write to named pipe for PEACAN service consumption
                    try:
                        with open(NAMED_PIPE_PATH, 'w') as pipe:
                            json.dump(fake_frame, pipe)
                            pipe.write('\n')
                            pipe.flush()
                        print_service_log("BASE", f"Sent test CAN frame #{frame_count}", Colors.BASE)
                    except Exception as e:
                        print_service_log("BASE", f"Pipe write error: {e}", Colors.BASE)
                        
                    time.sleep(1)  # 1 Hz message rate
                except Exception as e:
                    print_service_log("BASE", f"Test data error: {e}", Colors.BASE)
                    time.sleep(1)

        # Start test data generation
        test_thread = threading.Thread(target=generate_test_data, daemon=True)
        test_thread.start()
        
        # Keep base service alive
        while not shutdown_event.is_set():
            time.sleep(1)
            
    except Exception as e:
        print_service_log("BASE", f"Error in BASE service: {e}", Colors.BASE)

def signal_handler(signum, frame):
    """
    Handle shutdown signals gracefully (SIGINT, SIGTERM).
    
    This function is called when the user presses Ctrl+C or when the system
    sends a termination signal. It ensures all services are stopped cleanly
    and resources are properly released.
    
    Args:
        signum (int): Signal number received
        frame: Current stack frame (unused)
    """
    print_service_log("SYSTEM", "Received shutdown signal, stopping services...", Colors.SYSTEM)
    shutdown_event.set()
    time.sleep(1)
    print_service_log("SYSTEM", "Shutdown complete", Colors.SYSTEM)
    os._exit(0)

def main():
    """
    Main application entry point and service orchestrator.
    
    This function:
    1. Sets up signal handlers for graceful shutdown
    2. Displays startup information and configuration
    3. Starts PEACAN web service in a separate thread
    4. Starts BASE station service in a separate thread  
    5. Monitors service health and displays status
    6. Handles shutdown coordination
    
    The main thread remains active to monitor the service threads and
    provide status updates every 30 seconds.
    """
    # Set up signal handler for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    if platform.system() != 'Windows':
        signal.signal(signal.SIGTERM, signal_handler)
    
    print_service_log("SYSTEM", "Starting PEACAN Combined CAN Dashboard Application", Colors.SYSTEM)
    print_service_log("SYSTEM", f"Platform: {platform.system()} {platform.machine()}", Colors.SYSTEM)
    print_service_log("SYSTEM", "Services: Web App (localhost:9998) + Base Station (CAN broadcasting)", Colors.SYSTEM)
    print_service_log("SYSTEM", "Press Ctrl+C to stop all services", Colors.SYSTEM)
    print()

    try:
        # Start PEACAN web app in a separate thread
        print_service_log("SYSTEM", "Starting PEACAN web application...", Colors.SYSTEM)
        peacan_thread = threading.Thread(target=run_peacan_service, daemon=True)
        peacan_thread.start()
        
        # Give PEACAN a moment to start
        time.sleep(3)
        
        # Start base station in a separate thread
        print_service_log("SYSTEM", "Starting BASE station in test mode...", Colors.SYSTEM)
        base_thread = threading.Thread(target=run_base_service, daemon=True)
        base_thread.start()
        
        # Give services time to initialize
        time.sleep(2)
        
        print_service_log("SYSTEM", "All services started successfully", Colors.SYSTEM)
        print_service_log("SYSTEM", "Web interface available at: http://localhost:9998", Colors.SYSTEM)
        print()
        
        # Keep main thread alive and monitor services
        while not shutdown_event.is_set():
            # Check if threads are still alive
            if peacan_thread.is_alive():
                peacan_status = "✓"
            else:
                peacan_status = "✗"
                
            if base_thread.is_alive():
                base_status = "✓"
            else:
                base_status = "✗"
                
            # Print status every 30 seconds
            if int(time.time()) % 30 == 0:
                print_service_log("SYSTEM", f"Status - PEACAN: {peacan_status} BASE: {base_status}", Colors.SYSTEM)
                
            time.sleep(1)
            
    except KeyboardInterrupt:
        signal_handler(signal.SIGINT, None)
    except Exception as e:
        print_service_log("SYSTEM", f"Unexpected error: {e}", Colors.SYSTEM)
    finally:
        shutdown_event.set()

if __name__ == "__main__":
    main()