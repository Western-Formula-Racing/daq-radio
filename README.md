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