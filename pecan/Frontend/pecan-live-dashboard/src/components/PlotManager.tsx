import { useEffect, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { dataStore } from "../lib/DataStore";

// Helper to calculate downsample resolution based on time window
function calculateDownsampleResolution(windowMs: number): number {
  // Under 3s (3000ms), use 200ms resolution
  if (windowMs <= 3000) return 200;
  // Above 20s (20000ms), use 1000ms resolution
  if (windowMs >= 20000) return 1000;

  // Linear interpolation between 3000ms and 20000ms
  // Range: 17000ms. Value range: 800ms.
  return 200 + ((windowMs - 3000) / 17000) * 800;
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [chartData, setChartData] = useState<any[]>([]);

  // Update plot data
  useEffect(() => {
    if (signals.length === 0) {
      setChartData([]);
      return;
    }

    const updateInterval = setInterval(() => {
      const now = Date.now();
      const resolution = calculateDownsampleResolution(timeWindowMs);

      const newChartData = signals.map((signal) => {
        const history = dataStore.getHistory(signal.msgID, timeWindowMs);
        const dataPoints: { x: number; y: number }[] = [];

        if (history.length > 0) {
          let currentBinStart =
            Math.floor(history[0].timestamp / resolution) * resolution;
          let currentSum = 0;
          let currentCount = 0;

          for (const sample of history) {
            const signalData = sample.data[signal.signalName];
            if (signalData === undefined) continue;

            const sampleBin =
              Math.floor(sample.timestamp / resolution) * resolution;

            if (sampleBin === currentBinStart) {
              currentSum += signalData.sensorReading;
              currentCount++;
            } else {
              // Finalize previous bin
              if (currentCount > 0) {
                const avg = currentSum / currentCount;
                const x = (currentBinStart - now) / 1000;
                dataPoints.push({ x, y: avg });
              }

              // Move to new bin
              // If there's a gap, we just jump to the new bin start
              currentBinStart = sampleBin;
              currentSum = signalData.sensorReading;
              currentCount = 1;
            }
          }

          // Finalize last bin
          if (currentCount > 0) {
            const avg = currentSum / currentCount;
            const x = (currentBinStart - now) / 1000;
            dataPoints.push({ x, y: avg });
          }
        }

        return {
          id: `${signal.messageName} - ${signal.signalName}`,
          data: dataPoints,
        };
      });

      setChartData(newChartData);
    }, 100); // Update every 100ms

    return () => clearInterval(updateInterval);
  }, [signals, timeWindowMs]);

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
      <div className="w-full h-[300px] rounded bg-[#1a1a1a]">
        {chartData.length > 0 ? (
          <ResponsiveLine
            data={chartData}
            margin={{ top: 20, right: 110, bottom: 50, left: 60 }}
            xScale={{ type: "linear", min: -(timeWindowMs / 1000), max: 0 }}
            yScale={{
              type: "linear",
              min: "auto",
              max: "auto",
              stacked: false,
              reverse: false,
            }}
            axisTop={null}
            axisRight={null}
            axisBottom={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: "Time (s)",
              legendOffset: 36,
              legendPosition: "middle",
              format: (v: any) => `${Math.round(Number(v))}`,
            }}
            axisLeft={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: "Value",
              legendOffset: -40,
              legendPosition: "middle",
            }}
            pointSize={0}
            useMesh={true}
            enableGridX={true}
            enableGridY={true}
            theme={{
              axis: {
                ticks: {
                  text: { fill: "#ffffff" },
                },
                legend: {
                  text: { fill: "#ffffff" },
                },
              },
              grid: {
                line: { stroke: "#444444" },
              },
              text: {
                fill: "#ffffff",
              },
              crosshair: {
                line: {
                    stroke: '#ffffff',
                    strokeWidth: 1,
                    strokeOpacity: 0.35,
                },
            },
            }}
            colors={{ scheme: "nivo" }}
            animate={false}
            isInteractive={true}
            legends={[
                {
                    anchor: 'bottom-right',
                    direction: 'column',
                    justify: false,
                    translateX: 100,
                    translateY: 0,
                    itemsSpacing: 0,
                    itemDirection: 'left-to-right',
                    itemWidth: 80,
                    itemHeight: 20,
                    itemOpacity: 0.75,
                    symbolSize: 12,
                    symbolShape: 'circle',
                    symbolBorderColor: 'rgba(0, 0, 0, .5)',
                    effects: [
                        {
                            on: 'hover',
                            style: {
                                itemBackground: 'rgba(0, 0, 0, .03)',
                                itemOpacity: 1
                            }
                        }
                    ],
                    itemTextColor: '#ffffff'
                }
            ]}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-500">
            {signals.length > 0 ? "Waiting for data..." : "No data available"}
          </div>
        )}
      </div>

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