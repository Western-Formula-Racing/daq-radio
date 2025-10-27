import Dropdown from "./Dropdown";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { dataStore } from "../lib/DataStore";
import type { TelemetrySample, TelemetrySignal } from "../lib/DataStore";

interface InputProps {
    msgID: string;
    messageName?: string;
    category?: string;
    data?: Record<string, string>[];
    lastUpdated?: number;
    rawData?: string;
    historyWindowMs?: number;
    useDataStore?: boolean;
}

// Defining the structure of the data, can be changed later
type DataPair = [label: string, value: string];

const DEFAULT_FALLBACK_ROWS: DataPair[] = [
  ["Voltage 1", "3.57 V"],
  ["Voltage 2", "3.57 V"],
  ["Voltage 3", "3.57 V"],
  ["Voltage 4", "3.57 V"],
];

const formatRawValue = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "—";

  const parts = trimmed.split(" ");
  if (parts.length === 0) return "—";

  const [valuePart, ...rest] = parts;
  const decimalPart = valuePart.split(".")[1];
  const decimalPlaces = decimalPart ? decimalPart.length : 0;

  let displayValue = valuePart;
  if (!Number.isNaN(Number(valuePart)) && decimalPlaces > 4) {
    const rounded = Math.round(Number(valuePart) * 10_000) / 10_000;
    displayValue = `${rounded}`;
  }

  return rest.length > 0 ? `${displayValue} ${rest.join(" ")}` : displayValue;
};

const formatSignal = (signal: TelemetrySignal): string => {
  if (signal.rawValue) {
    return formatRawValue(signal.rawValue);
  }

  if (!Number.isFinite(signal.sensorReading)) {
    return "—";
  }

  const rounded = Math.round(signal.sensorReading * 10_000) / 10_000;
  return signal.unit ? `${rounded} ${signal.unit}` : `${rounded}`;
};

const parseCardDataProp = (rows?: Record<string, string>[]): DataPair[] => {
  if (!rows) return [];

  return rows
    .map((entry) => {
      const [label, raw] = Object.entries(entry)[0] ?? [];
      if (!label) return undefined;
      return [label, formatRawValue(String(raw))] as DataPair;
    })
    .filter((row): row is DataPair => Boolean(row));
};

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

function DataCard({
  msgID,
  messageName,
  category,
  data,
  lastUpdated,
  rawData,
  historyWindowMs = 30000,
  useDataStore,
}: Readonly<InputProps>) {

    const [currentTime, setCurrentTime] = useState(Date.now());
    const [latestSample, setLatestSample] = useState<TelemetrySample | undefined>();
    const [historySamples, setHistorySamples] = useState<TelemetrySample[]>([]);

    const shouldUseDataStore = useDataStore ?? data === undefined;

    useEffect(() => {
        const interval = setInterval(() => setCurrentTime(Date.now()), 100);
        return () => clearInterval(interval);
    }, []);

    const effectiveLastUpdated = latestSample?.timestamp ?? lastUpdated;
    const effectiveRawData = latestSample?.rawData ?? rawData;
    const effectiveMessageName = latestSample?.messageName ?? messageName ?? msgID;

    const timeDiff = effectiveLastUpdated ? currentTime - effectiveLastUpdated : 0;

    const updateFromStore = useCallback(() => {
      const sample = dataStore.getLatest(msgID);
      setLatestSample(sample);
      if (historyWindowMs > 0) {
        setHistorySamples(dataStore.getHistory(msgID, historyWindowMs));
      }
    }, [msgID, historyWindowMs]);

    useEffect(() => {
      if (!shouldUseDataStore) return;

      updateFromStore();
      const unsubscribe = dataStore.subscribe(updateFromStore);
      return () => unsubscribe();
    }, [shouldUseDataStore, updateFromStore]);

    const historyCount = historySamples.length;

    const computedCategory = useMemo(() => {
        if (category) return category;
        const sourceData = shouldUseDataStore && latestSample
          ? Object.keys(latestSample.data).map((key) => ({ [key]: latestSample.data[key].rawValue ?? "" }))
          : data;
        if (!sourceData || sourceData.length === 0) return "NO CAT";
        const signalNames = sourceData.flatMap(obj => Object.keys(obj));
        const hasINV = signalNames.some(name => name.includes("INV"));
        const hasBMS = signalNames.some(name => name.includes("BMS") || name.includes("TORCH")) || effectiveMessageName.includes("TORCH");
        const hasVCU = signalNames.some(name => name.includes("VCU"));
        if (hasVCU) return "VCU";
        else if (hasBMS) return "BMS/TORCH";
        else if (hasINV) return "INV";
        else return "NO CAT";
    }, [category, data, latestSample, shouldUseDataStore, effectiveMessageName, messageName]);

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
    const rows = useMemo<DataPair[]>(() => {
      if (shouldUseDataStore) {
        if (!latestSample) {
          return [];
        }

        return Object.entries(latestSample.data).map(([label, value]) => [
          label,
          formatSignal(value),
        ]);
      }

      if (data && data.length > 0) {
        return parseCardDataProp(data);
      }

      return DEFAULT_FALLBACK_ROWS;
    }, [shouldUseDataStore, latestSample, data]);

    return (
        //  Data Card
        <div className="w-[400px] m-[10px]" data-history-count={historyCount}>

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
                    <p className="text-white text-[15px] font-semibold ">{effectiveMessageName}</p>
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
                    {rows.length === 0 ? (
                      <div className="text-center text-xs text-white/60 py-4">
                        No decoded signals yet
                      </div>
                    ) : (
                      rows.map(([label, value]) => (
                        <Dropdown
                            key={`${msgID}-${label}`}
                            items={["Graph 1", "Graph 2", "br", "New Graph"]}
                            onSelect={handleMenuSelect}
                            widthClass="w-[120px]"
                            // TODO: Handle menu button events
                        >
                            <div className="grid grid-cols-5 w-full">
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
                      ))
                    )}
                </div>

                <div className="w-90 h-[2px] bg-white self-center rounded-xs"></div>

                {/* Raw Data Display */}
                <div className="h-[50px] flex text-white text-xs items-center justify-start relative">

                    <p id="raw-data" className="font-semibold font-mono">&nbsp;&nbsp;&nbsp;{effectiveRawData || "00 01 02 03 04 05 06 07"}</p>
                    <p id="raw-data-received" className="absolute left-[55%] font-semibold font-mono">Last Update:&nbsp;&nbsp;&nbsp;{timeDiff}ms</p>

                </div>
            </div>



        </div>

    );
}

export default DataCard;
