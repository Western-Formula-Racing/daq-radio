import { useEffect, useMemo, useState } from "react";
import DataCard from "../components/DataCard";
import DataRow from "../components/DataRow";

type Msg = {
  msgID: string;
  name: string;
  category: string;
  data?: Record<string, string>[];
  rawData: string;
  time: string;
};

const data: Msg[] = [
  {
    msgID: "1006",
    name: "TORCH_M1_V1",
    category: "BMS/TORCH",
    data: [
      { "Voltage 1": "3.57 V" },
      { "Voltage 2": "3.58 V" },
      { "Voltage 3": "2.98 V" },
      { "Voltage 4": "4.05 V" },
    ],
    rawData: "00 01 02 03 04 05 06 07 08 09",
    time: "-100ms",
  },
  {
    msgID: "2012",
    name: "VCU_PDM_Rear_cmd",
    category: "POWERTRAIN",
    data: [
      { "Rear Motor Enable": "True" },
      { "Rear Motor Torque Cmd": "150 Nm" },
      { "Rear Motor Speed Cmd": "4500 rpm" },
    ],
    rawData: "00 01 02 03 04 05 06 07 08 09",
    time: "-100ms",
  },
  {
    msgID: "173",
    name: "M173_Modulation_And_Flux_Info",
    category: "MOTOR CONTROL",
    data: [
      { "Modulation Index": "0.82" },
      { "Flux Weakening": "Enabled" },
      { "Phase Angle": "37°" },
    ],
    rawData: "00 01 02 03 04 05 06 07 08 09",
    time: "-100ms",
  },
  {
    msgID: "172",
    name: "M172_Torque_And_Timer_Info",
    category: "MOTOR CONTROL",
    data: [
      { "Actual Torque": "142 Nm" },
      { "Timer Count": "350 ms" },
      { "Commanded Torque": "150 Nm" },
    ],
    rawData: "00 01 02 03 04 05 06 07 08 09",
    time: "-100ms",
  },
  {
    msgID: "194",
    name: "M194_Read_Write_Param_Response",
    category: "DIAGNOSTICS",
    data: [
      { "Parameter Index": "0x15" },
      { "Write Status": "Success" },
      { "Response Code": "0x01" },
    ],
    rawData: "00 01 02 03 04 05 06 07 08 09",
    time: "-100ms",
  },
  {
    msgID: "193",
    name: "M193_Read_Write_Param_Command",
    category: "DIAGNOSTICS",
    data: [
      { "Parameter Index": "0x15" },
      { "Write Value": "0x7A" },
      { "Command Type": "Write" },
    ],
    rawData: "00 01 02 03 04 05 06 07 08 09",
    time: "-100ms",
  },
];

function Dashboard() {
  const [sortingMethod, setSortingMethod] = useState("Name");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [tickUpdate, setTickUpdate] = useState(Date.now());
  const [isAtoZ, setIsAtoZ] = useState(true);
  const [sortIcon, setSortIcon] = useState("../src/assets/atoz.png");

  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");

  // Persisting user view mode choice
  useEffect(() => {
    const saved = localStorage.getItem("dash:viewMode");
    if (saved == "cards" || saved == "list") setViewMode(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("dash:viewMode", viewMode);
  }, [viewMode]);

  const dataItems = useMemo(() => data, []);

  // Sorts the filtered messages, keeping the alphabetical direction when switching between name and category
  const filteredMsgs = useMemo(() => {
    const base = [...dataItems];
    switch (sortingMethod) {
      case "Name":
        if (isAtoZ) {
          setIsAtoZ(false);
          setSortIcon("../src/assets/atoz.png");
          setSortMenuOpen(false);
          return base.sort((a, b) =>
            (a.name ?? "").localeCompare(b.name ?? "")
          );
        } else {
          setIsAtoZ(true);
          setSortIcon("../src/assets/ztoa.png");
          setSortMenuOpen(false);
          return base.sort((a, b) =>
            (b.name ?? "").localeCompare(a.name ?? "")
          );
        }
      case "Category":
        setIsAtoZ((o) => !o);
        setSortIcon("../src/assets/sort.png");
        setSortMenuOpen(false);
        return base.sort((a, b) =>
          (a.category ?? "").localeCompare(b.category ?? "")
        );
      // Error control; Shouldn't trigger but just in case
      default:
        return base;
    }
  }, [dataItems, sortingMethod, tickUpdate]);

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
                    <span className="font-bold">Sort By</span>
                    <div className="bg-dropdown-menu-secondary flex flex-col space-between w-full h-full rounded-b-md">
                      <button
                        onClick={() => {
                          setSortingMethod("Name");
                          setTickUpdate(Date.now());
                        }}
                      >
                        Name
                      </button>
                      <button
                        onClick={() => {
                          setSortingMethod("Category");
                          setTickUpdate(Date.now());
                        }}
                      >
                        Category
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
                className="w-[50px] h-[50px] p-[10px] !rounded-lg flex justify-center items-center cursor-pointer hover:bg-data-textbox-bg/50 transition-colors object-contain"
                aria-pressed={viewMode === "cards"}
              >
                <img src="../src/assets/grid-view.png" />
              </button>
            </div>
          </div>

          {viewMode === "cards" ? (
            <div className="flex flex-row flex-wrap justify-between gap-y-[15px]">
              {filteredMsgs.map((m) => (
                <DataCard
                  key={m.msgID}
                  msgID={m.msgID}
                  name={m.name}
                  category={m.category}
                  data={m.data}
                  rawData={m.rawData}
                  time={m.time}
                />
              ))}
            </div>
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
              {filteredMsgs.map((m, i) => (
                <DataRow
                  key={m.msgID}
                  msgID={m.msgID}
                  name={m.name}
                  category={m.category}
                  data={m.data}
                  rawData={m.rawData}
                  time={m.time}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>

        {/* Graph display section */}
        <div className="col-span-1 bg-sidebar">{/* WIP */}</div>
      </div>
    </>
  );
}

export default Dashboard;
