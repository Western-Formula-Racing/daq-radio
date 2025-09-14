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
lock = threading.Lock()  # For thread-safe access to CAN_MESSAGES

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

def named_pipe_listener():
    """Read CAN messages from named pipe."""
    pipe_path = "/tmp/can_data_pipe"
    while True:
        try:
            # Open pipe for reading
            with open(pipe_path, 'r') as pipe:
                print(f"Connected to named pipe: {pipe_path}")
                for line in pipe:
                    line = line.strip()
                    if line:
                        print(f"Received line: {line}")  # Debug print
                        try:
                            msg = json.loads(line)
                            can_id = msg['id']
                            raw_data = bytes(msg['data'])
                            # Use the timestamp from the message, convert UTC to local time
                            timestamp = datetime.fromtimestamp(msg['time'] / 1000, tz=timezone.utc).astimezone()
                            decoded = decode_can_message(can_id, raw_data)
                            decoded['timestamp'] = timestamp.isoformat()
                            with lock:
                                CAN_MESSAGES.append(decoded)
                                if len(CAN_MESSAGES) > MESSAGE_HISTORY_LIMIT:
                                    CAN_MESSAGES.pop(0)
                            print(f"Added message: CAN ID {can_id}, Raw Data {raw_data}")  # Debug print
                        except Exception as e:
                            print(f"Error parsing CAN message: {e}")
        except Exception as e:
            print(f"Named pipe listener error: {e}")
            time.sleep(5)  # Retry after 5 seconds

@dash_app.callback(
    Output('messages-table', 'data'),
    Input('interval-component', 'n_intervals'),
    State('time-range', 'value'),
    State('can-id-filter', 'value'),
    State('message-name-filter', 'value')
)
def update_table(n, time_range, can_id, message_name):
    with lock:
        messages = CAN_MESSAGES[:]
    # Debug: print current messages count
    print(f"Update table called. Total messages: {len(messages)}, Time range: {time_range}")
    
    # Use a more lenient time filter - default to 600 seconds (10 minutes) if time_range is small
    time_range = max(time_range or 60, 600)
    local_tz = datetime.now().astimezone().tzinfo
    cutoff_time = datetime.now(local_tz) - timedelta(seconds=time_range)
    
    filtered = []
    for msg in messages:
        msg_time = datetime.fromisoformat(msg['timestamp'])
        time_ok = msg_time >= cutoff_time
        id_ok = not can_id or str(msg['can_id']) == can_id
        name_ok = not message_name or msg['message_name'] == message_name
        
        if time_ok and id_ok and name_ok:
            filtered.append(msg)
    
    print(f"Filtered messages: {len(filtered)}")
    print(f"Filtered messages: {len(filtered)}")
    
    # Reverse the order to show newest messages first
    filtered = filtered[::-1]
    
    # Limit to last 100 messages to prevent overload
    # filtered = filtered[-10:] if len(filtered) > 20 else filtered
    # Create display data without modifying originals
    display_data = []
    for msg in filtered:
        display_msg = msg.copy()
        display_msg['timestamp'] = datetime.fromisoformat(msg['timestamp']).strftime('%H:%M:%S')
        display_msg['signals'] = json.dumps([{'name': k, 'value': v.value if hasattr(v, 'value') else str(v)} for k, v in msg['signals'].items()])
        display_msg['raw_data'] = ' '.join(f'{b:02X}' for b in msg['raw_data'])
        display_data.append(display_msg)
    
    print(f"Returning {len(display_data)} display messages")
    return display_data

dash_app.layout = html.Div(style={'backgroundColor': '#DEB887', 'padding': '20px'}, children=[
    html.H1("Peacan CAN Viewer", style={'color': '#8B4513', 'textAlign': 'center'}),
    dcc.Interval(id='interval-component', interval=2000, n_intervals=0),
    html.Div([
        html.Label("Time Range (seconds):", style={'color': '#8B4513'}),
        dcc.Input(id='time-range', type='number', value=600, min=1, max=3600, style={'marginLeft': '10px'}),
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
    # Start named pipe listener thread
    threading.Thread(target=named_pipe_listener, daemon=True).start()
    app.run(debug=True, host='0.0.0.0', port=9998)