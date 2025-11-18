import { useState, useEffect, useRef } from "react";
import DataCard from "../components/DataCard";
import DataRow from "../components/DataRow";
import { dataStore } from "../lib/DataStore";
import { useAllLatestMessages, useDataStoreStats } from "../lib/useDataStore";

function Dashboard() {

  // Data
  // =====================================================================

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

  // View Mode 
  // =====================================================================

  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");

  // Persisting user view mode choice
  useEffect(() => {
    const saved = localStorage.getItem("dash:viewMode");
    if (saved == "cards" || saved == "list") setViewMode(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("dash:viewMode", viewMode);
  }, [viewMode]);


  return (
    <div className="grid grid-cols-3 gap-0 w-100 h-full">
      {/* Data display section */}
      <div className="col-span-2 relative flex flex-col h-full overflow-y-auto">

        <div className="flex-1 p-4 pb-16">

          {/* Data filter / view selection menu */}
          <div className="bg-data-module-bg w-full h-[100px] grid grid-cols-4 gap-1 rounded-md mb-[15px]">

            {/* Data category filters */}
            <div className="col-span-3">
              {/* WIP */}
            </div>

            {/* View selection options */}
            <div className="col-span-1 flex items-center justify-end gap-1 p-3">
              <button onClick={() => setViewMode("list")} className="w-[50px] h-[50px] p-[10px] !rounded-lg flex justify-center items-center cursor-pointer hover:bg-data-textbox-bg/50 transition-colors object-contain" aria-pressed={viewMode === "list"}>
                <img src="../src/assets/list-view.png" />
              </button>
              <button onClick={() => setViewMode("cards")} className="w-[50px] h-[50px] p-[10px] !rounded-lg flex justify-center items-center cursor-pointer hover:bg-data-textbox-bg/50 transition-colors object-contain" aria-pressed={viewMode === "cards"}>
                <img src="../src/assets/grid-view.png" />
              </button>
            </div>
          </div>

          {viewMode === "cards" ? (
            <>
              <div className="columns-2 gap-4">
                {canMessagesArray.map(([canId, sample]) => {
                  const data = Object.entries(sample.data).map(([key, value]) => ({
                    [key]: `${value.sensorReading} ${value.unit}`
                  }));

                  return (
                    <div key={canId} className="mb-4 avoid-break">
                      <DataCard
                        key={canId}
                        msgID={canId}
                        name={sample.messageName}
                        data={data.length > 0 ? data : [{ "No Data": "Waiting for messages..." }]}
                        lastUpdated={sample.timestamp}
                        rawData={sample.rawData}
                      />
                    </div>
                  );
                })}

                {/* Static card for comparison */}
                {/* <DataCard
                  msgID="1006"
                  name="TORCH_M1_V1"
                  category="BMS/TORCH"
                  lastUpdated={Date.now()}
                  rawData="00 01 02 03 04 05 06 07"
                /> */}
              </div>
            </>
          ) : (
            // List view box
            <div className="w-100 h-fit rounded-sm bg-sidebar">

              {/* Header */}
              <div className="w-100 h-[40px] rounded-t-sm grid grid-cols-12 bg-data-module-bg text-white font-semibold text-sm shadow-md">
                {/* Message ID column */}
                <div className="col-span-1 flex justify-left items-center ps-3">
                  Msg ID
                </div>
                {/* Message name column */}
                <div className="col-span-4 flex justify-left items-center px-3">
                  Message Name
                </div>
                {/* Category column */}
                <div className="col-span-2 rounded-t-sm bg-data-textbox-bg flex justify-left items-center px-3">
                  Category
                </div>
                {/* Data column */}
                <div className="col-span-4 flex justify-left items-center px-3">
                  Data
                </div>
                {/* Time column */}
                <div className="col-span-1 flex justify-left items-center ps-3">
                  Time
                </div>
              </div>

              {/* Rows */}

              {canMessagesArray.map(([canId, sample], i) => {
                const data = Object.entries(sample.data).map(([key, value]) => ({
                  [key]: `${value.sensorReading} ${value.unit}`
                }));

                return (
                  <DataRow
                    key={canId}
                    msgID={canId}
                    name={sample.messageName}
                    data={data.length > 0 ? data : [{ "No Data": "Waiting for messages..." }]}
                    lastUpdated={sample.timestamp}
                    rawData={sample.rawData}
                    index={i}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky Performance Tab */}
        <div className="sticky bottom-0 inset-x-0">
          <div className="w-full py-2 px-4 bg-data-textbox-bg/90 backdrop-blur text-gray-300 text-xs border-t border-white/10">
            <div className="flex justify-between items-center max-w-6xl mx-auto">
              <span>FPS: {performanceStats.fps}</span>
              <span>CAN frames/sec: {dataStoreStats.totalMessages > 0 ? 'Live' : '0'}</span>
              <span>Mem: {performanceStats.memoryUsage}{typeof performanceStats.memoryUsage === 'number' ? 'MB' : ''}</span>
              <span>Store: {dataStoreStats.totalMessages} msgs, {dataStoreStats.totalSamples} samples</span>
              <span>Store Mem: {dataStoreStats.memoryEstimateMB}MB</span>
            </div>
          </div>
        </div>

      </div>
      
      {/* Graph display section */}
      <div className="col-span-1 bg-sidebar">
        {/* WIP */}
      </div>
    </div>
  );
}

export default Dashboard;