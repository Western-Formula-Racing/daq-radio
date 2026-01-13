import { dataStore } from '../lib/DataStore';
import { createCanProcessor } from '../utils/canProcessor';

export class WebSocketService {
  private ws: WebSocket | null = null;
  private processor: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Start with 2 seconds

  async initialize() {
    // Initialize CAN processor
    try {
      this.processor = await createCanProcessor();
      console.log('CAN processor initialized');
    } catch (error) {
      console.error('Failed to initialize CAN processor:', error);
      return;
    }
    
    // Connect WebSocket
    this.connect();
  }

  private connect() {
    // Automatically detect secure vs non-secure WebSocket based on page protocol
    const isSecure = window.location.protocol === 'https:';
    const protocol = isSecure ? 'wss:' : 'ws:';
    const port = isSecure ? '9443' : '9080';
    
    const wsUrl = `${protocol}//${window.location.hostname === 'localhost' ? 'localhost' : 'ws-wfr.0001200.xyz'}:${port}`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0; // Reset reconnect counter on successful connection
      };
      
      this.ws.onmessage = (event) => {
        try {
          // Muted verbose logging: console.log('Received WebSocket message:', event.data);
          
          const messageData = JSON.parse(event.data);
          const decoded = this.processor.processWebSocketMessage(messageData);
          // Muted verbose logging: console.log('Decoded message(s):', decoded);
          
          const messages = Array.isArray(decoded) ? decoded : [decoded];
          
          messages.forEach(msg => {
            if (msg?.signals) {
              const canId = msg.canId.toString();
              // Muted verbose logging: console.log(`Processing CAN ID ${canId}:`, msg.signals);
              
              dataStore.ingestMessage({
                msgID: canId,
                messageName: msg.messageName || `CAN_${canId}`,
                data: msg.signals,
                rawData: msg.rawData,
                timestamp: msg.time || Date.now()
              });
            }
          });
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected');
        
        // Attempt to reconnect if not closed intentionally
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * this.reconnectAttempts;
          
          setTimeout(() => {
            this.connect();
          }, delay);
        }
      };
    } catch (error) {
      console.error('WebSocket error:', error);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect'); // 1000 = normal closure
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const webSocketService = new WebSocketService();