import { useState, useEffect, useRef } from "react";
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
  const [performanceStats, setPerformanceStats] = useState({
    messagesPerSecond: 0,
    avgProcessingTime: 0,
    memoryUsage: 'N/A' as string | number,
    fps: 0
  });

  const messageCountRef = useRef(0);
  const processingTimesRef = useRef<number[]>([]);
  const lastSecondRef = useRef(Date.now());
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

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

  // Performance monitoring
  useEffect(() => {
    // FPS monitoring
    const updateFPS = () => {
      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsUpdateRef.current >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / (now - lastFpsUpdateRef.current));
        setPerformanceStats(prev => ({ ...prev, fps }));
        
        if (fps < 30) {
          console.warn(`Low FPS: ${fps}`);
        }
        
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }
      requestAnimationFrame(updateFPS);
    };
    requestAnimationFrame(updateFPS);

    // Memory monitoring
    const updateMemory = () => {
      if ('memory' in performance) {
        const memInfo = (performance as any).memory;
        const memoryMB = Math.round(memInfo.usedJSHeapSize / 1024 / 1024);
        console.log('Memory info:', memInfo, 'Memory MB:', memoryMB);
        setPerformanceStats(prev => ({ 
          ...prev, 
          memoryUsage: memoryMB
        }));
        
        if (memoryMB > 100) {
          console.warn(`High memory usage: ${memoryMB}MB`);
        }
      } else {
        console.log('Performance.memory API not available');
      }
    };
    const memoryInterval = setInterval(updateMemory, 2000);

    return () => {
      clearInterval(memoryInterval);
    };
  }, []);

  // WebSocket connection for real-time CAN data
  useEffect(() => {
    if (!processor) return;

    const wsUrl = import.meta.env.DEV
      ? 'ws://localhost:8080/ws'
      : 'ws://192.168.4.1:8080/ws';  // Production: static IP (ESP32 AP Mode) with port 8080

    
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const startTime = performance.now();
      
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

        // Performance tracking
        const processingTime = performance.now() - startTime;
        processingTimesRef.current.push(processingTime);
        
        // Keep only last 100 processing times
        if (processingTimesRef.current.length > 100) {
          processingTimesRef.current = processingTimesRef.current.slice(-100);
        }
        
        // Count actual CAN messages decoded
        const canMessageCount = messagesToProcess.filter(msg => msg && msg.signals).length;
        messageCountRef.current += canMessageCount;
        
        // Update stats every second
        const now = Date.now();
        if (now - lastSecondRef.current >= 1000) {
          const messagesPerSecond = messageCountRef.current;
          const avgProcessingTime = processingTimesRef.current.length > 0 
            ? processingTimesRef.current.reduce((a, b) => a + b, 0) / processingTimesRef.current.length 
            : 0;
          
          setPerformanceStats(prev => ({
            ...prev,
            messagesPerSecond,
            avgProcessingTime: Math.round(avgProcessingTime * 100) / 100
          }));
          
          // Performance warnings
          if (messagesPerSecond > 100) {
            console.warn(`High CAN message rate: ${messagesPerSecond} messages/sec`);
          }
          if (avgProcessingTime > 10) {
            console.warn(`Slow processing: ${avgProcessingTime}ms average`);
          }
          
          messageCountRef.current = 0;
          lastSecondRef.current = now;
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
    <div className="flex flex-col min-h-screen">
      <div className="flex flex-wrap flex-1">
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

      {/* Performance Stats - low key at bottom */}
      <div className="w-full py-2 px-4 bg-gray-700 text-gray-300 text-xs border-t border-gray-600">
        <div className="flex justify-between items-center max-w-6xl mx-auto">
          <span>FPS: {performanceStats.fps}</span>
          <span>CAN frames/sec: {performanceStats.messagesPerSecond}</span>
          <span>Avg: {performanceStats.avgProcessingTime}ms</span>
          <span>Mem: {performanceStats.memoryUsage}{typeof performanceStats.memoryUsage === 'number' ? 'MB' : ''}</span>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
