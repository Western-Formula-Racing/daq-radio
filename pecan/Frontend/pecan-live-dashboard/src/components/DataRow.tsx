import { useState, useMemo, useEffect } from "react";
import { determineCategory, getCategoryColor } from "../config/categories";

interface DataRowProps {
    msgID: string;
    name: string;
    category?: string;
    data?: Record<string, string>[];
    rawData: string;
    lastUpdated: number;
    index: number; // for alternating row colors
}

export default function DataRow({ msgID, name, category, data, rawData, lastUpdated, index }: Readonly<DataRowProps>) {

    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => setCurrentTime(Date.now()), 100);
        return () => clearInterval(interval);
    }, []);

    const timeDiff = lastUpdated ? currentTime - lastUpdated : 0;

    const computedCategory = useMemo(() => {
        return determineCategory(msgID, category);
    }, [category, msgID]);

    const categoryColor = useMemo(() => {
        return getCategoryColor(computedCategory);
    }, [computedCategory]);

    // Alternating row background 
    const rowBg = index % 2 === 0 ? "bg-sidebar" : "bg-data-module-bg";

    const [open, setOpen] = useState(false);

    const rows = useMemo(() => {
        if (!data || !data.length) return [] as [string, string][];
        return data.map((obj) => {
            const [label, value] = Object.entries(obj)[0] ?? ["", ""];
            return [String(label), String(value)] as [string, string];
        });
    }, [data]);

    const toggle = () => setOpen((v) => !v);

    return (
        <div className="w-full">
            <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={toggle}
                className={`grid grid-cols-12 text-white text-sm h-[50px] ${rowBg} cursor-pointer transition hover:bg-data-textbox-bg/50`}
            >

                {/* Msg ID column */}
                <div className="col-span-1 flex justify-left items-center ps-3">
                    {msgID}
                </div>

                {/* Message name column */}
                <div className="col-span-4 flex justify-left items-center px-3 truncate">
                    {name}
                </div>

                {/* Category column with coloured background */}
                <div className={`col-span-2 flex justify-left items-center px-3 font-bold text-xs ${categoryColor}`}>
                    {computedCategory}
                </div>

                {/* Data column */}
                <div className="col-span-4 flex justify-left items-center px-3 truncate">
                    {rawData}
                </div>

                {/* Time column */}
                <div className="col-span-1 flex justify-left items-center pe-3">
                    {timeDiff}ms
                </div>
            </div>

            <div
                className={[
                    "overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out",
                    `${rowBg}`,
                    open ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0 pointer-events-none",
                ].join(" ")}
            >
                {/* Inner panel */}
                <div className="rounded-lg p-2">
                    {/* Two-column grid of label/value rows */}
                    <div className="grid grid-cols-5 border-3 border-data-textbox-bg">
                        <div className="col-span-2">
                            <div className="w-full text-white text-sm font-semibold py-2 px-3 text-left border-b-3 border-data-textbox-bg bg-data-textbox-bg/50">
                                Sensor
                            </div>
                        </div>
                        <div className="col-span-3">
                            <div className="w-full text-white text-sm font-semibold py-2 px-3 text-left border-b-3 border-l-3 border-data-textbox-bg bg-data-textbox-bg/50">
                                Value
                            </div>
                        </div>
                        {rows.map(([label, value], idx) => (
                            <div key={`${label}-${idx}`} className="col-span-5 grid grid-cols-5">
                                <div className="col-span-2">
                                    <div className="w-full text-white text-sm font-semibold py-2 px-3 text-left">
                                        {label}
                                    </div>
                                </div>
                                <div className="col-span-3 border-l-3 border-data-textbox-bg">
                                    <div className="w-full text-white text-sm font-semibold py-2 px-3 text-left">
                                        {value}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
