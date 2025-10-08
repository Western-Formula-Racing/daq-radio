import Dropdown from "./Dropdown";
import React, { useState, useMemo, useEffect } from "react";

interface InputProps {
    msgID: string;
    name: string;
    category: string;
    data?: Record<string, string>[];
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

function DataCard({ msgID, name, category, data}: Readonly<InputProps>) {

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
          return { [String(label)]: String(value) };
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
                    <p className="text-white text-[15px] font-semibold ">{name}</p>
                </div>


                {/* Category Name */}
                {/* div background colour will change based on which category is assigned to it  */}
                <div
                    className={`col-span-2 h-[40px] m-[5px] mx-[0px] rounded-t-md  box-border flex justify-center items-center 
                        ${category === "TEST" ? "bg-sky-400" :
                            category === "CAT1" ? "bg-green-400" :
                            category === "CAT2" ? "bg-sky-500" :
                            category === "BMS/TORCH" ? "bg-orange-400" :
                            category === "CAT4" ? "bg-red-500" :
                            "bg-blue-500"}`} // Default 
                            // TODO: Assign data categories to colours
                >
                    <p className="text-white font-semibold ">{category}</p>

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
                <div className="h-[50px] grid grid-cols-6 text-white text-xs items-center justify-start">

                    <p id="raw-data" className="col-span-4 font-semibold">Raw data:&nbsp;&nbsp;&nbsp;00 01 02 03 04 05 06 07</p>
                    <p id="raw-data-received" className="col-span-2 text-end font-semibold">Received:&nbsp;&nbsp;&nbsp;-100ms</p>

                </div>
            </div>



        </div>

    );
}

export default DataCard;
