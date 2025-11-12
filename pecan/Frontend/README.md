# PECAN Frontend

The PECAN (Performance Enhanced CAN Analysis Network) frontend consists of two web-based interfaces for visualizing and monitoring real-time CAN bus data from the Western Formula Racing vehicle.

## Overview

This directory contains two frontend implementations:

1. **pecan-live-dashboard** - A modern, feature-rich React dashboard with real-time telemetry visualization
2. **Flask-based CAN Viewer** - A lightweight web interface for raw CAN message inspection (static/templates)

## pecan-live-dashboard

A production-ready React + TypeScript + Vite application that provides real-time telemetry visualization with a sophisticated data processing pipeline.

### Features

- **Real-time Data Streaming**: WebSocket-based live telemetry from ESP32/base station
- **CAN Message Processing**: DBC file-based signal decoding using the `candied` library
- **Multiple Dashboard Views**:
  - Main Dashboard - Overview of all telemetry signals
  - Accumulator Monitor - Battery pack health and status
  - Charge Cart - Charging system monitoring
  - Settings - Configuration and preferences
- **High-Performance Architecture**: 
  - Centralized DataStore with efficient message deduplication
  - 60 FPS rendering target with performance monitoring
  - Automatic WebSocket reconnection with backoff
- **Modern UI**: 
  - Responsive design with Tailwind CSS
  - React Bootstrap components
  - Mobile-friendly hamburger navigation

### Technology Stack

- **Framework**: React 19.1.1 with TypeScript
- **Build Tool**: Vite 7.1.7
- **Styling**: Tailwind CSS 4.1, Bootstrap 5.3, React Bootstrap 2.10
- **CAN Processing**: candied 2.2.0
- **WebSocket**: ws 8.18.3
- **Routing**: react-router 7.9.3

### Architecture

#### WebSocket Service
The dashboard uses a centralized WebSocket service that maintains a persistent connection throughout the app lifecycle:

```
WebSocket (ESP32/Base Station) 
    ↓
WebSocketService.ts
    ↓
CAN Processor (DBC decoding)
    ↓
DataStore (state management)
    ↓
React Components (Dashboard, Accumulator, etc.)
```

**Key Benefits:**
- Single WebSocket connection shared across all pages
- Automatic reconnection with up to 5 retry attempts
- Seamless page navigation without connection loss
- Clean separation between data fetching and display logic

#### Data Flow
1. ESP32 sends CAN messages over WebSocket
2. WebSocketService receives and validates messages
3. CAN processor decodes signals using DBC file
4. DataStore updates with latest signal values
5. React hooks trigger component re-renders
6. UI updates at ~60 FPS

### Quick Start

#### Prerequisites
- Node.js 18+ and npm
- Access to a running PECAN backend or ESP32 WebSocket server

#### Development

```bash
cd pecan-live-dashboard

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173` (Vite default port).

#### Production Build

```bash
# Build optimized production bundle
npm run build

# Preview production build locally
npm run preview

# Or run production server (if production-server.js exists)
npm run prod
```

### Configuration

#### WebSocket Connection
Edit `src/services/WebSocketService.ts` to configure the WebSocket URL:

```typescript
// Development
const WS_URL = 'ws://localhost:8080/ws';

// Production (ESP32 Access Point)
const WS_URL = 'ws://192.168.4.1:8080/ws';
```

#### DBC File
Place your DBC file in the appropriate location and update the import in `src/utils/canProcessor.ts`:

```typescript
import dbcText from '../assets/your-dbc-file.dbc?raw';
```

### Project Structure

```
pecan-live-dashboard/
├── src/
│   ├── components/       # Reusable UI components
│   │   ├── DataCard.tsx
│   │   ├── Sidebar.tsx
│   │   └── ...
│   ├── pages/           # Route-based page components
│   │   ├── Dashboard.tsx
│   │   ├── Accumulator.tsx
│   │   └── ...
│   ├── services/        # Core services
│   │   └── WebSocketService.ts
│   ├── lib/            # State management
│   │   ├── DataStore.ts
│   │   └── useDataStore.ts
│   ├── utils/          # Utility functions
│   │   └── canProcessor.ts
│   ├── App.tsx         # Main app component
│   ├── routes.tsx      # Route configuration
│   └── main.tsx        # Entry point
├── public/             # Static assets
├── package.json
└── vite.config.ts
```

### Development Guidelines

- **Linting**: Run `npm run lint` before committing
- **Type Checking**: TypeScript strict mode is enabled
- **Performance**: Monitor FPS in browser console - target is 60 FPS
- **Testing**: Use the "Process Test Messages" button to inject test data

### Troubleshooting

**WebSocket Connection Issues:**
- Verify the backend/ESP32 is running and accessible
- Check WebSocket URL matches your deployment
- Monitor browser console for connection errors
- Service auto-reconnects with exponential backoff

**Build Errors:**
- Run `npm install` to ensure dependencies are current
- Clear `node_modules` and reinstall if issues persist
- Check TypeScript errors with `npm run build`

**Performance Issues:**
- Check FPS counter in dashboard
- Reduce message rate if CPU usage is high
- Monitor browser DevTools Performance tab

## Flask-based CAN Viewer

A lightweight, static HTML/CSS/JS interface served by the Flask backend for viewing raw CAN messages.

### Features

- Raw CAN message display in table format
- Time-based filtering (last X seconds)
- CAN ID and message name filtering
- Simple, fall-inspired color scheme
- No build step required

### Usage

This viewer is served by the Flask backend (`pecan/Backend/app.py` or related files) and accessible when the backend is running:

```bash
cd ../Backend
python app.py
```

Access at `http://127.0.0.1:5000` or the configured Flask port.

### Files

```
Frontend/
├── static/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       └── app.js
└── templates/
    └── index.html
```

### Customization

Edit the files directly - no build process needed:
- **Styling**: Modify `static/css/styles.css`
- **Behavior**: Update `static/js/app.js`
- **Layout**: Edit `templates/index.html`

## Choosing Between Frontends

### Use pecan-live-dashboard when:
- You need a full-featured dashboard with multiple views
- Real-time telemetry visualization is required
- Modern UI/UX is important
- You want decoded CAN signals (not just raw messages)
- Performance at scale is critical

### Use Flask CAN Viewer when:
- You need quick, simple raw message inspection
- No build tools are available
- Minimal dependencies are preferred
- You're debugging CAN communication
- Quick deployment is needed

## Backend Integration

Both frontends integrate with the PECAN backend:

- **pecan-live-dashboard**: Connects via WebSocket to receive live CAN data
- **Flask viewer**: Served by Flask and queries REST API for historical data

See `../Backend/README.md` for backend setup and API documentation.

## Contributing

1. Follow the existing code style and conventions
2. Test changes with real hardware when possible
3. Update this README if adding new features
4. Run linters before committing:
   ```bash
   cd pecan-live-dashboard && npm run lint
   ```

## License

Part of the Western Formula Racing DAQ Radio System.
