# CAN Viewer Project

This project is a CAN (Controller Area Network) viewer built using Flask and Dash. It allows users to visualize raw CAN messages, import DBC files, and filter messages based on time range and CAN ID or message name. The application features a warm, brownish color scheme to evoke a fall vibe.

## Project Structure

```
peacan
├── app.py                # Main entry point of the Flask application
├── requirements.txt      # List of dependencies for the project
├── static
│   ├── css
│   │   └── styles.css    # CSS styles for the application
│   └── js
│       └── app.js        # JavaScript code for client-side interactions
├── templates
│   └── index.html        # Main HTML template for the application
├── dbc_files
│   └── example.dbc       # Example DBC file for testing
└── README.md             # Documentation for the project
```

## Features

- **Real-time CAN Message Display**: View raw CAN messages as they are received.
- **DBC File Import**: Import DBC files to decode CAN messages and signals.
- **Filtering Options**: Filter messages by time range (past X seconds) and by CAN ID or message name.
- **User-Friendly Interface**: A clean and intuitive interface with a fall-inspired color scheme.

## Timestamp Pipeline

This CAN viewer is part of a distributed timestamping system that ensures accurate, synchronized timing across multiple components. Here's how the timestamp pipeline works:

### 1. Time Synchronization (Base Station → ESP32)
- **Base Station** (`base-station/base.py`): Runs a background thread that broadcasts the current Unix timestamp (milliseconds since epoch) every second via UDP to port 12346
- **ESP32** (`Dashboard/src/CAN_Broadcast.cpp`): Receives time sync packets and sets its system clock using `settimeofday()`
- **Result**: ESP32's internal clock is synchronized with the base station's time

### 2. CAN Message Timestamping (ESP32)
- When CAN messages are received, they are buffered with timestamps from the synchronized ESP32 clock
- Each message includes a `timestamp` field containing milliseconds since Unix epoch (UTC)
- Messages are batched and sent as JSON over UDP to the base station

### 3. Message Forwarding (Base Station)
- **UDP Reception**: Base station receives JSON batches from ESP32
- **Named Pipe Output**: Messages are written to `/tmp/can_data_pipe` in CANserver-compatible format:
  ```json
  {"time": 1726310400000, "bus": 0, "id": 123, "data": [1, 2, 3, 4, 5, 6, 7, 8]}
  ```
- The original ESP32 timestamp is preserved in the `time` field

### 4. Message Processing (Peacan App)
- **Named Pipe Reading**: `named_pipe_listener()` thread reads JSON lines from the named pipe
- **Timestamp Conversion**: Timestamps are converted from Unix milliseconds to local timezone:
  ```python
  timestamp = datetime.fromtimestamp(msg['time'] / 1000, tz=timezone.utc).astimezone()
  ```
- **Storage**: Messages are stored with ISO format timestamps for filtering and display

### 5. Display and Filtering
- **Time-based Filtering**: Users can filter messages by time range (e.g., last 60 seconds)
- **Timezone Handling**: All timestamps are displayed in local time with microsecond precision
- **Absolute Time Preservation**: Original Unix timestamps ensure consistent timing across the distributed system

### Key Benefits
- **Synchronized Timing**: All components use the same time reference
- **Absolute Timestamps**: Unix epoch timestamps prevent clock drift issues
- **Timezone Awareness**: Automatic UTC→local conversion for user-friendly display
- **High Precision**: Millisecond accuracy with microsecond display precision

### API Integration
The `/api/import` endpoint also accepts timestamps:
- If `time` field is provided: Uses absolute Unix timestamp from request
- If no `time` field: Falls back to current server time

This pipeline ensures that CAN messages from distributed ESP32 devices maintain accurate, synchronized timing throughout the entire data collection and visualization system.

## Setup Instructions

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd peacan
   ```

2. **Install Dependencies**:
   Make sure you have Python installed, then run:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the Application**:
   Start the Flask server:
   ```bash
   python app.py
   ```

4. **Access the Application**:
   Open your web browser and navigate to `http://127.0.0.1:5000` to view the CAN viewer.

## Usage Guidelines

- Use the import functionality to load your DBC files.
- Enter the desired time range and CAN ID/message name to filter the displayed messages.
- The application will dynamically update the displayed data based on your filters.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.