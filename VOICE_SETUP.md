# DAQ Radio System - Voice Communication Setup

This system now includes two-way voice communication using Murmur (Mumble server) alongside the existing CAN data transmission.

## Prerequisites

- Docker and Docker Compose installed (for containerized setup)
- Mumble client installed on both car and base station
- Python 3.9+ with required packages (python-can, cantools)

## Voice Communication Setup

### Option 1: Using Docker (Recommended)

1. **On the base station:**
```bash
cd base-station
docker compose up -d
```

This will start both the base station CAN receiver and the Murmur voice server.

2. **Test the setup:**
```bash
cd ..
./test_voice.sh
```

### Option 2: Manual Setup (Without Docker)

1. **Install Murmur server:**
   - On Ubuntu/Debian: `sudo apt install mumble-server`
   - On macOS: `brew install murmur`
   - On Windows: Download from https://www.mumble.info/downloads/

2. **Configure Murmur:**
   - Copy `base-station/murmur.ini` to your Murmur configuration directory
   - Start Murmur service

3. **Run Python services:**
   - Base station: `cd base-station && python base.py`
   - Car: `cd car && python car.py`

### Connecting to Voice Chat

1. Install Mumble client on both car and base station computers:
   - Download from: https://www.mumble.info/downloads/

2. **Quick Setup (Recommended):**
   - Copy `mumble_config.ini` to your Mumble configuration directory
   - On macOS: `~/Library/Application Support/Mumble/`
   - On Windows: `%APPDATA%\Mumble\`
   - On Linux: `~/.config/Mumble/`

3. **Manual Setup:**
   - Launch Mumble client
   - Click "Server" → "Connect"
   - Add new server with:
     - Label: DAQ Radio System
     - Address: localhost (or base station IP)
     - Port: 64738
     - Username: Choose "Car" or "Base Station"

4. **Audio Configuration:**
   - Go to Settings → Audio Input/Output
   - Select appropriate input/output devices
   - Enable echo cancellation and noise suppression
   - Set transmission mode to "Push To Talk" (PTT)
   - Configure PTT button (default: Spacebar)

### Testing Voice Communication

1. Start both car and base station services
2. Connect Mumble clients from both sides
3. Test voice communication while monitoring CAN data
4. Run the integration monitor: `python monitor_integration.py`

## Integration Notes

- Voice communication runs independently of CAN data transmission
- Both systems use UDP for low-latency communication
- Voice server runs on port 64738, CAN data on port 12345
- Use `monitor_integration.py` to check status of both systems

## Integration Notes

- Voice communication runs independently of CAN data transmission
- Both systems use UDP for low-latency communication
- Voice server runs on port 64738, CAN data on port 12345

## Troubleshooting

- If voice connection fails, check firewall settings for port 64738
- Ensure Docker containers have network access
- Check Murmur logs: `docker compose logs murmur`
- Test connectivity: `./test_voice.sh`

## Advanced Configuration

### Running Murmur on Car Side
If you need the car to also run its own Murmur server:
```bash
cd car
# Uncomment the murmur service in docker-compose.yml
docker compose up -d murmur
```

### Custom Murmur Configuration
Edit `base-station/murmur.ini` to customize:
- Server password
- Maximum users
- Bandwidth limits
- Welcome message