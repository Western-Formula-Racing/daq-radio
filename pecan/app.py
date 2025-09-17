from flask import Flask, request, jsonify
import dash
from dash import html, dcc, Input, Output, State, dash_table
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
CAN_MESSAGES = []  # Store decoded CAN messages
MESSAGE_HISTORY_LIMIT = 1000  # Keep only the most recent 1000 messages
lock = threading.Lock()  # For thread-safe access to CAN_MESSAGES

# ─── LOAD DBC ──────────────────────────────────────────────────────────────
def load_dbc_file():
    """Load DBC file with multiple path fallbacks"""
    dbc_paths = [
        'WFR25-eeae9849.dbc',
        'dbc_files/WFR25-eeae9849.dbc',
        os.path.join(os.path.dirname(__file__), 'WFR25-eeae9849.dbc'),
        os.path.join(os.path.dirname(__file__), 'dbc_files', 'WFR25-eeae9849.dbc'),
        os.getenv("DBC_FILE", "dbc_files/WFR25-eeae9849.dbc")
    ]
    
    for dbc_path in dbc_paths:
        try:
            if os.path.exists(dbc_path):
                db = cantools.database.load_file(dbc_path)
                print(f"DBC file loaded successfully: {dbc_path}")
                return db
        except Exception as e:
            continue
    
    print("Warning: No DBC file found - raw CAN data only")
    return None

db = load_dbc_file()

if db:
    print(f"Loaded {len(db.messages)} messages from DBC:")
    for msg in db.messages:
        print(f"  ID: {msg.frame_id} ({hex(msg.frame_id)}), Name: {msg.name}")

def decode_can_message(can_id, data):
    """Decode CAN message using DBC."""
    if db is None:
        return {
            'can_id': can_id,
            'message_name': 'Raw',
            'signals': {},
            'raw_data': list(data),
            'error': 'No DBC file loaded'
        }
    
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
        print(f"Failed to decode CAN ID {can_id} ({hex(can_id)}): {e}")
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
    message_count = 0
    while True:
        try:
            # Open pipe for reading
            with open(pipe_path, 'r') as pipe:
                print(f"Connected to named pipe: {pipe_path}")
                for line in pipe:
                    line = line.strip()
                    if line:
                        message_count += 1
                        if message_count % 100 == 0:
                            print(f"Processed {message_count} messages from pipe")
                        try:
                            msg = json.loads(line)
                            can_id = msg['id']
                            raw_data = bytes(msg['data'])
                            # Use the timestamp from the message, convert UTC to local time
                            original_timestamp = datetime.fromtimestamp(msg['time'] / 1000, tz=timezone.utc).astimezone()
                            received_timestamp = datetime.now()  # When we received it locally
                            
                            decoded = decode_can_message(can_id, raw_data)
                            decoded['timestamp'] = original_timestamp.isoformat()
                            decoded['received_timestamp'] = received_timestamp.isoformat()  # Track when we received it
                            
                            with lock:
                                CAN_MESSAGES.append(decoded)
                                if len(CAN_MESSAGES) > MESSAGE_HISTORY_LIMIT:
                                    CAN_MESSAGES.pop(0)
                                    print(f"Message limit reached ({MESSAGE_HISTORY_LIMIT}), removed oldest message. Total: {len(CAN_MESSAGES)}")
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
    State('message-name-filter', 'value'),
    State('filter-mode', 'value')
)
def update_table(n, time_range, can_id, message_name, filter_mode):
    with lock:
        messages = CAN_MESSAGES[:]
    
    print(f"Update table called. Total messages: {len(messages)}, Time range: {time_range}, Filter mode: {filter_mode}")
    
    # Default values
    time_range = time_range or 600
    filter_mode = filter_mode or 'received_time'
    
    filtered = []
    
    if filter_mode == 'all':
        # Show all messages regardless of time
        filtered = messages
    elif filter_mode == 'count':
        # Show most recent N messages by count
        message_count = min(int(time_range), len(messages))
        filtered = messages[-message_count:]
    elif filter_mode == 'received_time':
        # Filter by when messages were received (not original timestamp)
        cutoff_time = datetime.now() - timedelta(seconds=time_range)
        for msg in messages:
            received_time = datetime.fromisoformat(msg['received_timestamp'])
            if received_time >= cutoff_time:
                filtered.append(msg)
    else:  # original_time
        # Filter by original message timestamp
        local_tz = datetime.now().astimezone().tzinfo
        cutoff_time = datetime.now(local_tz) - timedelta(seconds=time_range)
        for msg in messages:
            msg_time = datetime.fromisoformat(msg['timestamp'])
            if msg_time >= cutoff_time:
                filtered.append(msg)
    
    # Apply ID and name filters
    if can_id or message_name:
        temp_filtered = []
        for msg in filtered:
            id_ok = not can_id or str(msg['can_id']) == can_id
            name_ok = not message_name or msg['message_name'] == message_name
            if id_ok and name_ok:
                temp_filtered.append(msg)
        filtered = temp_filtered
    
    print(f"Filtered messages: {len(filtered)}")
    
    # Reverse to show newest first
    filtered = filtered[::-1]
    
    # Limit to prevent UI overload
    if len(filtered) > 100:
        filtered = filtered[:100]
    
    # Create display data
    display_data = []
    for msg in filtered:
        display_msg = msg.copy()
        # Show original timestamp in the table
        display_msg['timestamp'] = datetime.fromisoformat(msg['timestamp']).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        display_msg['signals'] = json.dumps([{'name': k, 'value': v.value if hasattr(v, 'value') else str(v)} for k, v in msg['signals'].items()] if msg['signals'] else [], indent=None)
        display_msg['raw_data'] = ' '.join(f'{b:02X}' for b in msg['raw_data'])
        display_data.append(display_msg)
    
    print(f"Returning {len(display_data)} display messages")
    return display_data

dash_app.layout = html.Div(style={'backgroundColor': '#DEB887', 'padding': '20px'}, children=[
    html.H1("Pecan CAN Viewer", style={'color': '#8B4513', 'textAlign': 'center'}),
    # Refresh interval - updates every second
    dcc.Interval(id='interval-component', interval=1000, n_intervals=0),
    
    html.Div([
        html.Label("Filter Mode:", style={'color': '#8B4513', 'marginRight': '10px'}),
        dcc.Dropdown(
            id='filter-mode',
            options=[
                {'label': 'By Received Time (Recommended)', 'value': 'received_time'},
                {'label': 'By Message Count', 'value': 'count'},
                {'label': 'By Original Timestamp', 'value': 'original_time'},
                {'label': 'Show All Messages', 'value': 'all'}
            ],
            value='received_time',
            style={'width': '300px', 'display': 'inline-block'}
        ),
    ], style={'marginBottom': '10px'}),
    
    html.Div([
        html.Label("Time Range (seconds) or Count:", style={'color': '#8B4513'}),
        dcc.Input(id='time-range', type='number', value=60, min=1, max=3600, style={'marginLeft': '10px'}),
        html.Span(" (For 'received_time'/'original_time': seconds ago, for 'count': number of messages)", 
                 style={'color': '#8B4513', 'fontSize': '12px', 'marginLeft': '10px'})
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
            {'name': 'Original Timestamp', 'id': 'timestamp'},
            {'name': 'CAN ID', 'id': 'can_id'},
            {'name': 'Message Name', 'id': 'message_name'},
            {'name': 'Signals', 'id': 'signals'},
            {'name': 'Raw Data', 'id': 'raw_data'}
        ],
        style_table={'backgroundColor': '#F4A460', 'overflowX': 'auto'},
        style_header={'backgroundColor': '#D2691E', 'color': 'white'},
        style_cell={'minWidth': '80px', 'width': '120px', 'maxWidth': '300px', 'whiteSpace': 'normal', 'backgroundColor': '#FAF0E6', 'color': '#8B4513'},
        page_size=20
    )
])

@app.route("/api/import", methods=["POST"])
def import_can_message():
    data = request.get_json()
    can_id_str = data.get("id")
    raw_data = data.get("data")
    # Use timestamp from request if provided, otherwise use current time
    if "time" in data:
        original_timestamp = datetime.fromtimestamp(data["time"] / 1000, tz=timezone.utc).astimezone()
    else:
        original_timestamp = datetime.now()
    
    received_timestamp = datetime.now()

    if can_id_str and raw_data:
        try:
            can_id = int(can_id_str, 0)  # Handle hex or decimal
            data_bytes = bytes(raw_data)
            decoded = decode_can_message(can_id, data_bytes)
            decoded['timestamp'] = original_timestamp.isoformat()
            decoded['received_timestamp'] = received_timestamp.isoformat()
            
            with lock:
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

def start_server():
    """Start the Flask server and named pipe listener"""
    print("Starting PECAN web application...")
    print("Starting named pipe listener...")
    # Start named pipe listener thread
    threading.Thread(target=named_pipe_listener, daemon=True).start()
    print(f"Starting Flask server on http://0.0.0.0:9998")
    app.run(debug=False, host='0.0.0.0', port=9998, use_reloader=False)

if __name__ == "__main__":
    start_server()