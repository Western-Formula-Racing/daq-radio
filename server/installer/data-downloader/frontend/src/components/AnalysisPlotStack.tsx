import { useMemo, useState } from "react";
import type { Config, Data, Layout, PlotRelayoutEvent } from "plotly.js";
import Plot from "react-plotly.js";

import { NEW_PLOT, type PlotGroup, type PlotLayout } from "../analysis/plot-layout";
import { buildTraces, parseXRangeRelayout, PLOT_AREA_MARGIN } from "../analysis/plot-traces";
import type { SeriesMap } from "../analysis/series-cache";
import { plotStroke } from "./sensor-palette";

export const SIGNALS_MIME = "application/x-wfr-signals";

/** Parse the custom drag payload; null for foreign or malformed drops. */
export function readSignalsPayload(dt: DataTransfer | null): string[] | null {
  if (!dt) return null;
  const raw = dt.getData(SIGNALS_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { signals?: unknown };
    if (!Array.isArray(parsed.signals)) return null;
    const signals = parsed.signals.filter((s): s is string => typeof s === "string");
    return signals.length > 0 ? signals : null;
  } catch {
    return null;
  }
}

export interface AnalysisPlotStackProps {
  layout: PlotLayout;
  seriesBySignal: SeriesMap;
  range: [number, number];
  onRangeChange: (startMs: number, endMs: number) => void;
  onAssignSignals: (signals: string[], target: string) => void;
  onRemoveSignal: (signal: string) => void;
  onToggleRightAxis: (groupId: string, signal: string) => void;
  theme: "light" | "dark";
}

/** Explicit px height, percentage fails when the flex body has only min-height (no definite height). */
const PLOT_STYLE = { width: "100%", height: "180px" } as const;

function totalPoints(group: PlotGroup, seriesBySignal: SeriesMap): number {
  return group.signals.reduce(
    (sum, s) => sum + (seriesBySignal[s]?.point_count ?? 0),
    0,
  );
}

function PlotCard({
  group,
  seriesBySignal,
  range,
  isBottom,
  theme,
  onRangeChange,
  onAssignSignals,
  onRemoveSignal,
  onToggleRightAxis,
}: {
  group: PlotGroup;
  seriesBySignal: SeriesMap;
  range: [number, number];
  isBottom: boolean;
  theme: "light" | "dark";
  onRangeChange: (startMs: number, endMs: number) => void;
  onAssignSignals: (signals: string[], target: string) => void;
  onRemoveSignal: (signal: string) => void;
  onToggleRightAxis: (groupId: string, signal: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const isDark = theme === "dark";
  const chartFont = isDark ? "#e6e8eb" : "#111827";
  const chartGrid = isDark ? "#2c313a" : "#e5e7eb";
  const rightSet = useMemo(() => new Set(group.rightAxis), [group.rightAxis]);
  const showAxisBadges = group.signals.length > 1;

  const data = useMemo((): Data[] => {
    return group.signals.flatMap((signal) => {
      const series = seriesBySignal[signal];
      if (!series || series.point_count === 0 || series.t.length === 0) return [];
      return buildTraces(
        signal,
        series,
        plotStroke(signal, theme),
        rightSet.has(signal) ? "y2" : "y",
      );
    });
  }, [group.signals, seriesBySignal, theme, rightSet]);

  const hasRight = group.signals.some((s) => rightSet.has(s));

  const layout = useMemo((): Partial<Layout> => {
    const base: Partial<Layout> = {
      autosize: true,
      margin: {
        t: 8,
        r: hasRight ? 52 : PLOT_AREA_MARGIN.right,
        b: isBottom ? 36 : 8,
        l: PLOT_AREA_MARGIN.left,
        pad: 2,
      },
      hovermode: "x unified",
      showlegend: false,
      uirevision: group.id,
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
      yaxis: { zeroline: false, gridcolor: chartGrid, fixedrange: true },
    };
    if (hasRight) {
      base.yaxis2 = {
        overlaying: "y",
        side: "right",
        zeroline: false,
        showgrid: false,
        fixedrange: true,
      };
    }
    return base;
  }, [group.id, range, isBottom, chartFont, chartGrid, hasRight]);

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

  const points = totalPoints(group, seriesBySignal);

  return (
    <article
      className={dragOver ? "analysis-plot-card is-drop-target" : "analysis-plot-card"}
      data-testid="analysis-plot-card"
      data-group={group.id}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SIGNALS_MIME)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const signals = readSignalsPayload(e.dataTransfer);
        if (signals) onAssignSignals(signals, group.id);
      }}
    >
      <header className="analysis-plot-header">
        <div className="analysis-plot-legend">
          {group.signals.map((signal) => {
            const series = seriesBySignal[signal];
            const mode = series ? series.mode : "none";
            const onRight = rightSet.has(signal);
            return (
              <span
                key={signal}
                className="analysis-legend-chip"
                style={{ borderColor: plotStroke(signal, theme) }}
                title={`${signal}: ${mode}, ${series?.point_count ?? 0} pts`}
              >
                <span
                  className="analysis-legend-swatch"
                  style={{ background: plotStroke(signal, theme) }}
                  aria-hidden="true"
                />
                {signal}
                {showAxisBadges && (
                  <button
                    type="button"
                    className="analysis-legend-axis"
                    aria-label={
                      onRight
                        ? `Move ${signal} to the left axis`
                        : `Move ${signal} to the right axis`
                    }
                    onClick={() => onToggleRightAxis(group.id, signal)}
                  >
                    {onRight ? "R" : "L"}
                  </button>
                )}
                <button
                  type="button"
                  className="analysis-legend-remove"
                  aria-label={`Remove ${signal} from this plot`}
                  onClick={() => onRemoveSignal(signal)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <span className="analysis-plot-count">{points.toLocaleString()} pts</span>
      </header>
      <div className="analysis-plot-body">
        {data.length === 0 ? (
          <div className="analysis-plot-empty" role="status">
            No samples in the visible range.
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

/** Drop target that creates a new plot group from the dragged signals. */
function NewPlotDropZone({
  onAssignSignals,
  label,
  empty,
}: {
  onAssignSignals: (signals: string[], target: string) => void;
  label: string;
  empty?: boolean;
}) {
  const [zoneOver, setZoneOver] = useState(false);
  return (
    <div
      className={
        zoneOver
          ? empty
            ? "analysis-idle is-drop-target"
            : "analysis-new-plot-zone is-drop-target"
          : empty
            ? "analysis-idle"
            : "analysis-new-plot-zone"
      }
      data-testid="analysis-new-plot-zone"
      role="status"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SIGNALS_MIME)) {
          e.preventDefault();
          setZoneOver(true);
        }
      }}
      onDragLeave={() => setZoneOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setZoneOver(false);
        const signals = readSignalsPayload(e.dataTransfer);
        if (signals) onAssignSignals(signals, NEW_PLOT);
      }}
    >
      {label}
    </div>
  );
}

/**
 * Vertically stacked linked plots: one card per plot group, shared controlled x-range.
 */
export function AnalysisPlotStack({
  layout,
  seriesBySignal,
  range,
  onRangeChange,
  onAssignSignals,
  onRemoveSignal,
  onToggleRightAxis,
  theme,
}: AnalysisPlotStackProps) {
  if (layout.length === 0) {
    return (
      <div className="analysis-plot-stack" data-empty="true">
        <NewPlotDropZone
          onAssignSignals={onAssignSignals}
          empty
          label="Select or drop one or more signals to load linked plots."
        />
      </div>
    );
  }

  return (
    <div className="analysis-plot-stack">
      {layout.map((group, index) => (
        <PlotCard
          key={group.id}
          group={group}
          seriesBySignal={seriesBySignal}
          range={range}
          isBottom={index === layout.length - 1}
          theme={theme}
          onRangeChange={onRangeChange}
          onAssignSignals={onAssignSignals}
          onRemoveSignal={onRemoveSignal}
          onToggleRightAxis={onToggleRightAxis}
        />
      ))}
      <NewPlotDropZone
        onAssignSignals={onAssignSignals}
        label="Drop signals here for a new plot"
      />
    </div>
  );
}
