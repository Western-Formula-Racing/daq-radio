import Dropdown from "./Dropdown";
import React, { useState, useMemo, useEffect } from "react";

interface InputProps {
  msgID: string;
  name: string;
  category: string;
  data?: Record<string, string>[];
  rawData: string;
  time: string;
}

// Defining the structure of the data, can be changed later
type DataPair = Record<string, string>;
const DataTextBox = ({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) => (
  <div
    className={[
      "w-full rounded-full bg-data-textbox-bg text-white text-sm font-semibold py-2 px-1",
      align === "left" && "text-left",
      align === "center" && "text-center",
      align === "right" && "text-right",
    ].join(" ")}
  >
    {children}
  </div>
);

function DataCard({ msgID, name, category, data, rawData, time}: Readonly<InputProps>) {

  const [collapsed, setCollapsed] = useState(false);

  const menuItems = collapsed ? ["Add to Favourites", "br", "Expand"] : ["Add to Favourites", "br", "Collapse"];

  // Event handlers for dropdown menu options specific to the data cards
  const handleMenuSelect = (selection: string) => {
    if (selection == "Add to Favourites") {
      // TODO: Favourite card section
      console.log(`${msgID} added to favourites.`);
    } else if (selection == "Collapse") {
      setCollapsed(true);
    } else if (selection == "Expand") {
      setCollapsed(false);
    }
  };

  // Data population 
  const [dataPairs, setDataPairs] = useState<DataPair[]>([]);
  const populateDataColumns = (incoming: DataPair[] | string) => {
    try {
      const parsed = typeof incoming === "string" ? (JSON.parse(incoming) as DataPair[]) : incoming;

      if (!Array.isArray(parsed)) {
        console.error("populateDataColumns: expected array of single-key objects");
        return;
      }

      // Cleaning up data 
      const cleaned = parsed
        .map((obj) => {
          const entries = Object.entries(obj);
          if (!entries.length) return null;
          const [label, value] = entries[0];
          return { [String(label)]: String(value) };
        })
        .filter(Boolean) as DataPair[];

      setDataPairs(cleaned);
    } catch (err) {
      console.error("populateDataColumns: invalid data", err);
    }
  };

  // If the parent passes data, auto-load it
  useEffect(() => {
    if (data && data.length) populateDataColumns(data);
  }, [data]);

  const rows = useMemo(
    () =>
      dataPairs.map((obj) => {
        const [label, value] = Object.entries(obj)[0];
        return [label, value] as [string, string];
      }),
    [dataPairs]
  );

  return (
    //  Data Card 
    <div className="min-w-[400px] max-w-[440px] w-100">

      {/* DM Header */}
      <div className={`${collapsed ? "gap-0.5" : "gap-1.5"} grid grid-cols-6 box-border mx-[3px]`}>
        {/* Message ID Button */}
        <Dropdown
          items={menuItems}
          onSelect={handleMenuSelect}
          widthClass="w-[150px]" 
        >
          <div className={`${collapsed ? "rounded-l-lg bg-data-textbox-bg" : "rounded-t-md bg-data-module-bg"} col-span-1 h-[40px] mx-[0px] w-100 box-border flex justify-center items-center cursor-pointer`}>
            <p className="text-white font-semibold ">{msgID}</p>
          </div>
        </Dropdown>

        {/* Message Name */}
        <div className={`${collapsed ? "" : "rounded-t-md"} col-span-3 h-[40px] mx-[0px] box-border bg-data-module-bg flex justify-center items-center`}>
          <p className="text-white text-xs font-semibold ">{name}</p>
        </div>


        {/* Category Name */}
        {/* div background colour will change based on which category is assigned to it  */}
        <div
          className={`${collapsed ? "rounded-r-lg" : "rounded-t-md"} col-span-2 h-[40px] mx-[0px]  box-border flex justify-center items-center
                        ${category === "POWERTRAIN" ? "bg-sky-400" :
                          category === "MOTOR CONTROL" ? "bg-green-400" :
                          category === "CAT2" ? "bg-sky-500" :
                          category === "BMS/TORCH" ? "bg-orange-400" :
                          category === "DIAGNOSTICS" ? "bg-red-500" :
                          "bg-blue-500"}`} // Default 
        // TODO: Assign data categories to colours
        >
          <p className="text-white text-xs font-semibold ">{category}</p>

        </div>

      </div>

      {/* DM Content (collapsible) */}

      <div
        id={msgID}
        className={[
          "w-100 rounded-md bg-data-module-bg flex flex-column box-border  mt-1",
          "overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out",
          collapsed ? "max-h-0 opacity-0 pointer-events-none" : "p-[10px] max-h-[1000px] opacity-100",
        ].join(" ")}
        aria-expanded={!collapsed}
      >

        {/* Data Display */}
        <div className="w-full flex flex-col gap-2 p-[10px]">
          {rows.map(([label, value], idx) => (
            <Dropdown
              items={["Graph 1", "Graph 2", "br", "New Graph"]}
              onSelect={handleMenuSelect}
              widthClass="w-[120px]"
            // TODO: Handle menu button events
            >
              <div key={`${label}-${idx}`} className="grid grid-cols-5 w-full">
                {/* Left column (label) */}
                <div className="col-span-3 p-[5px]">
                  <DataTextBox align="center">{label}</DataTextBox>
                </div>
                {/* Right column (value) */}
                <div className="col-span-2 p-[5px]">
                  <DataTextBox align="center">{value}</DataTextBox>
                </div>
              </div>
            </Dropdown>
          ))}
        </div>

        <div className="w-90 h-[2px] bg-white self-center rounded-xs"></div>

        {/* Raw Data Display */}
        <div className="h-[50px] grid grid-cols-6 text-white text-xs items-center justify-start">

          <p id="raw-data" className="col-span-4 font-semibold">Raw data:&nbsp;&nbsp;&nbsp;{rawData}</p>
          <p id="raw-data-received" className="col-span-2 text-end font-semibold">Received:&nbsp;&nbsp;&nbsp;{time}</p>

        </div>
      </div>
    </div>

  );
}

export default DataCard;
