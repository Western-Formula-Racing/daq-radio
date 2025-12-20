# Universal Telemetry Software

This is a unified firmware/software for both the Car (Source) and Base Station (Sink) of the DAQ system. It is optimized for use with Ubiquiti radios, using UDP for low-latency streaming and TCP for reliability.

## Features
- **Auto-detection**: Automatically detects if a CAN interface (`can0`) is present.
  - Presence of `can0` -> **Car Mode** (reads CAN, sends UDP).
  - Absence of `can0` -> **Base Station Mode** (receives UDP, publishes to Redis).
- **Batching**: Sends 20 messages or every 50ms to minimize radio overhead.
- **Reliability**:
  - **1-minute Ring Buffer** on the car.
  - **Sequence Tracking** on the base station.
  - **TCP Retransmission**: Every 10s, the base station requests missing packets from the car.
- **Frontend Integration**: Publishes JSON messages to Redis for the `redis_ws_bridge`.

## RPi Setup (CAN)
Ensure your CAN hat (e.g., MCP2515) is configured in `/boot/config.txt`:
```text
dtparam=spi=on
dtoverlay=mcp2515-can0,oscillator=16000000,interrupt=25
```
Then initialize the interface:
```bash
sudo ip link set can0 up type can bitrate 500000
```

## Deployment
1. Set the `REMOTE_IP` in `docker-compose.yml` to the IP of the other side.
2. Run:
```bash
docker-compose up -d
```

## Environment Variables
- `ROLE`: `car`, `base`, or `auto` (default).
- `REMOTE_IP`: The IP address of the peer radio.
- `UDP_PORT`: Default `5005`.
- `TCP_PORT`: Default `5006`.
- `REDIS_URL`: Default `redis://localhost:6379/0`.
