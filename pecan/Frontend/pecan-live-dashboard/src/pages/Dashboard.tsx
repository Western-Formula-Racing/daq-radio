import { useState, useEffect, useRef } from "react";
import DataCard from "../components/DataCard";
import { dataStore } from "../lib/DataStore";
import { useAllLatestMessages, useDataStoreStats } from "../lib/useDataStore";

function Dashboard() {
  // Use the DataStore hooks to get all latest messages
  const allLatestMessages = useAllLatestMessages();
  const dataStoreStats = useDataStoreStats();
  
  const [performanceStats, setPerformanceStats] = useState({
    memoryUsage: 'N/A' as string | number,
    fps: 0
  });

  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

  // TEMPORARY: Expose dataStore to console for testing
  useEffect(() => {
    (window as any).dataStore = dataStore;
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

  // Convert Map to array for rendering
  const canMessagesArray = Array.from(allLatestMessages.entries());

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex flex-wrap flex-1">
        {canMessagesArray.map(([canId, sample]) => {
          const data = Object.entries(sample.data).map(([key, value]) => ({
            [key]: `${value.sensorReading} ${value.unit}`
          }));

          return (
            <DataCard
              key={canId}
              msgID={canId}
              messageName={sample.messageName}
              data={data.length > 0 ? data : [{ "No Data": "Waiting for messages..." }]}
              lastUpdated={sample.timestamp}
              rawData={sample.rawData}
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
          <span>CAN frames/sec: {dataStoreStats.totalMessages > 0 ? 'Live' : '0'}</span>
          <span>Mem: {performanceStats.memoryUsage}{typeof performanceStats.memoryUsage === 'number' ? 'MB' : ''}</span>
          <span>Store: {dataStoreStats.totalMessages} msgs, {dataStoreStats.totalSamples} samples</span>
          <span>Store Mem: {dataStoreStats.memoryEstimateMB}MB</span>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;