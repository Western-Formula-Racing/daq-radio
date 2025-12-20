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
- **Bidirectional Audio**: Low-latency voice comms using OPUS/UDP.

## Hardware Setup (RPi 5)

### 1. CAN Bus
Ensure your CAN hat (e.g., MCP2515) is configured in `/boot/config.txt`. Note that RPi 5 uses a different SPI controller sometimes, but standard overlays usually work:
```text
dtparam=spi=on
dtoverlay=mcp2515-can0,oscillator=16000000,interrupt=25
```
Initialize:
```bash
sudo ip link set can0 up type can bitrate 500000
```

### 2. Audio (No 3.5mm Jack)
The RPi 5 has no analog audio. You must use a digital interface.

#### Option A: I2S Audio HAT (Recommended for FSAE)
Use a HAT like the **WM8960** or **HiFiBerry**. These use the GPIO header, are mechanically secure, and have low latency.
1. Install drivers (see HAT vendor docs).
2. Check device index: `aplay -l` and `arecord -l`.
3. Configure Env Vars:
   ```bash
   export AUDIO_SOURCE="alsasrc device=hw:0,0"
   export AUDIO_SINK="alsasink device=hw:0,0"
   ```

#### Option B: USB Audio Adapter
Easiest to test, but **vibration risk** in car. Use hot glue or strain relief!
1. Plug in USB Sound Card.
2. Check device index: `aplay -l` (usually card 1).
3. Configure Env Vars:
   ```bash
   export AUDIO_SOURCE="alsasrc device=hw:1,0"
   export AUDIO_SINK="alsasink device=hw:1,0"
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
- `ENABLE_AUDIO`: `true` (default).
- `AUDIO_SOURCE`: GStreamer source element (default `autoaudiosrc`).
- `AUDIO_SINK`: GStreamer sink element (default `autoaudiosink`).