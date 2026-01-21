#!/usr/bin/env python3
"""
Simple HTTP server to serve the status monitoring page.
Runs on port 8080 and serves static files from the status/ directory.
"""
import http.server
import socketserver
import os
import logging

logger = logging.getLogger("StatusServer")

PORT = int(os.getenv("STATUS_PORT", 8080))
DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/status"

class StatusHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    
    def log_message(self, format, *args):
        # Use logger instead of print
        logger.info("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), format % args))

def run_status_server():
    """Main entry point for status HTTP server."""
    os.chdir(DIRECTORY)
    with socketserver.TCPServer(("0.0.0.0", PORT), StatusHTTPRequestHandler) as httpd:
        logger.info(f"Serving status page at http://0.0.0.0:{PORT}")
        logger.info(f"Directory: {DIRECTORY}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Shutting down status server...")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    run_status_server()
