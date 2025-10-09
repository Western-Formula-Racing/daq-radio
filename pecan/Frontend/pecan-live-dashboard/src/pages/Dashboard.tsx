import { useState, useEffect } from "react";
import DataCard from "../components/DataCard";
import { createCanProcessor } from "../utils/canProcessor";

function Dashboard() {
  const [canMessages, setCanMessages] = useState<{ [canId: string]: { 
    messageName: string; 
    signals: { [key: string]: { sensorReading: number; unit: string } };
    lastUpdated: number;
    rawData: string;
  } }>({});
  const [processor, setProcessor] = useState<any>(null);

  useEffect(() => {
    // Initialize CAN processor
    createCanProcessor('/assets/dbc.dbc').then((proc) => {
      setProcessor(proc);
      console.log('CAN processor initialized');

      // Initialize with demo data for CAN ID 176
      setCanMessages({
        "176": {
          messageName: "M176_Fast_Info",
          signals: {
            "INV_Fast_DC_Bus_Voltage": { sensorReading: 123, unit: "V" },
            "INV_Fast_Motor_Speed": { sensorReading: 123, unit: "rpm" },
            "INV_Fast_Torque_Command": { sensorReading: 123, unit: "N.m" },
            "INV_Fast_Torque_Feedback": { sensorReading: 123, unit: "N.m" }
          },
          lastUpdated: Date.now(),
          rawData: "00 01 02 03 04 05 06 07"
        }
      });
    }).catch((error) => {
      console.error('Failed to initialize CAN processor:', error);
    });
  }, []);

  // WebSocket connection for real-time CAN data
  useEffect(() => {
    if (!processor) return;

    const ws = new WebSocket('ws://localhost:8080'); // Connect to WebSocket server

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        console.log('Received WebSocket message:', event.data);
        
        // Parse the JSON message from the server
        let messageData;
        try {
          messageData = JSON.parse(event.data);
        } catch (parseError) {
          // If it's not JSON, treat as string (CSV format)
          messageData = event.data;
        }
        
        // Use the processor to decode the raw CAN message(s)
        const decoded = processor.processWebSocketMessage(messageData);
        console.log('Decoded message(s):', decoded);
        
        // Handle both single messages and arrays of messages
        const messagesToProcess = Array.isArray(decoded) ? decoded : [decoded];
        
        // Process each decoded message
        const updates: { [canId: string]: any } = {};
        
        for (const message of messagesToProcess) {
          if (message && message.signals) {
            const canId = message.canId.toString();
            console.log(`Processing CAN ID ${canId}:`, message.signals);
            
            updates[canId] = {
              messageName: message.messageName || `CAN_${canId}`,
              signals: message.signals,
              lastUpdated: Date.now(),
              rawData: message.rawData
            };
          }
        }
        
        // Batch update all messages at once for better performance
        if (Object.keys(updates).length > 0) {
          console.log(`Updating dashboard with ${Object.keys(updates).length} messages`);
          setCanMessages(prev => ({
            ...prev,
            ...updates
          }));
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, [processor]);

  return (
    <div className="flex flex-wrap">
      {Object.entries(canMessages).map(([canId, message]) => {
        const data = Object.entries(message.signals).map(([key, value]) => ({
          [key]: `${value.sensorReading} ${value.unit}`
        }));

        return (
          <DataCard
            key={canId}
            msgID={canId}
            messageName={message.messageName}
            data={data.length > 0 ? data : [{ "No Data": "Waiting for messages..." }]}
            lastUpdated={message.lastUpdated}
            rawData={message.rawData}
          />
        );
      })}

      {/* Static card for comparison */}
      <DataCard
        msgID="1006"
        messageName="TORCH_M1_V1"
        category="BMS/TORCH"
        lastUpdated={Date.now()}
        rawData="00 01 02 03 04 05 06 07"
      />
    </div>
  );
}

export default Dashboard;
