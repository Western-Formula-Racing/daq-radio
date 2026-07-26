# Kvaser Bridge

A GUI/TUI/headless app that bridges a CAN adapter to the DAQ Radio dashboard over WebSocket. Despite the name, it's no longer Kvaser-only: on Linux it defaults to `socketcan` (no CANlib needed), on macOS to `maccan`, and only falls back to `kvaser` (which does require the Kvaser CANlib SDK) elsewhere — a `vcan` backend is also supported for testing without hardware.

```
CAN hardware (socketcan / kvaser / maccan / vcan)
    |  python-can
    v
kvaser-bridge (this app) -- runs its own WebSocket server
    |  JSON over WebSocket (wss:// by default)
    v
DAQ Radio pecan dashboard (connects to the bridge)
```

## Prerequisites

- Python 3.10+
- [Kvaser CANlib SDK](https://kvaser.com/download/) — only needed if you're actually using a Kvaser adapter (e.g. on Windows, where `kvaser` is the default interface)
- tkinter (included with most Python installations) — only needed for the GUI; the `--tui` and `--headless` modes don't require it

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python src/main.py            # GUI (default)
python src/main.py --tui      # terminal UI
python src/main.py --headless # no UI
python src/main.py --no-tls   # serve plain ws:// instead of wss://, defaults port to 9080
```

The GUI window has:
- **Interface** - `socketcan`/`vcan` on Linux, `maccan` on macOS, `kvaser` on Windows
- **Channel** - which CAN channel to use (integer index for Kvaser, interface name like `can0`/`vcan0` for socketcan/vcan)
- **Bitrate** - CAN bus bitrate (default 500k)
- **WS Port** - port the bridge's own WebSocket server listens on (default `9081`)
- **Connect to:** - read-only, shows the URL the dashboard should point at (`wss://127.0.0.1:<port>` by default)
- **Start/Stop Bridge** - toggle the connection

Click **Start Bridge** to begin streaming CAN frames to the dashboard.

Note the direction: the bridge runs the WebSocket **server**; the dashboard is the **client** that connects to it — not the other way around.

By default the bridge serves `wss://` using a bundled self-signed certificate (with a browser cert-trust page on first connect). Pass `--no-tls` to serve plain `ws://` instead (port then defaults to `9080`).

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
| `src/main.py` | Entry point; parses `--tui`/`--headless`/`--no-tls`, starts asyncio loop + chosen UI |
| `src/bridge.py` | Core CAN -> WebSocket bridge (asyncio), including the TLS WebSocket server |
| `src/tray.py` | tkinter GUI window |
| `src/tui.py` | Textual-based terminal UI (used with `--tui`, with a fallback if `tkinter`/Textual deps are unavailable) |
| `src/config.py` | Interface/bitrate/channel/port options, defaults, config persistence |
