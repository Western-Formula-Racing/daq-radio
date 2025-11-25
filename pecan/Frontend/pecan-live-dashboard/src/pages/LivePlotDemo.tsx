import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { useAllMessageIds, useLatestMessage } from "../lib/useDataStore";
import { useLiveSeries } from "../lib/useLiveSeries";
import { processTestMessages } from "../utils/canProcessor";

const WINDOW_MS = 60_000;

function LivePlotDemo() {
  const messageIds = useAllMessageIds();
  const [msgID, setMsgID] = useState<string>("");
  const latest = useLatestMessage(msgID);

  const signalOptions = useMemo(
    () => (latest ? Object.keys(latest.data) : []),
    [latest]
  );
  const [signal, setSignal] = useState<string>("");

  // Keep selections in sync with available data
  useEffect(() => {
    if (!msgID && messageIds.length > 0) {
      setMsgID(messageIds[0]);
    } else if (msgID && !messageIds.includes(msgID)) {
      setMsgID(messageIds[0] ?? "");
    }
  }, [messageIds, msgID]);

  useEffect(() => {
    if (!signal && signalOptions.length > 0) {
      setSignal(signalOptions[0]);
    } else if (signal && !signalOptions.includes(signal)) {
      setSignal(signalOptions[0] ?? "");
    }
  }, [signalOptions, signal]);

  const { x, y, unit } = useLiveSeries(msgID, signal, WINDOW_MS);
  const hasData = x.length > 0;

  const handleInject = async () => {
    await processTestMessages();
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Live Plot Prototype</h1>
        <span className="text-sm text-gray-500">
          Streams the last {WINDOW_MS / 1000} seconds from the in-browser
          datastore.
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-3 bg-gray-100 rounded px-4 py-3">
        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Message ID</label>
          <select
            className="border rounded px-3 py-2 min-w-[140px]"
            value={msgID}
            onChange={(e) => setMsgID(e.target.value)}
          >
            <option value="">Select a CAN ID</option>
            {messageIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Signal</label>
          <select
            className="border rounded px-3 py-2 min-w-[160px]"
            value={signal}
            onChange={(e) => setSignal(e.target.value)}
            disabled={!signalOptions.length}
          >
            <option value="">Select a signal</option>
            {signalOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <button
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
          onClick={handleInject}
        >
          Inject demo CAN data
        </button>

        <div className="text-sm text-gray-600 ml-auto">
          {msgID ? (
            <>
              <span className="font-semibold">{msgID}</span>{" "}
              {latest?.messageName ? `• ${latest.messageName}` : null}
            </>
          ) : (
            <span>Waiting for CAN data...</span>
          )}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border p-3">
        <Plot
          data={[
            {
              x,
              y,
              type: "scattergl",
              mode: "lines+markers",
              marker: { size: 6, color: "#2563eb" },
              line: { color: "#2563eb", width: 2 },
              name: signal || "Value",
            },
          ]}
          layout={{
            autosize: true,
            height: 420,
            margin: { l: 60, r: 20, t: 40, b: 60 },
            paper_bgcolor: "#ffffff",
            plot_bgcolor: "#ffffff",
            title: {
              text:
                signal && msgID
                  ? `${signal} from ${msgID}`
                  : "Select a CAN ID + signal",
            },
            xaxis: {
              title: { text: "Time" },
              type: "date",
              rangemode: "nonnegative",
            },
            yaxis: {
              title: { text: unit ? `${signal} (${unit})` : signal || "Value" },
              rangemode: "tozero",
            },
            uirevision: `${msgID}-${signal}`,
          }}
          config={{
            displaylogo: false,
            responsive: true,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
          }}
          style={{ width: "100%" }}
        />

        {!hasData && (
          <div className="text-sm text-gray-600 px-1">
            Click “Inject demo CAN data” to populate the datastore, then pick a
            message + signal to stream.
          </div>
        )}
      </div>
    </div>
  );
}

export default LivePlotDemo;
