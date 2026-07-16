import { useEffect, useMemo, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import type { SignalSeries } from "../../types/analysis";
import { buildTraces } from "../../lib/analysis/plotTraces";

const PLOT_COLORS = [
  "#e8c1a0", "#f47560", "#f1e15b", "#e8a838", "#61cdbb", "#97e3d5", "#00bbcc",
];

interface PlotStackProps {
  seriesBySignal: Record<string, SignalSeries>;
  plotGroups: string[][]; // each group renders as one stacked subplot row
  rangeMs: [number, number];
  onRangeChange: (startMs: number, endMs: number) => void;
}

export default function PlotStack({
  seriesBySignal,
  plotGroups,
  rangeMs,
  onRangeChange,
}: PlotStackProps) {
  const divRef = useRef<HTMLDivElement>(null);

  const { traces, layout } = useMemo(() => {
    const traces: object[] = [];
    const layout: Record<string, unknown> = {
      hovermode: "x unified",
      showlegend: true,
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { color: "#a1a1aa", size: 11 },
      margin: { l: 56, r: 16, t: 8, b: 32 },
      grid: { rows: Math.max(plotGroups.length, 1), columns: 1, pattern: "independent" },
      legend: { orientation: "h" },
    };
    let colorIdx = 0;
    plotGroups.forEach((group, row) => {
      const axisSuffix = row === 0 ? "" : String(row + 1);
      const yaxisName = `y${axisSuffix}`;
      // All subplots share x: linked zoom and pan across the stack
      layout[`xaxis${axisSuffix}`] = {
        type: "date",
        matches: row === 0 ? undefined : "x",
        range: [new Date(rangeMs[0]), new Date(rangeMs[1])],
        gridcolor: "#27272a",
        showticklabels: row === plotGroups.length - 1,
      };
      layout[`yaxis${axisSuffix}`] = { gridcolor: "#27272a", zeroline: false };
      group.forEach((sig) => {
        const series = seriesBySignal[sig];
        if (!series) return;
        const color = PLOT_COLORS[colorIdx++ % PLOT_COLORS.length];
        traces.push(...buildTraces(sig, series, yaxisName, color));
      });
    });
    return { traces, layout };
  }, [seriesBySignal, plotGroups, rangeMs]);

  useEffect(() => {
    const div = divRef.current;
    if (!div) return;
    void Plotly.react(div, traces as never, layout as never, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    });
  }, [traces, layout]);

  useEffect(() => {
    const div = divRef.current as (HTMLDivElement & {
      on?: (event: string, cb: (e: Record<string, unknown>) => void) => void;
      removeAllListeners?: (event: string) => void;
    }) | null;
    if (!div?.on) return;
    const handler = (e: Record<string, unknown>) => {
      const start = e["xaxis.range[0]"] as string | undefined;
      const end = e["xaxis.range[1]"] as string | undefined;
      if (start && end) onRangeChange(Date.parse(start), Date.parse(end));
      // Double-click autoscale resets to the full selected window
      if (e["xaxis.autorange"]) onRangeChange(NaN, NaN);
    };
    div.on("plotly_relayout", handler);
    return () => div.removeAllListeners?.("plotly_relayout");
  }, [onRangeChange]);

  return <div ref={divRef} className="h-full w-full" />;
}
