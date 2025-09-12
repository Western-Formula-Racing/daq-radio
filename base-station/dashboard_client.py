import requests
import json
import time

# Configuration for Dashboard WiFi stream
DASHBOARD_IP = "192.168.4.1"
DASHBOARD_URL = f"http://{DASHBOARD_IP}/api/data"
UPDATE_INTERVAL = 0.5  # 500ms between requests

print("Base station: Reading processed telemetry from Dashboard WiFi stream...")

while True:
    try:
        # Fetch data from Dashboard API
        response = requests.get(DASHBOARD_URL, timeout=2)
        
        if response.status_code == 200:
            telemetry_data = response.json()
            
            print(f"Dashboard Telemetry:")
            print(f"  Timestamp: {telemetry_data.get('timestamp', 'N/A')}")
            print(f"  Pack Voltage: {telemetry_data.get('packVoltage', 'N/A')} V")
            print(f"  Vehicle Speed: {telemetry_data.get('vehicleSpeed', 'N/A')} km/h")
            print(f"  Max Cell Temp: {telemetry_data.get('maxCellTemp', 'N/A')}°C")
            print(f"  Vehicle State: {telemetry_data.get('vehicleState', 'N/A')}")
            print(f"  Motor RPM: {telemetry_data.get('motorRPM', 'N/A')}")
            print()
            
            # You could log this data to CSV, database, etc.
            
        else:
            print(f"Error: HTTP {response.status_code}")
            
    except requests.exceptions.RequestException as e:
        print(f"Connection error: {e}")
        
    except KeyboardInterrupt:
        break
        
    except Exception as e:
        print(f"Error: {e}")
        
    time.sleep(UPDATE_INTERVAL)

print("Base station stopped.")
