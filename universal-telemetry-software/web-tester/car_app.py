import os
import logging
import json
import redis
import threading
import time
import sys
# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst

from flask import Flask, render_template, Response
from flask_socketio import SocketIO, emit

from src.audio import AudioWebBridge

# Init GStreamer
Gst.init(None)

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Config
REMOTE_IP = os.getenv("REMOTE_IP", "127.0.0.1")
UDP_AUDIO_PORT = 5601

audio_bridge = None

@app.route('/')
def index():
    return render_template('car_index.html')

@socketio.on('connect')
def test_connect():
    print('Client connected')

@socketio.on('audio_chunk')
def handle_audio(data):
    # Uplink: Browser Mic -> GStreamer -> UDP
    if audio_bridge:
        audio_bridge.push_audio(data)

def on_audio_received(data):
    # Downlink: UDP -> GStreamer -> Browser Speaker
    socketio.emit('audio_out', data)

if __name__ == '__main__':
    # Start Audio Bridge
    audio_bridge = AudioWebBridge(REMOTE_IP, on_audio_received, port=UDP_AUDIO_PORT)
    audio_bridge.start()
    
    # Run
    # Car UI on port 5051
    socketio.run(app, host='0.0.0.0', port=5051, allow_unsafe_werkzeug=True)
