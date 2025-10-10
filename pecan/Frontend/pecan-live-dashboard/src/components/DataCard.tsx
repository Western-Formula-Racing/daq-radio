import Dropdown from "./Dropdown";
import React, { useState, useMemo, useEffect } from "react";

interface InputProps {
    msgID: string;
    messageName: string;
    category?: string;
    data?: Record<string, string>[];
    lastUpdated?: number;
    rawData?: string;
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

function DataCard({ msgID, messageName, category, data, lastUpdated, rawData }: Readonly<InputProps>) {

    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => setCurrentTime(Date.now()), 100);
        return () => clearInterval(interval);
    }, []);

    const timeDiff = lastUpdated ? currentTime - lastUpdated : 0;

    const computedCategory = useMemo(() => {
        if (category) return category;
        if (!data || data.length === 0) return "NO CAT";
        const signalNames = data.flatMap(obj => Object.keys(obj));
        const hasINV = signalNames.some(name => name.includes("INV"));
        const hasBMS = signalNames.some(name => name.includes("BMS") || name.includes("TORCH")) || messageName.includes("TORCH");
        const hasVCU = signalNames.some(name => name.includes("VCU"));
        if (hasVCU) return "VCU";
        else if (hasBMS) return "BMS/TORCH";
        else if (hasINV) return "INV";
        else return "NO CAT";
    }, [category, data]);

    // Event handlers for dropdown menu options specific to the data cards
    const handleMenuSelect = (selection: string) => {
        if (selection === "Add to Favourites") {
            // TODO: Favourite card section
            console.log(`${msgID} added to favourites.`);
        } else if (selection === "Collapse") {
            console.log(`${msgID} has been collapsed.`);
        }
    };

    // Data population functions 
    const [dataPairs, setDataPairs] = useState<DataPair[]>([]);
    const populateDataColumns = (incoming: DataPair[] | string) => {
    try {
      const parsed = typeof incoming === "string" ? (JSON.parse(incoming) as DataPair[]) : incoming;

      if (!Array.isArray(parsed)) {
        console.error("populateDataColumns: expected array of single-key objects");
        return;
      }

      const cleaned = parsed
        .map((obj) => {
          const entries = Object.entries(obj);
          if (!entries.length) return null;
          const [label, value] = entries[0];
          let processedValue = String(value);
          const parts = processedValue.split(' ');
          if (parts.length > 0) {
            const strNum = parts[0];
            const decimalPart = strNum.split('.')[1];
            const decimalPlaces = decimalPart ? decimalPart.length : 0;
            // Rounding to 4 decimal places if more than 4 exist
            if (decimalPlaces > 4 && !isNaN(parseFloat(strNum))) {
              const num = parseFloat(strNum);
              const rounded = Math.round(num * 10000) / 10000;
              parts[0] = rounded.toString();
              processedValue = parts.join(' ');
            }
          }
          return { [String(label)]: processedValue };
        })
        .filter(Boolean) as DataPair[];

      setDataPairs(cleaned);
    } catch (err) {
      console.error("populateDataColumns: invalid data", err);
    }
  };

  // If the parent passes data, auto-load it.
  useEffect(() => {
    if (data && data.length) populateDataColumns(data);
  }, [data]);

  // Testing data for displaying, will need to feed 
  useEffect(() => {
    if (!data) {
      populateDataColumns([
        { "Voltage 1": "3.57 V" },
        { "Voltage 2": "3.57 V" },
        { "Voltage 3": "3.57 V" },
        { "Voltage 4": "3.57 V" },
      ]);
    }
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
        <div className="w-[400px] m-[10px]">

            {/* DM Header */}
            <div className="grid grid-cols-6 box-border gap-1.5 mx-[3px]">
                {/* Message ID Button */}
                <Dropdown
                    items={["Add to Favourites", "br", "Collapse"]}
                    onSelect={handleMenuSelect}
                    widthClass="w-[150px]"
                    // TODO: Handle menu button events
                >
                    <div className="col-span-1 h-[40px] m-[5px] mx-[0px] w-100 rounded-t-md box-border bg-data-module-bg flex justify-center items-center">
                        <p className="text-white font-semibold ">{msgID}</p>
                    </div>
                </Dropdown>

                {/* Message Name */}
                <div className="col-span-3 h-[40px] m-[5px] mx-[0px] rounded-t-md box-border bg-data-module-bg flex justify-center items-center">
                    <p className="text-white text-[15px] font-semibold ">{messageName}</p>
                </div>


                {/* Category Name */}
                {/* div background colour will change based on which category is assigned to it  */}
                <div
                    className={`col-span-2 h-[40px] m-[5px] mx-[0px] rounded-t-md  box-border flex justify-center items-center 
                        ${computedCategory === "TEST" ? "bg-sky-400" :
                            computedCategory === "CAT1" ? "bg-green-400" :
                            computedCategory === "CAT2" ? "bg-sky-500" :
                            computedCategory === "BMS/TORCH" ? "bg-orange-400" :
                            computedCategory === "CAT4" ? "bg-red-500" :
                            "bg-blue-500"}`} // Default 
                            // TODO: Assign data categories to colours
                >
                    <p className="text-white font-semibold ">{computedCategory}</p>

                </div>

            </div>

            {/* DM Content */}
            <div id={msgID} className="w-100 h-fit min-h-[100px] rounded-md bg-data-module-bg flex flex-column box-border p-[10px]">

                {/* Data Display */}
                <div className="w-full flex flex-col gap-2 p-[10px]">
                    {rows.map(([label, value], idx) => (
                        <Dropdown
                            items={["Graph 1", "Graph 2", "br", "New Graph"]}
                            onSelect={handleMenuSelect}
                            widthClass="w-[120px]"
                            // TODO: Handle menu button events
                        >
                            <div key={idx} className="grid grid-cols-5 w-full">
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
                <div className="h-[50px] flex text-white text-xs items-center justify-start relative">

                    <p id="raw-data" className="font-semibold font-mono">&nbsp;&nbsp;&nbsp;{rawData || "00 01 02 03 04 05 06 07"}</p>
                    <p id="raw-data-received" className="absolute left-[55%] font-semibold font-mono">Last Update:&nbsp;&nbsp;&nbsp;{timeDiff}ms</p>

                </div>
            </div>



        </div>

    );
}

export default DataCard;
