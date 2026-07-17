import { useMemo } from "react";
import type { Config, Data, Layout, PlotRelayoutEvent } from "plotly.js";
import Plot from "react-plotly.js";

import { buildTraces, parseXRangeRelayout } from "../analysis/plot-traces";
import type { SeriesMap } from "../analysis/series-cache";
import type { SignalSeries } from "../types";

/** Season-independent plot stroke colors (light / dark pairs by hash index). */
const PLOT_PALETTE: Array<{ light: string; dark: string }> = [
  { light: "#2563eb", dark: "#60a5fa" },
  { light: "#c2410c", dark: "#fb923c" },
  { light: "#0d9488", dark: "#2dd4bf" },
  { light: "#7c3aed", dark: "#a78bfa" },
  { light: "#b45309", dark: "#fbbf24" },
  { light: "#15803d", dark: "#4ade80" },
  { light: "#be185d", dark: "#f472b6" },
  { light: "#0e7490", dark: "#22d3ee" },
];

/** djb2 → stable palette index for a signal name (not season). */
export function signalPlotColor(signal: string, theme: "light" | "dark"): string {
  let h = 5381;
  for (let i = 0; i < signal.length; i++) {
    h = (((h << 5) + h) ^ signal.charCodeAt(i)) >>> 0;
  }
  return PLOT_PALETTE[h % PLOT_PALETTE.length][theme];
}

function formatResolution(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function seriesStatus(series: SignalSeries | undefined): {
  modeLabel: string;
  countLabel: string;
  resolutionLabel: string | null;
  emptyMessage: string | null;
} {
  if (!series) {
    return {
      modeLabel: "—",
      countLabel: "no data",
      resolutionLabel: null,
      emptyMessage: "No series loaded for this signal yet.",
    };
  }
  if (series.point_count === 0 || series.t.length === 0) {
    return {
      modeLabel: series.mode === "envelope" ? "envelope" : "raw",
      countLabel: "0 pts",
      resolutionLabel:
        series.mode === "envelope" ? formatResolution(series.resolution_ms) : null,
      emptyMessage: "No samples in the visible range.",
    };
  }
  return {
    modeLabel: series.mode === "envelope" ? "envelope" : "raw",
    countLabel: `${series.point_count.toLocaleString()} pts`,
    resolutionLabel:
      series.mode === "envelope" ? formatResolution(series.resolution_ms) : null,
    emptyMessage: null,
  };
}

export interface AnalysisPlotStackProps {
  seriesBySignal: SeriesMap;
  signals: string[];
  range: [number, number];
  onRangeChange: (startMs: number, endMs: number) => void;
  theme: "light" | "dark";
}

function PlotCard({
  signal,
  series,
  color,
  range,
  isBottom,
  theme,
  onRangeChange,
}: {
  signal: string;
  series: SignalSeries | undefined;
  color: string;
  range: [number, number];
  isBottom: boolean;
  theme: "light" | "dark";
  onRangeChange: (startMs: number, endMs: number) => void;
}) {
  const status = seriesStatus(series);
  const isDark = theme === "dark";
  const chartFont = isDark ? "#e6e8eb" : "#111827";
  const chartGrid = isDark ? "#2c313a" : "#e5e7eb";

  const data = useMemo((): Data[] => {
    if (!series || status.emptyMessage) return [];
    return buildTraces(signal, series, color);
  }, [series, signal, color, status.emptyMessage]);

  const layout = useMemo((): Partial<Layout> => {
    return {
      autosize: true,
      margin: { t: 8, r: 16, b: isBottom ? 36 : 8, l: 52, pad: 2 },
      hovermode: "x unified",
      showlegend: false,
      uirevision: signal,
      font: { color: chartFont, size: 11 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      xaxis: {
        type: "date",
        range: [new Date(range[0]), new Date(range[1])],
        showticklabels: isBottom,
        ticks: isBottom ? "outside" : "",
        gridcolor: chartGrid,
        zeroline: false,
        showspikes: true,
        spikemode: "across",
      },
      yaxis: {
        zeroline: false,
        gridcolor: chartGrid,
        fixedrange: true,
      },
    };
  }, [signal, range, isBottom, chartFont, chartGrid]);

  const config = useMemo(
    (): Partial<Config> => ({
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
    }),
    [],
  );

  const handleRelayout = (event: Readonly<PlotRelayoutEvent>) => {
    const next = parseXRangeRelayout(event);
    if (next === null) return;
    onRangeChange(next[0], next[1]);
  };

  return (
    <article className="analysis-plot-card" data-signal={signal}>
      <header className="analysis-plot-header">
        <h3 className="analysis-plot-title">{signal}</h3>
        <div className="analysis-plot-meta">
          <span className={`analysis-plot-badge is-${status.modeLabel}`}>{status.modeLabel}</span>
          <span className="analysis-plot-count">{status.countLabel}</span>
          {status.resolutionLabel && (
            <span className="analysis-plot-resolution">{status.resolutionLabel}</span>
          )}
        </div>
      </header>
      <div className="analysis-plot-body">
        {status.emptyMessage ? (
          <div className="analysis-plot-empty" role="status">
            {status.emptyMessage}
          </div>
        ) : (
          <Plot
            data={data}
            layout={layout}
            config={config}
            className="analysis-plotly"
            style={PLOT_STYLE}
            useResizeHandler
            onRelayout={handleRelayout}
          />
        )}
      </div>
    </article>
  );
}

/** Explicit px height — percentage fails when the flex body has only min-height (no definite height). */
const PLOT_STYLE = { width: "100%", height: "180px" } as const;

/**
 * Vertically stacked linked plots: one card per selected signal, shared controlled x-range.
 */
export function AnalysisPlotStack({
  seriesBySignal,
  signals,
  range,
  onRangeChange,
  theme,
}: AnalysisPlotStackProps) {
  if (signals.length === 0) {
    return (
      <div className="analysis-plot-stack" data-empty="true">
        <div className="analysis-plot-empty" role="status">
          Select one or more signals to plot.
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-plot-stack">
      {signals.map((signal, index) => (
        <PlotCard
          key={signal}
          signal={signal}
          series={seriesBySignal[signal]}
          color={signalPlotColor(signal, theme)}
          range={range}
          isBottom={index === signals.length - 1}
          theme={theme}
          onRangeChange={onRangeChange}
        />
      ))}
    </div>
  );
}
