from flask import Flask, request, jsonify
import dash
from dash import html, dcc, Input, Output, State
import dash_table
import cantools
import os
import time
import socket
import threading
import json
from datetime import datetime, timedelta, timezone

app = Flask(__name__)
dash_app = dash.Dash(__name__, server=app, routes_pathname_prefix='/dash/')

# ─── CONFIG ────────────────────────────────────────────────────────────────
DBC_FILE = os.getenv("DBC_FILE", "dbc_files/WFR25-6389976.dbc")
CAN_MESSAGES = []  # Store decoded CAN messages
MESSAGE_HISTORY_LIMIT = 1000

# ─── LOAD DBC ──────────────────────────────────────────────────────────────
try:
    db = cantools.database.load_file(DBC_FILE)
    print(f"DBC file loaded successfully: {DBC_FILE}")
except Exception as e:
    print(f"Failed to load DBC file: {DBC_FILE} - {e}")
    raise SystemExit(f"Failed to load DBC file: {e}")

def decode_can_message(can_id, data):
    """Decode CAN message using DBC."""
    try:
        msg = db.get_message_by_frame_id(can_id)
        decoded = msg.decode(data, allow_truncated=True)
        return {
            'can_id': can_id,
            'message_name': msg.name,
            'signals': decoded,
            'raw_data': list(data)
        }
    except Exception as e:
        return {
            'can_id': can_id,
            'message_name': 'Unknown',
            'signals': {},
            'raw_data': list(data),
            'error': str(e)
        }

def tcp_listener():
    """Connect to CANserver TCP and listen for messages."""
    while True:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect(('127.0.0.1', 54701))
            print("Connected to CANserver on port 54701")
            buffer = ""
            while True:
                data = sock.recv(1024)
                if not data:
                    break
                buffer += data.decode('utf-8')
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    if line.strip():
                        print(f"Received line: {line}")  # Debug print
                        try:
                            msg = json.loads(line)
                            can_id = msg['id']
                            raw_data = bytes(msg['data'])
                            # Use the timestamp from the message, convert UTC to local time
                            timestamp = datetime.fromtimestamp(msg['time'], tz=timezone.utc).astimezone()
                            decoded = decode_can_message(can_id, raw_data)
                            decoded['timestamp'] = timestamp.isoformat()
                            CAN_MESSAGES.append(decoded)
                            print(f"Added message: CAN ID {can_id}, Raw Data {raw_data}")  # Debug print
                            if len(CAN_MESSAGES) > MESSAGE_HISTORY_LIMIT:
                                CAN_MESSAGES.pop(0)
                        except Exception as e:
                            print(f"Error parsing CAN message: {e}")
            sock.close()
        except Exception as e:
            print(f"TCP listener error: {e}")
            time.sleep(5)  # Retry after 5 seconds

@dash_app.callback(
    Output('messages-table', 'data'),
    Input('interval-component', 'n_intervals'),
    State('time-range', 'value'),
    State('can-id-filter', 'value'),
    State('message-name-filter', 'value')
)
def update_table(n, time_range, can_id, message_name):
    # Make cutoff_time timezone-aware in local time
    local_tz = datetime.now().astimezone().tzinfo
    cutoff_time = datetime.now(local_tz) - timedelta(seconds=time_range or 60)
    filtered = [
        msg for msg in CAN_MESSAGES
        if datetime.fromisoformat(msg['timestamp']) >= cutoff_time and
           (not can_id or str(msg['can_id']) == can_id) and
           (not message_name or msg['message_name'] == message_name)
    ]
    # Limit to last 100 messages to prevent overload
    # filtered = filtered[-10:] if len(filtered) > 20 else filtered
    # Create display data without modifying originals
    display_data = []
    for msg in filtered:
        display_msg = msg.copy()
        display_msg['timestamp'] = datetime.fromisoformat(msg['timestamp']).strftime('%H:%M:%S')
        display_msg['signals'] = json.dumps([{'name': k, 'value': v} for k, v in msg['signals'].items()])
        display_msg['raw_data'] = ' '.join(f'{b:02X}' for b in msg['raw_data'])
        display_data.append(display_msg)
    return display_data

dash_app.layout = html.Div(style={'backgroundColor': '#DEB887', 'padding': '20px'}, children=[
    html.H1("Peacan CAN Viewer", style={'color': '#8B4513', 'textAlign': 'center'}),
    dcc.Interval(id='interval-component', interval=2000, n_intervals=0),
    html.Div([
        html.Label("Time Range (seconds):", style={'color': '#8B4513'}),
        dcc.Input(id='time-range', type='number', value=10, min=1, max=3600, style={'marginLeft': '10px'}),
    ], style={'marginBottom': '10px'}),
    html.Div([
        html.Label("CAN ID Filter:", style={'color': '#8B4513'}),
        dcc.Input(id='can-id-filter', type='text', placeholder='e.g., 123', style={'marginLeft': '10px'}),
    ], style={'marginBottom': '10px'}),
    html.Div([
        html.Label("Message Name Filter:", style={'color': '#8B4513'}),
        dcc.Input(id='message-name-filter', type='text', placeholder='e.g., EngineData', style={'marginLeft': '10px'}),
    ], style={'marginBottom': '20px'}),
    dash_table.DataTable(
        id='messages-table',
        columns=[
            {'name': 'Timestamp', 'id': 'timestamp'},
            {'name': 'CAN ID', 'id': 'can_id'},
            {'name': 'Message Name', 'id': 'message_name'},
            {'name': 'Signals', 'id': 'signals'},
            {'name': 'Raw Data', 'id': 'raw_data'}
        ],
        style_table={'backgroundColor': '#F4A460', 'overflowX': 'auto'},
        style_header={'backgroundColor': '#D2691E', 'color': 'white'},
        style_cell={'minWidth': '80px', 'width': '120px', 'maxWidth': '200px', 'whiteSpace': 'normal', 'backgroundColor': '#FAF0E6', 'color': '#8B4513'},
        page_size=20
    )
])

@app.route("/api/import", methods=["POST"])
def import_can_message():
    data = request.get_json()
    can_id_str = data.get("id")
    raw_data = data.get("data")
    timestamp = datetime.now()

    if can_id_str and raw_data:
        try:
            can_id = int(can_id_str, 0)  # Handle hex or decimal
            data_bytes = bytes(raw_data)
            decoded = decode_can_message(can_id, data_bytes)
            decoded['timestamp'] = timestamp.isoformat()
            CAN_MESSAGES.append(decoded)

            # Limit the message history
            if len(CAN_MESSAGES) > MESSAGE_HISTORY_LIMIT:
                CAN_MESSAGES.pop(0)

            return jsonify(status="success"), 201
        except Exception as e:
            return jsonify(status="error", message=f"Decoding failed: {str(e)}"), 400
    return jsonify(status="error", message="Invalid data"), 400

@app.route("/")
def index():
    return dash_app.index()

if __name__ == "__main__":
    # Start TCP listener thread
    threading.Thread(target=tcp_listener, daemon=True).start()
    app.run(debug=True, host='0.0.0.0', port=9998)