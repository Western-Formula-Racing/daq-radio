import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { dataStore } from "../lib/DataStore";

export interface PlotSignal {
  msgID: string;
  signalName: string;
  messageName: string;
  unit: string;
}

interface PlotManagerProps {
  plotId: string;
  signals: PlotSignal[];
  timeWindowMs: number;
  onRemoveSignal: (msgID: string, signalName: string) => void;
  onClosePlot: () => void;
}

function PlotManager({
  plotId,
  signals,
  timeWindowMs,
  onRemoveSignal,
  onClosePlot,
}: PlotManagerProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize the plot
  useEffect(() => {
    if (!plotRef.current || isInitialized) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = {
      title: `Plot ${plotId}`,
      xaxis: {
        title: "Time (s)",
        autorange: true,
      },
      yaxis: {
        title: "Value",
        autorange: true,
      },
      margin: { t: 40, r: 20, b: 40, l: 60 },
      paper_bgcolor: "#1a1a1a",
      plot_bgcolor: "#2a2a2a",
      font: { color: "#ffffff" },
      showlegend: true,
      legend: {
        x: 1,
        xanchor: "right",
        y: 1,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    };

    Plotly.newPlot(plotRef.current, [], layout, config);
    setIsInitialized(true);
  }, [plotId, isInitialized]);

  // Update plot data
  useEffect(() => {
    if (!plotRef.current || !isInitialized || signals.length === 0) return;

    const updateInterval = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const traces: any[] = [];
      const now = Date.now();

      signals.forEach((signal) => {
        const history = dataStore.getHistory(signal.msgID, timeWindowMs);

        // Extract data for this specific signal
        const xData: number[] = [];
        const yData: number[] = [];

        history.forEach((sample) => {
          const signalData = sample.data[signal.signalName];
          if (signalData !== undefined) {
            // Convert timestamp to seconds relative to now (negative for past)
            const timeInSeconds = (sample.timestamp - now) / 1000;
            xData.push(timeInSeconds);
            yData.push(signalData.sensorReading);
          }
        });

        if (xData.length > 0) {
          traces.push({
            x: xData,
            y: yData,
            type: "scatter",
            mode: "lines",
            name: `${signal.messageName} - ${signal.signalName}`,
            line: { width: 2 },
          });
        }
      });

      if (traces.length > 0 && plotRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatedLayout: any = {
          title: `Plot ${plotId}`,
          xaxis: {
            title: "Time (s)",
            range: [-(timeWindowMs / 1000), 0],
          },
          yaxis: {
            title: "Value",
            autorange: true,
          },
          margin: { t: 40, r: 20, b: 40, l: 60 },
          paper_bgcolor: "#1a1a1a",
          plot_bgcolor: "#2a2a2a",
          font: { color: "#ffffff" },
          showlegend: true,
          legend: {
            x: 1,
            xanchor: "right",
            y: 1,
          },
        };
        Plotly.react(plotRef.current, traces, updatedLayout);
      }
    }, 100); // Update every 100ms

    return () => clearInterval(updateInterval);
  }, [signals, timeWindowMs, isInitialized, plotId]);

  return (
    <div className="bg-data-module-bg rounded-md p-3 mb-3">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-white font-semibold">Plot {plotId}</h3>
        <button
          onClick={onClosePlot}
          className="text-red-400 hover:text-red-300 px-2 py-1 rounded"
        >
          ✕
        </button>
      </div>

      {/* Plot container */}
      <div ref={plotRef} className="w-full h-[300px] rounded" />

      {/* Signal list */}
      <div className="mt-2 space-y-1">
        {signals.map((signal) => (
          <div
            key={`${signal.msgID}-${signal.signalName}`}
            className="flex justify-between items-center bg-data-textbox-bg px-2 py-1 rounded text-xs text-gray-300"
          >
            <span>
              {signal.messageName} - {signal.signalName}
            </span>
            <button
              onClick={() => onRemoveSignal(signal.msgID, signal.signalName)}
              className="text-red-400 hover:text-red-300 ml-2"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {signals.length === 0 && (
        <div className="text-center text-gray-500 py-4 text-sm">
          No signals added to this plot
        </div>
      )}
    </div>
  );
}

export default PlotManager;
