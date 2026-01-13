# Western Formula Racing - DAQ Radio System

A comprehensive telemetry and data acquisition system for real-time monitoring of formula racing vehicle performance. This system captures CAN bus data from the vehicle, transmits it to a base station, and visualizes it through an interactive web dashboard.

## 🏎️ Overview

The DAQ Radio system provides end-to-end telemetry for Western Formula Racing vehicles, enabling real-time monitoring of critical vehicle systems during testing and competition. The system consists of:

- **PECAN Dashboard**: Real-time web-based visualization of vehicle telemetry
- **Base Station**: Radio receiver and WebSocket bridge for telemetry data
- **Car Simulator**: Testing tools for development without physical hardware
- **Deployment Tools**: Docker-based hosting and production deployment

## 🏗️ System Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Vehicle    │         │     Base     │         │    PECAN     │
│   CAN Bus    │ ──RF──> │   Station    │ ──WS──> │  Dashboard   │
│              │         │   + Redis    │         │   (Web UI)   │
└──────────────┘         └──────────────┘         └──────────────┘
```

**Data Flow:**
1. Vehicle CAN bus messages are captured via radio transmission
2. Base station receives RF data and publishes to Redis
3. Redis-to-WebSocket bridge broadcasts messages to connected clients
4. PECAN dashboard visualizes data in real-time through customizable views

## 📦 Components

### PECAN Dashboard (`/pecan`)

A modern React + TypeScript web application for real-time telemetry visualization.

**Features:**
- Real-time CAN message visualization with WebSocket connection
- Customizable category-based filtering and color-coding
- Multiple view modes (cards, list, flow diagrams)
- Interactive charts and graphs using Plotly.js
- Built with Vite, React 19, and Tailwind CSS

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, React Bootstrap, Plotly.js

[📖 Detailed Documentation](./pecan/README.md)

### Base Station (`/base-station`)

Python-based receiver system that bridges radio telemetry to WebSocket clients.

**Components:**
- **Redis Message Queue**: Central message broker for telemetry data
- **WebSocket Bridge** (`redis_ws_bridge.py`): Broadcasts Redis messages to connected web clients
- **Docker Deployment**: Containerized setup with Redis included

**Tech Stack:** Python, Redis, WebSockets, Docker

### Car Simulator (`/car-simulate`)

Development and testing tools for simulating vehicle telemetry without physical hardware.

**Features:**
- **CSV Data Playback**: Replay recorded CAN data from CSV files
- **Persistent WebSocket Server**: Continuous data broadcasting for testing
- **WebSocket Sender**: Configurable data transmission scripts

**Includes:**
- Sample CAN data files (CSV format)
- Example DBC (CAN database) file for message definitions
- Docker Compose setup for isolated testing environment

### Host Demo (`/host-demo`)

Production deployment configuration for hosting the PECAN dashboard.

**Features:**
- Dockerized Nginx setup for static file serving
- SSL/HTTPS configuration support
- Domain hosting configuration (`pecan-demo.0001200.xyz`)

[📖 Deployment Guide](./host-demo/README.md)

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v18+) and npm
- **Python** 3.8+
- **Redis** server
- **Docker** and Docker Compose (for containerized deployment)

### Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Western-Formula-Racing/daq-radio.git
   cd daq-radio
   ```

2. **Start the complete system:**
   ```bash
   ./start_system.sh test
   ```

   This script will:
   - Start Redis server
   - Launch the base station receiver (in test mode)
   - Start the WebSocket bridge
   - Run the PECAN dashboard in development mode

3. **Access the dashboard:**
   Open your browser to `http://localhost:5173`

### Manual Setup (Individual Components)

#### PECAN Dashboard
```bash
cd pecan
npm install
npm run dev
```

#### Base Station
```bash
cd base-station
pip install -r requirements.txt
python redis_ws_bridge.py
```

#### Car Simulator
```bash
cd car-simulate
python websocket_sender.py
```

## 📊 CAN Message Categories

PECAN supports configurable message categorization through a simple text-based configuration file. This allows customization of message grouping and color-coding without code changes.

**Configuration:** `pecan/src/assets/categories.txt`

Example categories:
- VCU (Vehicle Control Unit)
- BMS (Battery Management System)
- INV (Inverter)
- TEST MSG

[📖 Category Configuration Guide](./pecan/CATEGORIES.md)

## 🐳 Docker Deployment

### Development Environment
```bash
cd car-simulate/persistent-broadcast
docker-compose up -d
```

### Production Deployment
```bash
cd host-demo
docker-compose up -d --build
```

## 🛠️ Development

### Project Structure
```
daq-radio/
├── pecan/              # React dashboard application
│   ├── src/
│   │   ├── components/ # React components
│   │   ├── pages/      # Page components
│   │   ├── services/   # WebSocket and data services
│   │   └── config/     # Category configuration
│   └── public/         # Static assets
├── base-station/       # Radio receiver and WebSocket bridge
├── car-simulate/       # Testing and simulation tools
├── host-demo/          # Production hosting configuration
└── start_system.sh     # Automated startup script
```

### Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, React Bootstrap
- **Visualization**: Plotly.js for interactive charts and graphs
- **Build Tools**: Vite
- **Backend**: Python, asyncio, WebSockets
- **Message Broker**: Redis
- **Data Format**: CAN bus (DBC files)
- **Deployment**: Docker, Docker Compose, Nginx

## 🤝 Contributing

Contributions are welcome! This project is maintained by the Western Formula Racing team.

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with the simulator
5. Submit a pull request

## 📝 License

This project is maintained by Western Formula Racing. Please contact the team for licensing information.

## 🔗 Related Resources

- **Live Demo**: [pecan-demo.0001200.xyz](https://pecan-demo.0001200.xyz)
- **WebSocket Server**: ws-wfr.0001200.xyz

## 📞 Support

For questions or issues, please contact the Western Formula Racing software team or open an issue on GitHub.

---

**Built with ❤️ by Western Formula Racing**
