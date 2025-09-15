# WFR DAQ Radio System

Western Formula Racing Data Acquisition and Radio Communication System

## Environment Setup

This project uses the existing **carThings** conda environment.

### VS Code Configuration

The workspace is configured to:
- Automatically activate the carThings environment in new terminals
- Use the carThings Python interpreter by default
- Apply custom color scheme for WFR branding

### Manual Activation

If needed, activate the environment manually:
```bash
conda activate carThings
```

## Project Structure

```
daq-radio/
├── base-station/          # Base station Python scripts
│   ├── base.py           # Main base station server
│   ├── Dockerfile        # Docker configuration
│   └── WFR25-6389976.dbc # CAN database file
├── car/                  # Car-side Python scripts
│   ├── car.py           # CAN data collection
│   ├── Dockerfile       # Docker configuration
│   └── setup_and_run.sh # Setup script
├── .conda/              # Conda environment configuration
├── .vscode/             # VS Code workspace settings
└── SAVVYCAN_README.md   # SavvyCAN integration guide
```

## Key Components

### Base Station
- Receives CAN messages from car via UDP
- Forwards data to web interface and SavvyCAN
- Supports DBC file decoding
- Runs on Raspberry Pi or similar

### Car System
- Collects CAN bus data
- Transmits data to base station
- Supports both real CAN hardware and CSV simulation

### SavvyCAN Integration
- Real-time CAN monitoring and analysis
- UDP forwarding on port 12347
- Compatible with existing web interface

## Usage

1. **Start Base Station:**
   ```bash
   cd base-station
   python base.py
   ```

2. **Start Car System:**
   ```bash
   cd car
   python car.py
   ```

3. **Connect SavvyCAN:**
   - Follow instructions in `SAVVYCAN_README.md`
   - Use UDP connection on port 12347

## Dependencies

- Python 3.11+
- cantools (for DBC file support)
- python-can (for CAN bus communication)
- flask (for web interface)
- requests (for HTTP communication)

## Development

- Environment: carThings (conda)
- Python: 3.11
- VS Code workspace configured for automatic environment activation

## Troubleshooting

### Environment Issues
- **VS Code not using carThings:** Reload the workspace or restart VS Code
- **Missing packages:** Run `conda env update -f .conda/environment.yml`
- **Permission issues:** Ensure conda is properly installed and accessible

### Network Issues
- **UDP connection problems:** Check firewall settings for ports 12345-12347
- **Broadcast issues:** Ensure devices are on the same network segment

## Contributing

1. Activate the carThings environment
2. Make your changes
3. Test with both real hardware and simulation modes
4. Update documentation as needed
=======
pecan
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

### 4. Message Processing (Pecan App)
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
   cd pecan
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
>>>>>>> pecan-branch
