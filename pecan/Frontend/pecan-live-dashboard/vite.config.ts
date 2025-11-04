import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// WebSocket server plugin - runs in both development and production
const websocketPlugin = (): Plugin => ({
  name: 'websocket-server',
  configureServer() {
    // Run WebSocket server in development
    startWebSocketServer();
  },
  configurePreviewServer() {
    // Run WebSocket server in preview mode (production testing)
    startWebSocketServer();
  }
});

// Shared WebSocket server function
function startWebSocketServer() {
  // Dynamic import to avoid build-time dependency issues
  import('ws').then(({ WebSocketServer }) => {
    const wss = new WebSocketServer({ port: 8080 });
    
    // eslint-disable-next-line no-console
    console.log('WebSocket server started on ws://localhost:8080');
    
    wss.on('connection', (ws) => {
      // eslint-disable-next-line no-console
      console.log('Client connected (Dashboard or ESP32/Data Sender)');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          const messageCount = Array.isArray(data) ? data.length : 1;
          // eslint-disable-next-line no-console
          console.log(`Received ${messageCount} message(s) to broadcast:`, data);
          
          // Broadcast to all OTHER connected WebSocket clients (not sender)
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) { // WebSocket.OPEN
              client.send(JSON.stringify(data));
            }
          });
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Error parsing WebSocket message:', error);
        }
      });
      
      ws.on('close', () => {
        // eslint-disable-next-line no-console
        console.log('Client disconnected');
      });
      
      ws.on('error', (error) => {
        // eslint-disable-next-line no-console
        console.error('WebSocket error:', error);
      });
    });
    
    // eslint-disable-next-line no-console
    console.log('WebSocket server is running on port 8080');
    // eslint-disable-next-line no-console
    console.log('ESP32 and Dashboard can connect to ws://localhost:8080');
  }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start WebSocket server:', error);
  });
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    websocketPlugin()
  ],
  test: {
    environment: 'node',
    restoreMocks: true
  }
});
