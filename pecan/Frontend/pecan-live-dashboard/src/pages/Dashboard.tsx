import { useState, useEffect, useRef } from "react";
import DataCard from "../components/DataCard";
import DataRow from "../components/DataRow";
import { dataStore } from "../lib/DataStore";
import { useAllLatestMessages, useDataStoreStats } from "../lib/useDataStore";

function Dashboard() {
    const [sortingMethod, setSortingMethod] = useState("name");
    const [sortMenuOpen, setSortMenuOpen] = useState(false);
    const [tickUpdate, setTickUpdate] = useState(Date.now());
    const [sortIcon, setSortIcon] = useState("../src/assets/atoz.png");
    const [viewMode, setViewMode] = useState<"cards" | "list">("cards");

    // const sortingFilter = useRef({
    //     name: 0,
    //     category: 0,
    //     id: 1,
    //     prev: "",
    // });

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                    (frameCountRef.current * 1000) /
                        (now - lastFpsUpdateRef.current)
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const memInfo = (performance as any).memory;
                const memoryMB = Math.round(
                    memInfo.usedJSHeapSize / 1024 / 1024
                );
                console.log("Memory info:", memInfo, "Memory MB:", memoryMB);
                setPerformanceStats((prev) => ({
                    ...prev,
                    memoryUsage: memoryMB,
                }));

                if (memoryMB > 100) {
                    console.warn(`High memory usage: ${memoryMB}MB`);
                }
            } else {
                console.log("Performance.memory API not available");
            }
        };
        const memoryInterval = setInterval(updateMemory, 2000);

        return () => {
            clearInterval(memoryInterval);
        };
    }, []);

    // Convert Map to array for rendering
    const canMessagesArray = Array.from(allLatestMessages.entries());

    // Sorts the filtered messages, keeping the alphabetical direction when switching between name and category
    // const filteredMsgs = useMemo(() => {
    //     const base = [...canMessagesArray];
    //     switch (sortingMethod) {
    //         case "name":
    //             setSortMenuOpen(false);
    //             if (sortingFilter.current.prev == "name") {
    //                 sortingFilter.current.name = 1 - sortingFilter.current.name;
    //             }
    //             sortingFilter.current.prev = "name";
    //             if (sortingFilter.current.name == 0) {
    //                 //asc
    //                 setSortIcon("../src/assets/atoz.png");
    //                 return base.sort((a, b) => );
    //             } else {
    //                 //desc
    //                 setSortIcon("../src/assets/ztoa.png");
    //                 return base.sort((a, b) => b.name.localeCompare(a.name));
    //             }
    //         case "category":
    //             setSortIcon("../src/assets/sort.png");
    //             setSortMenuOpen(false);
    //             sortingFilter.current.prev = "category";
    //             return base.sort((a, b) =>
    //                 (a.category ?? "").localeCompare(b.category ?? "")
    //             );
    //         case "id":
    //             setSortMenuOpen(false);
    //             if (sortingFilter.current.prev == "id") {
    //                 sortingFilter.current.id = 1 - sortingFilter.current.id;
    //             }
    //             sortingFilter.current.prev = "id";
    //             if (sortingFilter.current.id == 0) {
    //                 //asc
    //                 setSortIcon("../src/assets/id_ascending.png");
    //                 return base.sort((a, b) =>
    //                     a.msgID.localeCompare(b.msgID, undefined, {
    //                         numeric: true,
    //                     })
    //                 );
    //             } else {
    //                 //desc
    //                 setSortIcon("../src/assets/id_descending.png");
    //                 return base.sort((a, b) =>
    //                     b.msgID.localeCompare(a.msgID, undefined, {
    //                         numeric: true,
    //                     })
    //                 );
    //             }
    //         // Error control; Shouldn't trigger but just in case
    //         default:
    //             return base;
    //     }
    // }, [dataItems, sortingMethod, tickUpdate]);

    return (
        <>
            <div className="grid grid-cols-3 gap-1 w-100 h-full">
                {/* Data display section */}
                <div className="col-span-2 p-4">
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
                                    <img src={sortIcon} />
                                </button>
                                {sortMenuOpen && (
                                    <div className="flex flex-col block fixed top-30 z-100 rounded-md bg-dropdown-menu-bg w-30 h-20 text-center text-white">
                                        <span className="font-bold">
                                            Sort By
                                        </span>
                                        <div className="bg-dropdown-menu-secondary flex flex-col space-between w-full h-full rounded-b-md">
                                            <button
                                                onClick={() => {
                                                    setSortingMethod("name");
                                                    setTickUpdate(Date.now());
                                                }}
                                                className={`${
                                                    sortingMethod == "name"
                                                        ? "font-bold"
                                                        : "font-regular"
                                                }`}
                                            >
                                                Name
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setSortingMethod(
                                                        "category"
                                                    );
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
                                                    sortingMethod == "id"
                                                        ? "font-bold"
                                                        : "font-regular"
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
                                <img src="../src/assets/list-view.png" />
                            </button>
                            <button
                                onClick={() => setViewMode("cards")}
                                className="w-[50px] h-[50px] p-[10px] !rounded-lg flex justify-center items-center cursor-pointer hover:bg-data-textbox-bg/10 transition-colors object-contain"
                                aria-pressed={viewMode === "cards"}
                            >
                                <img src="../src/assets/grid-view.png" />
                            </button>
                        </div>
                    </div>

                    {viewMode === "cards" ? (
                        <>
                            <div className="columns-2 gap-4">
                                {canMessagesArray.map(([canId, sample]) => {
                                    const data = Object.entries(
                                        sample.data
                                    ).map(([key, value]) => ({
                                        [key]: `${value.sensorReading} ${value.unit}`,
                                    }));

                                    return (
                                        <div
                                            key={canId}
                                            className="mb-4 avoid-break"
                                        >
                                            <DataCard
                                                key={canId}
                                                msgID={canId}
                                                name={sample.messageName}
                                                data={
                                                    data.length > 0
                                                        ? data
                                                        : [
                                                              {
                                                                  "No Data":
                                                                      "Waiting for messages...",
                                                              },
                                                          ]
                                                }
                                                lastUpdated={sample.timestamp}
                                                rawData={sample.rawData}
                                            />
                                        </div>
                                    );
                                })}

                                {/* Static card for comparison */}
                                <DataCard
                                    msgID="1006"
                                    name="TORCH_M1_V1"
                                    category="BMS/TORCH"
                                    lastUpdated={Date.now()}
                                    rawData="00 01 02 03 04 05 06 07"
                                />
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

                                {/* Rows */}

                                {canMessagesArray.map(([canId, sample], i) => {
                                    const data = Object.entries(
                                        sample.data
                                    ).map(([key, value]) => ({
                                        [key]: `${value.sensorReading} ${value.unit}`,
                                    }));

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
                                                              "No Data":
                                                                  "Waiting for messages...",
                                                          },
                                                      ]
                                            }
                                            lastUpdated={sample.timestamp}
                                            rawData={sample.rawData}
                                            index={i}
                                        />
                                    );
                                })}
                            </div>
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
                                {dataStoreStats.totalMessages > 0
                                    ? "Live"
                                    : "0"}
                            </span>
                            <span>
                                Mem: {performanceStats.memoryUsage}
                                {typeof performanceStats.memoryUsage ===
                                "number"
                                    ? "MB"
                                    : ""}
                            </span>
                            <span>
                                Store: {dataStoreStats.totalMessages} msgs,{" "}
                                {dataStoreStats.totalSamples} samples
                            </span>
                            <span>
                                Store Mem: {dataStoreStats.memoryEstimateMB}MB
                            </span>
                        </div>
                    </div>
                </div>

                {/* Graph display section */}
                <div className="col-span-1 bg-sidebar">{/* WIP */}</div>
            </div>
        </>
    );
}

export default Dashboard;
