import { useState, useEffect, useRef, useMemo } from "react";
import DataCard from "../components/DataCard";
import DataRow from "../components/DataRow";
import PlotManager from "../components/PlotManager";
import type { PlotSignal } from "../components/PlotManager";
import PlotControls from "../components/PlotControls";
import { dataStore } from "../lib/DataStore";
import { useAllLatestMessages, useDataStoreStats } from "../lib/useDataStore";
import atozIcon from "../assets/atoz.png";
import ztoaIcon from "../assets/ztoa.png";
import sortIcon from "../assets/sort.png";
import idAscendingIcon from "../assets/id_ascending.png";
import idDescendingIcon from "../assets/id_descending.png";
import listViewIcon from "../assets/list-view.png";
import gridViewIcon from "../assets/grid-view.png";
import { useOutletContext } from "react-router";

interface Plot {
  id: string;
  signals: PlotSignal[];
}

function Dashboard() {
  // Sorting and View State
  // =====================================================================
  const [sortingMethod, setSortingMethod] = useState("name");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [tickUpdate, setTickUpdate] = useState(Date.now());
  const [currentSortIcon, setCurrentSortIcon] = useState(atozIcon);
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");

  const { isSidebarOpen } = useOutletContext<{ isSidebarOpen: boolean }>();

  // Plotting State
  // =====================================================================
  const [plots, setPlots] = useState<Plot[]>([]);
  const [nextPlotId, setNextPlotId] = useState(1);
  const [plotTimeWindow, setPlotTimeWindow] = useState(30000); // Default 30s in ms
  const [plotControls, setPlotControls] = useState<{
    visible: boolean;
    signalInfo: {
      msgID: string;
      signalName: string;
      messageName: string;
      unit: string;
    } | null;
    position: { x: number; y: number };
  }>({
    visible: false,
    signalInfo: null,
    position: { x: 0, y: 0 },
  });

  const sortingFilter = useRef({
    name: 0,
    category: 0,
    id: 1,
    prev: "",
  });

  // Data
  // =====================================================================

  // Use the DataStore hooks to get all latest messages
  const allLatestMessages = useAllLatestMessages();
  const dataStoreStats = useDataStoreStats();

  const [performanceStats, setPerformanceStats] = useState({
    memoryUsage: "N/A" as string | number,
    fps: 0,
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
        const fps = Math.round(
          (frameCountRef.current * 1000) / (now - lastFpsUpdateRef.current)
        );
        setPerformanceStats((prev) => ({ ...prev, fps }));

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
      if ("memory" in performance) {
        const memInfo = (performance as any).memory;
        const memoryMB = Math.round(memInfo.usedJSHeapSize / 1024 / 1024);
        setPerformanceStats((prev) => ({
          ...prev,
          memoryUsage: memoryMB,
        }));

        if (memoryMB > 100) {
          console.warn(`High memory usage: ${memoryMB}MB`);
        }
      }
    };
    const memoryInterval = setInterval(updateMemory, 2000);

    return () => {
      clearInterval(memoryInterval);
    };
  }, []);

  // Convert Map to array for rendering
  const canMessagesArray = Array.from(allLatestMessages.entries());

  // Sorting Logic
  // =====================================================================

  // Update sort icon and close menu when sorting method changes
  useEffect(() => {
    setSortMenuOpen(false);

    switch (sortingMethod) {
      case "name":
        if (sortingFilter.current.prev == "name") {
          sortingFilter.current.name = 1 - sortingFilter.current.name;
        }
        sortingFilter.current.prev = "name";
        setCurrentSortIcon(
          sortingFilter.current.name == 0
            ? atozIcon
            : ztoaIcon
        );
        break;
      case "category":
        if (sortingFilter.current.prev == "category") {
          sortingFilter.current.category = 1 - sortingFilter.current.category;
        }
        sortingFilter.current.prev = "category";
        setCurrentSortIcon(sortIcon);
        break;
      case "id":
        if (sortingFilter.current.prev == "id") {
          sortingFilter.current.id = 1 - sortingFilter.current.id;
        }
        sortingFilter.current.prev = "id";
        setCurrentSortIcon(
          sortingFilter.current.id == 0
            ? idAscendingIcon
            : idDescendingIcon
        );
        break;
    }
  }, [sortingMethod, tickUpdate]);

  // Sorts the filtered messages
  const filteredMsgs = useMemo(() => {
    const base = [...canMessagesArray];
    switch (sortingMethod) {
      case "name": {
        if (sortingFilter.current.name == 0) {
          return base.sort((a, b) =>
            a[1].messageName.localeCompare(b[1].messageName)
          );
        } else {
          return base.sort((a, b) =>
            b[1].messageName.localeCompare(a[1].messageName)
          );
        }
      }
      case "category": {
        // Sort by computed category matching DataRow logic
        const sorted = [...base].sort((a, b) => {
          const getCat = (entry: any) => {
            const [, sample] = entry;
            const data = sample.data;
            if (!data || Object.keys(data).length === 0) return "ZZZ_NO_CAT";
            const signalNames = Object.keys(data);
            const hasINV = signalNames.some((name) => name.includes("INV"));
            const hasBMS =
              signalNames.some(
                (name) => name.includes("BMS") || name.includes("TORCH")
              ) || sample.messageName.includes("TORCH");
            const hasVCU = signalNames.some((name) => name.includes("VCU"));
            if (hasVCU) return "VCU";
            else if (hasBMS) return "BMS/TORCH";
            else if (hasINV) return "INV";
            else return "ZZZ_NO_CAT";
          };
          return getCat(a).localeCompare(getCat(b));
        });
        return sortingFilter.current.category == 0 ? sorted : sorted.reverse();
      }
      case "id": {
        if (sortingFilter.current.id == 0) {
          return base.sort((a, b) =>
            a[0].localeCompare(b[0], undefined, {
              numeric: true,
            })
          );
        } else {
          return base.sort((a, b) =>
            b[0].localeCompare(a[0], undefined, {
              numeric: true,
            })
          );
        }
      }
      default:
        return base;
    }
  }, [canMessagesArray, sortingMethod, tickUpdate]);

  // View Mode
  // =====================================================================

  // Persisting user view mode choice
  useEffect(() => {
    const saved = localStorage.getItem("dash:viewMode");
    if (saved == "cards" || saved == "list") setViewMode(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("dash:viewMode", viewMode);
  }, [viewMode]);

  // Plot Management Functions
  // =====================================================================
  const handleSignalClick = (
    msgID: string,
    signalName: string,
    messageName: string,
    unit: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    setPlotControls({
      visible: true,
      signalInfo: { msgID, signalName, messageName, unit },
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleNewPlot = (signalInfo: {
    msgID: string;
    signalName: string;
    messageName: string;
    unit: string;
  }) => {
    const newPlotId = String(nextPlotId);
    setPlots([
      ...plots,
      {
        id: newPlotId,
        signals: [signalInfo],
      },
    ]);
    setNextPlotId(nextPlotId + 1);
  };

  const handleAddToPlot = (
    plotId: string,
    signalInfo: {
      msgID: string;
      signalName: string;
      messageName: string;
      unit: string;
    }
  ) => {
    setPlots((prevPlots) =>
      prevPlots.map((plot) => {
        if (plot.id === plotId) {
          // Check if signal already exists in this plot
          const exists = plot.signals.some(
            (s) => s.msgID === signalInfo.msgID && s.signalName === signalInfo.signalName
          );
          if (!exists) {
            return {
              ...plot,
              signals: [...plot.signals, signalInfo],
            };
          }
        }
        return plot;
      })
    );
  };

  const handleRemoveSignalFromPlot = (
    plotId: string,
    msgID: string,
    signalName: string
  ) => {
    setPlots((prevPlots) =>
      prevPlots.map((plot) => {
        if (plot.id === plotId) {
          return {
            ...plot,
            signals: plot.signals.filter(
              (s) => !(s.msgID === msgID && s.signalName === signalName)
            ),
          };
        }
        return plot;
      })
    );
  };

  const handleClosePlot = (plotId: string) => {
    setPlots((prevPlots) => prevPlots.filter((plot) => plot.id !== plotId));
  };

  return (
    <div className="grid grid-cols-3 gap-0 w-100 h-full">
      {/* Data display section */}
      <div className="col-span-2 relative flex flex-col h-full overflow-y-auto">
        <div className="flex-1 p-4 pb-16">
          {/* Data filter / view selection menu */}
          <div className="bg-data-module-bg w-full h-[100px] grid grid-cols-4 gap-1 rounded-md mb-[15px]">
            {/* Data category filters */}
            <div className="col-span-3">{/* WIP */}</div>

            {/* View selection options */}
            <div className="col-span-1 flex items-center justify-end gap-1 p-3">
              <div className="flex flex-row">
                {/* Filter button and dropdown  */}
                <button
                  onClick={() => setSortMenuOpen((o) => !o)}
                  className="w-[50px] h-[50px] p-[10px] !rounded-lg flex justify-center items-center cursor-pointer hover:bg-data-textbox-bg/50 transition-colors object-contain"
                >
                  <img src={currentSortIcon} alt="Sort" />
                </button>
                {sortMenuOpen && (
                  <div className="flex flex-col block fixed top-30 z-100 rounded-md bg-dropdown-menu-bg w-30 h-20 text-center text-white">
                    <span className="font-bold">Sort By</span>
                    <div className="bg-dropdown-menu-secondary flex flex-col space-between w-full h-full rounded-b-md">
                      <button
                        onClick={() => {
                          setSortingMethod("name");
                          setTickUpdate(Date.now());
                        }}
                        className={`${
                          sortingMethod == "name" ? "font-bold" : "font-regular"
                        }`}
                      >
                        Name
                      </button>
                      <button
                        onClick={() => {
                          setSortingMethod("category");
                          setTickUpdate(Date.now());
                        }}
                        className={`${
                          sortingMethod == "category"
                            ? "font-bold"
                            : "font-regular"
                        }`}
                      >
                        Category
                      </button>
                      <button
                        onClick={() => {
                          setSortingMethod("id");
                          setTickUpdate(Date.now());
                        }}
                        className={`${
                          sortingMethod == "id" ? "font-bold" : "font-regular"
                        }`}
                      >
                        ID
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setViewMode("list")}
                className="w-[50px] h-[50px] p-[10px] !rounded-lg flex justify-center items-center cursor-pointer hover:bg-data-textbox-bg/50 transition-colors object-contain"
                aria-pressed={viewMode === "list"}
              >
                <img src={listViewIcon} alt="List view" />
              </button>
              <button
                onClick={() => setViewMode("cards")}
                className="w-[50px] h-[50px] p-[10px] !rounded-lg flex justify-center items-center cursor-pointer hover:bg-data-textbox-bg/50 transition-colors object-contain"
                aria-pressed={viewMode === "cards"}
              >
                <img src={gridViewIcon} alt="Grid view" />
              </button>
            </div>
          </div>

          {viewMode === "cards" ? (
            <>
              <div className={`${isSidebarOpen ? "columns-1" : "columns-2"} gap-4`}>
                {filteredMsgs.map(([canId, sample]) => {
                  const data = Object.entries(sample.data).map(
                    ([key, value]) => ({
                      [key]: `${value.sensorReading} ${value.unit}`,
                    })
                  );

                  return (
                    <div key={canId} className="mb-4 avoid-break">
                      <DataCard
                        key={canId}
                        msgID={canId}
                        name={sample.messageName}
                        data={
                          data.length > 0
                            ? data
                            : [
                                {
                                  "No Data": "Waiting for messages...",
                                },
                              ]
                        }
                        lastUpdated={sample.timestamp}
                        rawData={sample.rawData}
                        onSignalClick={handleSignalClick}
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
                <div className={`${isSidebarOpen ? "col-span-2" : "col-span-1"} flex justify-left items-center ps-3`}>
                  <button
                    onClick={() => {
                      setSortingMethod("id");
                      setTickUpdate(Date.now());
                    }}
                  >
                    Msg ID
                  </button>
                </div>
                {/* Message name column */}
                <div className={`${isSidebarOpen ? "col-span-6" : "col-span-4"} flex justify-left items-center px-3`}>
                  <button
                    onClick={() => {
                      setSortingMethod("name");
                      setTickUpdate(Date.now());
                    }}
                  >
                    Message Name
                  </button>
                </div>
                {/* Category column */}
                <div className={`${isSidebarOpen ? "col-span-2" : "col-span-2"} rounded-t-sm bg-data-textbox-bg flex justify-left items-center px-3`}>
                  <button
                    onClick={() => {
                      setSortingMethod("category");
                      setTickUpdate(Date.now());
                    }}
                  >
                    Category
                  </button>
                </div>
                {/* Data column */}
                {!isSidebarOpen && (
                  <div className="col-span-3 flex justify-left items-center px-3">
                    Data
                  </div>
                )}
                {/* Time column */}
                <div className="col-span-2 flex justify-left items-center ps-3">
                  Time
                </div>
              </div>

              {/* Rows */}

              {filteredMsgs.map(([canId, sample], i) => {
                const data = Object.entries(sample.data).map(
                  ([key, value]) => ({
                    [key]: `${value.sensorReading} ${value.unit}`,
                  })
                );

                return (
                  <DataRow
                    key={canId}
                    msgID={canId}
                    name={sample.messageName}
                    data={
                      data.length > 0
                        ? data
                        : [
                            {
                              "No Data": "Waiting for messages...",
                            },
                          ]
                    }
                    lastUpdated={sample.timestamp}
                    rawData={sample.rawData}
                    index={i}
                    compact={isSidebarOpen}
                    onSignalClick={handleSignalClick}
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
              <span>
                CAN frames/sec:{" "}
                {dataStoreStats.totalMessages > 0 ? "Live" : "0"}
              </span>
              <span>
                Mem: {performanceStats.memoryUsage}
                {typeof performanceStats.memoryUsage === "number" ? "MB" : ""}
              </span>
              <span>
                Store: {dataStoreStats.totalMessages} msgs,{" "}
                {dataStoreStats.totalSamples} samples
              </span>
              <span>Store Mem: {dataStoreStats.memoryEstimateMB}MB</span>
            </div>
          </div>
        </div>
      </div>

      {/* Graph display section */}
      <div className="col-span-1 bg-sidebar p-4 overflow-y-auto">
        {/* Time Window Control */}
        <div className="bg-data-module-bg rounded-md p-3 mb-3">
          <h3 className="text-white font-semibold mb-2">Plot Settings</h3>
          <div className="flex flex-col gap-2">
            <label className="text-gray-300 text-sm">
              Time Window (seconds):
            </label>
            <input
              type="number"
              min="0"
              max="300"
              value={plotTimeWindow / 1000}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '' || value === null) {
                  return;
                }
                const seconds = Math.max(0, Math.min(300, Number(value)));
                setPlotTimeWindow(seconds * 1000);
              }}
              className="bg-data-textbox-bg text-white rounded px-2 py-1 text-sm"
            />
          </div>
        </div>

        {/* Plots */}
        {plots.length === 0 ? (
          <div className="text-center text-gray-500 mt-10">
            <p className="mb-2">No plots yet</p>
            <p className="text-sm">Click on a sensor to create a plot</p>
          </div>
        ) : (
          plots.map((plot) => (
            <PlotManager
              key={plot.id}
              plotId={plot.id}
              signals={plot.signals}
              timeWindowMs={plotTimeWindow}
              onRemoveSignal={(msgID, signalName) =>
                handleRemoveSignalFromPlot(plot.id, msgID, signalName)
              }
              onClosePlot={() => handleClosePlot(plot.id)}
            />
          ))
        )}
      </div>

      {/* Plot Controls Modal */}
      {plotControls.visible && plotControls.signalInfo && (
        <PlotControls
          signalInfo={plotControls.signalInfo}
          existingPlots={plots.map((p) => p.id)}
          position={plotControls.position}
          onNewPlot={handleNewPlot}
          onAddToPlot={handleAddToPlot}
          onClose={() =>
            setPlotControls({ visible: false, signalInfo: null, position: { x: 0, y: 0 } })
          }
        />
      )}
    </div>
  );
}

export default Dashboard;
