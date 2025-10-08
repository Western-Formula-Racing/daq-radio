import { WebSocketServer } from 'ws';
import http from 'http';
import url from 'url';

// Create HTTP server for handling POST requests
const server = http.createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const messageCount = Array.isArray(data) ? data.length : 1;
        console.log(`Received ${messageCount} message(s) to broadcast:`, data);
        
        // Broadcast to all connected WebSocket clients
        wss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(JSON.stringify(data));
          }
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: `${messageCount} message(s) broadcasted` 
        }));
      } catch (error) {
        console.error('Error parsing message:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

console.log('WebSocket server started on ws://localhost:8080');
console.log('HTTP server started on http://localhost:8080');

const connectedClients = new Set();

wss.on('connection', (ws) => {
  console.log('Dashboard connected');
  connectedClients.add(ws);

  ws.on('close', () => {
    console.log('Dashboard disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    connectedClients.delete(ws);
  });
});

// Start the server
server.listen(8080, () => {
  console.log('Server is running on port 8080');
  console.log('Send POST requests to http://localhost:8080/send with CAN message data');
  console.log('Dashboard connects to ws://localhost:8080');
});