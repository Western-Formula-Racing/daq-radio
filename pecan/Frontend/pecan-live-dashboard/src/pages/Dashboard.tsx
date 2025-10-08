import { useState, useEffect } from "react";
import DataCard from "../components/DataCard";
import { createCanProcessor } from "../utils/canProcessor";

function Dashboard() {
  const [canMessages, setCanMessages] = useState<{ [canId: string]: { 
    messageName: string; 
    signals: { [key: string]: { sensorReading: number; unit: string } };
    lastUpdated: number;
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
          lastUpdated: Date.now()
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
        
        // Use the processor to decode the raw CAN message
        const decoded = processor.processWebSocketMessage(messageData);
        console.log('Decoded message:', decoded);
        
        if (decoded && decoded.signals) {
          const canId = decoded.canId.toString();
          console.log(`Updating dashboard with CAN ID ${canId}:`, decoded.signals);
          
          // Update or create new message entry
          setCanMessages(prev => ({
            ...prev,
            [canId]: {
              messageName: decoded.messageName || `CAN_${canId}`,
              signals: decoded.signals,
              lastUpdated: Date.now()
            }
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

        // Determine category based on signal names
        let category = "NO CAT";
        const signalNames = Object.keys(message.signals);
        
        // Check if any signal name contains specific keywords
        const hasINV = signalNames.some(name => name.includes("INV"));
        const hasBMS = signalNames.some(name => name.includes("BMS") || name.includes("TORCH"));
        const hasVCU = signalNames.some(name => name.includes("VCU"));
        
        if (hasVCU) {
          category = "VCU";
        } else if (hasBMS) {
          category = "BMS/TORCH";
        } else if (hasINV) {
          category = "INV";
        } else { category = "NO CAT"; }

        return (
          <DataCard
            key={canId}
            msgID={canId}
            name={message.messageName}
            category={category}
            data={data.length > 0 ? data : [{ "No Data": "Waiting for messages..." }]}
          />
        );
      })}

      {/* Static card for comparison */}
      <DataCard
        msgID="1006"
        name="TORCH_M1_V1"
        category="BMS/TORCH"
      />
    </div>
  );
}

export default Dashboard;
