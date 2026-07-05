# Kvaser Bridge

A GUI app that bridges a Kvaser CAN adapter to the DAQ Radio dashboard via WebSocket.

```
Kvaser hardware
    |  (python-can / Kvaser CANlib)
    v
kvaser-bridge (this app)
    |  JSON over WebSocket
    v
DAQ Radio pecan dashboard
```

## Prerequisites

- Python 3.10+
- [Kvaser CANlib SDK](https://kvaser.com/download/)
- tkinter (included with most Python installations)

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python src/main.py
```

A small window appears with:
- **Channel** - select which Kvaser CAN channel to use
- **Bitrate** - CAN bus bitrate (default 500k)
- **WS URL** - WebSocket URL of the dashboard (default `wss://127.0.0.1:9081`; TLS is on by default)
- **Start/Stop Bridge** - toggle the connection

Click **Start Bridge** to begin streaming CAN frames to the dashboard.

### Trusting the certificate (first run)

The bridge serves a self-signed TLS certificate over `wss://`, so the browser dashboard will refuse the connection until that certificate is trusted:

- **Windows**: click **Trust Certificate (Automatic)** to install it into the current-user Root store (no admin rights needed; works for Chrome/Edge). Use **Manual…** instead for Firefox, or if the automatic install fails.
- **Other platforms**: click **Trust Certificate** to open the bridge URL in the browser, then click through **Advanced → Proceed** and wait for the green "Certificate trusted" confirmation page.

Do this once per machine/browser before starting the bridge.

## Build (standalone binary)

```bash
# Linux
pyinstaller build.spec

# Windows
pyinstaller build.spec
```

Output binary is in `dist/kvaser-bridge` (or `dist/kvaser-bridge.exe`).

## Architecture

| File | Purpose |
|------|---------|
| `src/main.py` | Entry point; starts asyncio loop + tkinter GUI |
| `src/bridge.py` | Core Kvaser CAN -> WebSocket bridge (asyncio) |
| `src/tray.py` | tkinter GUI window |
| `src/config.py` | Bitrate options, defaults, config persistence |
