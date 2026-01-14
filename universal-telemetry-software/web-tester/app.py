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

from flask import Flask, render_template, Response, send_from_directory
from flask_socketio import SocketIO, emit

from src.audio import AudioWebBridge

# Init GStreamer
Gst.init(None)

# Serve Pecan build from ../dist (mounted volume)
app = Flask(__name__, static_folder='../dist', static_url_path='/')
# Use threading mode for GStreamer compatibility
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Config
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
UDP_VIDEO_PORT = 5600
UDP_AUDIO_PORT = 5601
REMOTE_IP = os.getenv("REMOTE_IP", "127.0.0.1")

# Redis
try:
    redis_client = redis.from_url(REDIS_URL)
except:
    redis_client = None

# Global Video State
video_frame = None
video_lock = threading.Lock()

audio_bridge = None

# --- Video Receiver (UDP -> MJPEG) ---
class VideoReceiver:
    def __init__(self):
        self.pipeline = None

    def start(self):
        # UDP H264 -> Decode -> JPEG -> Appsink
        cmd = (
            f"udpsrc port={UDP_VIDEO_PORT} ! "
            f"application/x-rtp, payload=96 ! "
            f"rtph264depay ! "
            f"avdec_h264 ! "
            f"videoconvert ! "
            f"jpegenc quality=85 ! "
            f"appsink name=sink emit-signals=True"
        )
        self.pipeline = Gst.parse_launch(cmd)
        sink = self.pipeline.get_by_name('sink')
        sink.connect("new-sample", self.on_sample)
        self.pipeline.set_state(Gst.State.PLAYING)
        print("Video Receiver Started")

    def on_sample(self, sink):
        global video_frame
        sample = sink.emit("pull-sample")
        buf = sample.get_buffer()
        caps = sample.get_caps()
        
        # Extract JPEG data
        success, map_info = buf.map(Gst.MapFlags.READ)
        if success:
            with video_lock:
                video_frame = map_info.data
            buf.unmap(map_info)
        return Gst.FlowReturn.OK

# --- Audio Transceiver ---
# Simplified: We will focus on Downlink (Car -> Browser) visualization/playback
# and Uplink (Browser -> Car) PTT.

# --- Redis Listener ---
def redis_worker():
    if not redis_client: return
    pubsub = redis_client.pubsub()
    pubsub.subscribe("can_messages", "system_stats")
    for message in pubsub.listen():
        if message['type'] == 'message':
            try:
                data = json.loads(message['data'])
                if message['channel'].decode() == "system_stats":
                    socketio.emit('system_stats', data)
                else:
                    socketio.emit('can_data', data)
            except Exception as e:
                print(f"Redis Decode Error: {e}")

# --- Routes ---
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    # If path exists in static folder, serve it
    full_path = os.path.join(app.static_folder, path)
    if os.path.exists(full_path):
        return send_from_directory(app.static_folder, path)
    # Otherwise fallback to index.html (SPA routing)
    return send_from_directory(app.static_folder, 'index.html')

def gen_video():
    while True:
        with video_lock:
            if video_frame:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + video_frame + b'\r\n')
        time.sleep(0.01)

@app.route('/video_feed')
def video_feed():
    return Response(gen_video(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

# --- SocketIO ---
@socketio.on('connect')
def test_connect():
    print('Client connected')

@socketio.on('audio_chunk')
def handle_audio(data):
    # Uplink: Browser Mic -> Car
    if audio_bridge:
        audio_bridge.push_audio(data)

def on_audio_received(data):
    # Downlink: Car -> Browser
    socketio.emit('audio_out', data)

if __name__ == '__main__':
    # Start Video
    vr = VideoReceiver()
    vr.start()
    
    # Start Audio Bridge
    audio_bridge = AudioWebBridge(REMOTE_IP, on_audio_received, port=UDP_AUDIO_PORT)
    audio_bridge.start()
    
    # Start Redis Thread
    if redis_client:
        t = threading.Thread(target=redis_worker)
        t.daemon = True
        t.start()
    
    # Run
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
