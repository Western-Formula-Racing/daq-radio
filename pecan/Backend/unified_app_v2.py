#!/usr/bin/env python3

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
import subprocess

class Colors:
    """
    ANSI color codes for terminal output formatting.
    
    Provides color constants for different service types to create 
    Docker-style logging with visual service identification.
    """
    PECAN = '\033[36m'  # Cyan - for web service logs
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
        service_name (str): Name of the service (SYSTEM, PECAN, BASE)
        message (str): Log message to display
        color (str): ANSI color code for the service prefix
        
    Example:
        2025-09-14 01:48:03 [PECAN] Starting web server...
    """
    timestamp = get_timestamp()
    service_prefix = f"{color}{Colors.BOLD}[{service_name}]{Colors.RESET}"
    print(f"{timestamp} {service_prefix} {message}")

# Global shutdown event
shutdown_event = threading.Event()

def run_pecan_service():
    """
    Run the PECAN web application service in a separate thread.
    
    This function:
    1. Imports the Flask/Dash web application components
    2. Starts the web server on port 9998
    3. Handles DBC file loading for message decoding
    4. Provides real-time CAN data visualization
    
    The service runs continuously until the shutdown_event is set.
    All errors are caught and logged with appropriate service prefixes.
    """
    try:
        print_service_log("PECAN", "Importing PECAN modules...", Colors.PECAN)
        
        # Import app components
        from app import start_server
        
        print_service_log("PECAN", "Starting PECAN web server...", Colors.PECAN)
        # Start the Flask server
        start_server()
        
    except Exception as e:
        print_service_log("PECAN", f"Error in PECAN service: {e}", Colors.PECAN)

def run_base_service():
    """
    Run the base station service by launching base.py with --test flag.
    
    This function:
    1. Launches the base.py script with test mode enabled
    2. Monitors the subprocess and handles shutdown
    
    The base.py script handles:
    - UDP broadcasting on port 12345 for CAN data distribution
    - Time synchronization on port 12346
    - Named pipe creation for inter-service communication
    - DBC file loading for message decoding
    - Test mode with fake CAN message generation
    """
    try:
        print_service_log("BASE", "Initializing BASE station...", Colors.BASE)
        
        # Path to base.py script
        base_script_path = os.path.join(os.path.dirname(__file__), '..', 'base-station', 'base.py')
        
        print_service_log("BASE", f"Launching base.py with --test from {base_script_path}", Colors.BASE)
        
        # Launch base.py --test as subprocess
        base_process = subprocess.Popen(
            ['python3', base_script_path, '--test'],
            cwd=os.path.dirname(base_script_path),  # Run from base-station directory
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        print_service_log("BASE", "Base station launched successfully", Colors.BASE)
        
        # Keep base service alive and monitor subprocess
        while not shutdown_event.is_set():
            if base_process.poll() is not None:
                # Process has terminated
                stdout, stderr = base_process.communicate()
                if stdout:
                    print_service_log("BASE", f"Base process stdout: {stdout.strip()}", Colors.BASE)
                if stderr:
                    print_service_log("BASE", f"Base process stderr: {stderr.strip()}", Colors.BASE)
                print_service_log("BASE", "Base process terminated", Colors.BASE)
                break
            time.sleep(1)
            
        # Terminate subprocess on shutdown
        if base_process.poll() is None:
            base_process.terminate()
            try:
                base_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                base_process.kill()
            print_service_log("BASE", "Base process terminated", Colors.BASE)
            
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
    3. Starts PECAN web service in a separate thread
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
    
    print_service_log("SYSTEM", "Starting PECAN Combined CAN Dashboard Application", Colors.SYSTEM)
    print_service_log("SYSTEM", f"Platform: {platform.system()} {platform.machine()}", Colors.SYSTEM)
    print_service_log("SYSTEM", "Services: Web App (localhost:9998) + Base Station (CAN broadcasting)", Colors.SYSTEM)
    print_service_log("SYSTEM", "Press Ctrl+C to stop all services", Colors.SYSTEM)
    print()

    try:
        # Start PECAN web app in a separate thread
        print_service_log("SYSTEM", "Starting PECAN web application...", Colors.SYSTEM)
        pecan_thread = threading.Thread(target=run_pecan_service, daemon=True)
        pecan_thread.start()
        
        # Give PECAN a moment to start
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
            if pecan_thread.is_alive():
                pecan_status = "✓"
            else:
                pecan_status = "✗"
                
            if base_thread.is_alive():
                base_status = "✓"
            else:
                base_status = "✗"
                
            # Print status every 30 seconds
            if int(time.time()) % 30 == 0:
                print_service_log("SYSTEM", f"Status - PECAN: {pecan_status} BASE: {base_status}", Colors.SYSTEM)
                
            time.sleep(1)
            
    except KeyboardInterrupt:
        signal_handler(signal.SIGINT, None)
    except Exception as e:
        print_service_log("SYSTEM", f"Unexpected error: {e}", Colors.SYSTEM)
    finally:
        shutdown_event.set()

if __name__ == "__main__":
    main()