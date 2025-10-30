import requests
import time
import json
import csv
import os

# URL for the WebSocket server endpoint
URL = 'http://localhost:8080/send'

# Path to the CAN data file (CSV format: timestamp,CAN,canId,data1,data2,data3,data4,data5,data6,data7,data8)
DATA_FILE = '2025-10-04-09-50-03.csv'  # Replace with the exact filename if different

def load_can_data(file_path):
    """Load CAN data from CSV file and format as JSON objects."""
    data = []
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} not found.")
        return data
    with open(file_path, 'r') as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 11 or row[1] != 'CAN':
                continue  # Skip invalid rows
            try:
                message = {
                    'time': int(row[0]),
                    'canId': int(row[2]),
                    'data': [int(x) for x in row[3:11]]  # 8 data bytes
                }
                data.append(message)
            except ValueError as e:
                print(f"Skipping invalid row: {row} - {e}")
    return data

def send_batch(batch):
    """Send a batch of CAN messages via POST."""
    try:
        response = requests.post(URL, json=batch, headers={'Content-Type': 'application/json'})
        if response.status_code == 200:
            print(f"Sent {len(batch)} messages successfully.")
        else:
            print(f"Error: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"Failed to send batch: {e}")

def main():
    can_data = load_can_data(DATA_FILE)
    if not can_data:
        return

    batch_size = 100
    interval = 1 / 5  # 5 Hz = 0.2 seconds

    index = 0
    while True:
        # Get the next batch of 100 messages, wrapping around if necessary
        batch = can_data[index:index + batch_size]
        if len(batch) < batch_size:
            # If not enough, take from the start
            batch += can_data[:batch_size - len(batch)]
        send_batch(batch)
        index = (index + batch_size) % len(can_data)
        time.sleep(interval)

if __name__ == '__main__':
    main()