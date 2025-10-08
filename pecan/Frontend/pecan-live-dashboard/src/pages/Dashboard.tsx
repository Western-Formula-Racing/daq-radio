import { useState, useEffect } from "react";
import DataCard from "../components/DataCard";
import { createCanProcessor } from "../utils/canProcessor";

function Dashboard() {
  const [canData, setCanData] = useState<{ [key: string]: { sensorReading: number; unit: string } }>({});
  const [messageName, setMessageName] = useState("CAN_DATA");
  const [processor, setProcessor] = useState<any>(null);

  useEffect(() => {
    // Initialize CAN processor
    createCanProcessor('/assets/dbc.dbc').then((proc) => {
      setProcessor(proc);
      console.log('CAN processor initialized');

      // For demo, set test data
      setCanData({
        "INV_Fast_DC_Bus_Voltage": { sensorReading: 123, unit: "V" },
        "INV_Fast_Motor_Speed": { sensorReading: 123, unit: "rpm" },
        "INV_Fast_Torque_Command": { sensorReading: 123, unit: "N.m" },
        "INV_Fast_Torque_Feedback": { sensorReading: 123, unit: "N.m" }
      });
      setMessageName("M176_Fast_Info");
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
          console.log('Updating dashboard with signals:', decoded.signals);
          setCanData(decoded.signals);
          setMessageName(decoded.messageName || "CAN_DATA");
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

  const data = Object.entries(canData).map(([key, value]) => ({
    [key]: `${value.sensorReading} ${value.unit}`
  }));

  return (
    <>
      <DataCard
        msgID="176"
        name={messageName}
        category="CAN"
        data={data.length > 0 ? data : [{ "No Data": "Waiting for messages..." }]}
      />

      <DataCard
        msgID="1006"
        name="TORCH_M1_V1"
        category="BMS/TORCH"
      />

    </>
  );
}

export default Dashboard;
