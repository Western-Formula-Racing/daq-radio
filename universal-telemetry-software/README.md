# Universal Telemetry Software

**Complete DAQ telemetry system for Formula Racing vehicles**

This unified software runs on both the car and base station Raspberry Pis, automatically detecting its role and starting the appropriate services.

---

## 🎯 Features

### Car Mode (Auto-detected if `can0` present)
- ✅ CAN bus data acquisition (GPIO/can0)
- ✅ UDP streaming with batching (20 msgs/50ms)
- ✅ TCP retransmission server (60-second ring buffer)
- ✅ Audio/Video transmission (optional)
- ✅ Simulation mode for testing without hardware

### Base Station Mode (Auto-detected if no `can0`)
- ✅ UDP receiver with sequence tracking
- ✅ TCP client for missing packet recovery
- ✅ Redis publishing (`can_messages`, `system_stats`)
- ✅ **WebSocket bridge for PECAN dashboard** (port 9080)
- ✅ **Status monitoring HTTP server** (port 8080)
- ✅ Audio/Video reception (optional)
- ✅ InfluxDB logging (future)

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│      CAR (Raspberry Pi)         │         │     BASE (Raspberry Pi)         │
│                                 │         │                                 │
│  CAN Reader (can0/GPIO)         │         │  UDP Receiver                   │
│         ↓                       │         │         ↓                       │
│  UDP Sender (batch 20/50ms) ────┼────────→│  Redis Publisher                │
│         ↓                       │         │         ↓                       │
│  Ring Buffer (60 sec)           │         │  WebSocket Bridge (9080) ───┬──→│ PECAN (3000)
│         ↓                       │         │         ↓                   │   │
│  TCP Resend Server (5006)   ←───┼─────────┤  TCP Client (recovery)      │   │
│         ↓                       │         │         ↓                   │   │
│  WebSocket Bridge (9080) ───────┼─────────┼─→ Status HTTP Server (8080) │   │
│         ↓                       │         │         ↓                   │   │
│  PECAN Dashboard (3000)     ←───┼─────────┼─────────────────────────────┘   │
│         ↓                       │         │                                 │
│  Audio/Video TX (optional)  ────┼────────→│  Audio/Video RX (optional)      │
└─────────────────────────────────┘         └─────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Raspberry Pi 4/5 (both car and base)
- Docker and Docker Compose installed
- Network connection (LAN cable or Ubiquiti radios)

### Installation

**1. Clone repository on both RPis:**
```bash
git clone https://github.com/Western-Formula-Racing/daq-radio.git
cd daq-radio
git checkout telemetry-software
cd universal-telemetry-software
```

**2. Configure environment:**

Edit `docker-compose.yml` and set `REMOTE_IP` to the other RPi's IP address.

**Car RPi** (e.g., `192.168.1.10`):
```yaml
environment:
  - REMOTE_IP=192.168.1.20  # Base station IP
  - SIMULATE=true  # Use simulation until CAN GPIO ready
```

**Base RPi** (e.g., `192.168.1.20`):
```yaml
environment:
  - REMOTE_IP=192.168.1.10  # Car IP
```

**3. Deploy:**
```bash
docker-compose up -d
```

**4. Verify:**

On base station:
```bash
# Check logs
docker-compose logs -f

# Should see:
# - "Auto-detected Role: base"
# - "WebSocket server running at ws://0.0.0.0:9080"
# - "Serving status page at http://0.0.0.0:8080"
```

**5. Access interfaces:**
- **Status page**: `http://<base-ip>:8080` (or `http://<car-ip>:8080`)
- **PECAN dashboard**: `http://<base-ip>:3000` (or `http://<car-ip>:3000`)
- **WebSocket**: `ws://<base-ip>:9080` (or `ws://<car-ip>:9080`)

---

## 📊 Monitoring

### Status Monitoring Page (Port 8080)

Access from any device on the network: `http://<base-station-ip>:8080`

**Features:**
- 🟢 Real-time connection status
- 📊 Packet statistics (RX rate, loss %, recovery)
- 📈 Live packet rate chart (60-second history)
- ⏱️ Uptime and last message timestamp

**Perfect for:**
- Headless RPi monitoring via WiFi hotspot
- Quick health checks during testing
- Race day connection verification

### PECAN Dashboard (Port 3000)

The PECAN dashboard runs on **both car and base station** at port 3000, providing:
- Live CAN message visualization
- Real-time telemetry data display
- Automatic WebSocket connection to port 9080

**Access:**
- Car's dashboard: `http://<car-ip>:3000` (connects to car's hotspot)
- Base station's dashboard: `http://<base-ip>:3000`

**WebSocket Connection:**
Pecan automatically connects to the WebSocket bridge on the same host at port 9080. No configuration needed - it uses the browser's hostname.

---

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROLE` | `auto` | Force `car` or `base` mode (auto-detects based on `can0`) |
| `REMOTE_IP` | `192.168.1.100` | IP address of the other RPi |
| `UDP_PORT` | `5005` | Port for real-time UDP streaming |
| `TCP_PORT` | `5006` | Port for TCP retransmission |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string |
| `WS_PORT` | `9080` | WebSocket port for PECAN |
| `STATUS_PORT` | `8080` | HTTP port for status page |
| `SIMULATE` | `false` | Enable simulation mode (no CAN hardware) |
| `ENABLE_VIDEO` | `false` | Enable video streaming |
| `ENABLE_AUDIO` | `false` | Enable audio streaming |

### Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 5005 | UDP | CAN data streaming (batched) |
| 5006 | TCP | Packet retransmission requests |
| 6379 | TCP | Redis (internal) |
| 8080 | HTTP | Status monitoring page |
| 9080 | WebSocket | PECAN dashboard WebSocket connection |
| 3000 | HTTP | PECAN dashboard UI |


---

## 🔄 CI/CD Pipeline

### Automated Testing

Every push to the repository triggers a comprehensive CI/CD pipeline that:
- ✅ Builds all Docker containers
- ✅ Simulates car-to-base connection
- ✅ Verifies UDP data reception and Redis publishing
- ✅ Tests WebSocket broadcasting to PECAN
- ✅ Forces packet drops to simulate network issues
- ✅ Validates TCP retransmission and recovery

### Running Tests Locally

**Prerequisites:**
```bash
pip install pytest pytest-asyncio websockets redis requests
```

**Run the full test suite:**
```bash
cd universal-telemetry-software
./run_ci_tests.sh
```

This will:
1. Build the Docker image
2. Start car and base containers with Redis
3. Run 8 integration test scenarios
4. Report results and collect logs

**Expected output:**
```
✓ Test 1: Container Health - PASSED
✓ Test 2: UDP Data Flow - PASSED
✓ Test 3: Redis Publishing - PASSED
✓ Test 4: WebSocket Broadcasting - PASSED
✓ Test 5: Status HTTP Server - PASSED
✓ Test 6: Forced Packet Drop - PASSED
✓ Test 7: TCP Retransmission - PASSED
✓ Test 8: Packet Recovery - PASSED

All tests passed! ✓
```

### Test Coverage

The integration tests validate:

| Test | Description |
|------|-------------|
| **Container Health** | All containers start and roles are detected correctly |
| **UDP Data Flow** | Car sends simulated CAN data via UDP to base |
| **Redis Publishing** | Base publishes CAN messages to Redis channels |
| **WebSocket Broadcasting** | WebSocket server streams data to PECAN dashboard |
| **Status HTTP Server** | Status monitoring page is accessible |
| **Forced Packet Drop** | Network packet loss is detected (using iptables) |
| **TCP Retransmission** | Base requests missing packets via TCP |
| **Packet Recovery** | Car resends missing data from ring buffer |

### GitHub Actions

The CI workflow runs automatically on:
- Push to `main` or `telemetry-software` branches
- Pull requests to these branches

View workflow status: [GitHub Actions](https://github.com/Western-Formula-Racing/daq-radio/actions)

---

## 🧪 Testing


### Local Testing (Two RPis with LAN Cable)

**1. Connect RPis via Ethernet**

**2. Assign static IPs:**

Car RPi:
```bash
sudo ip addr add 192.168.1.10/24 dev eth0
```

Base RPi:
```bash
sudo ip addr add 192.168.1.20/24 dev eth0
```

**3. Update `docker-compose.yml` with IPs**

**4. Start services:**
```bash
# On both RPis
docker-compose up -d
```

**5. Monitor on base station:**

Terminal 1 - Docker logs:
```bash
docker-compose logs -f telemetry
```

Terminal 2 - Redis messages:
```bash
docker exec -it universal-telemetry-software-redis-1 redis-cli
> SUBSCRIBE can_messages
```

Browser - Status page:
```
http://192.168.1.20:8080
```

**6. Expected results:**
- ✅ Car logs show "Auto-detected Role: car"
- ✅ Base logs show "Auto-detected Role: base"
- ✅ Base logs show "Initial sequence: 1" (first packet received)
- ✅ Redis shows JSON messages flowing
- ✅ Status page shows green "Connected to Car"
- ✅ PECAN dashboard receives data

---

## 🏁 Production Deployment (Ubiquiti Radios)

**1. Configure radios in bridge mode**

**2. Assign static IPs to RPis:**
- Car: `192.168.1.10`
- Base: `192.168.1.20`

**3. Update `docker-compose.yml` with production IPs**

**4. Deploy:**
```bash
docker-compose up -d
```

**5. Set up WiFi hotspot on base station** (for status page access)

**6. Access status page from phone/tablet:**
```
http://192.168.1.20:8080
```

---

## 📝 Redis Channels

### `can_messages`
Published by base station, consumed by PECAN and status page.

**Format:** JSON array of CAN messages
```json
[
  {
    "time": 1234567890,
    "canId": 256,
    "data": [146, 86, 42, 123, 205, 255, 0, 0]
  },
  ...
]
```

### `system_stats`
Published by base station every 1 second.

**Format:** JSON object with packet statistics
```json
{
  "received": 45,    // Packets received this second
  "missing": 1,      // Packets missing this second
  "recovered": 0     // Packets recovered via TCP this second
}
```

---

## 🔍 Troubleshooting

### No data flowing

**Check 1:** Verify both containers running
```bash
docker-compose ps
```

**Check 2:** Check car logs for UDP sending
```bash
docker-compose logs telemetry | grep "UDP"
```

**Check 3:** Check base logs for UDP receiving
```bash
docker-compose logs telemetry | grep "Initial sequence"
```

**Check 4:** Verify network connectivity
```bash
ping <other-rpi-ip>
```

### WebSocket not connecting to PECAN

**Check 1:** Verify WebSocket bridge running
```bash
docker-compose logs telemetry | grep "WebSocket"
# Should see: "WebSocket server running at ws://0.0.0.0:9080"
```

**Check 2:** Test WebSocket connection
```bash
# From another machine
wscat -c ws://<base-ip>:9080
```

**Check 3:** Verify Redis has data
```bash
docker exec -it universal-telemetry-software-redis-1 redis-cli
> SUBSCRIBE can_messages
```

### Status page not loading

**Check 1:** Verify status server running
```bash
docker-compose logs telemetry | grep "StatusServer"
# Should see: "Serving status page at http://0.0.0.0:8080"
```

**Check 2:** Test HTTP server
```bash
curl http://<base-ip>:8080
```

---

## 🆚 Migration from Old Base Station Folder

This consolidated system **replaces** the old `base-station/` folder.

**What's different:**
- ✅ Single deployment (not two separate systems)
- ✅ Auto-role detection (car vs base)
- ✅ Integrated WebSocket bridge (no separate `redis_ws_bridge.py`)
- ✅ Built-in status monitoring page
- ✅ Complete car-side functionality (CAN reading, UDP/TCP)
- ✅ Unified configuration

**Migration:**
1. Deploy this unified system on both RPis
2. Delete old `base-station/` folder
3. Update PECAN to connect to port 9080

---

## 📦 File Structure

```
universal-telemetry-software/
├── main.py                    # Main orchestrator
├── src/
│   ├── data.py               # UDP/TCP + Redis (car & base)
│   ├── audio.py              # Audio streaming
│   ├── video.py              # Video streaming
│   ├── websocket_bridge.py   # Redis → WebSocket for PECAN
│   └── status_server.py      # HTTP server for status page
├── status/
│   └── index.html            # Status monitoring page
├── docker-compose.yml        # Deployment configuration
├── Dockerfile                # Container build
└── requirements.txt          # Python dependencies
```

---

## 🔮 Future Enhancements

- [ ] InfluxDB3 logging for `system_stats`
- [ ] Grafana dashboard for historical analysis
- [ ] Web-based configuration interface

---

## 📄 License

AGPL-3.0 - See LICENSE file for details.

---

**Built with ❤️ by Western Formula Racing**

London, Ontario, Canada 🇨🇦