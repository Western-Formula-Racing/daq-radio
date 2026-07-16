import type { Data, PlotData, PlotRelayoutEvent } from "plotly.js";

import type { SignalSeries } from "../types";

/** Hex (#rgb / #rrggbb) → rgba() with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function toDateX(t: number[]): Date[] {
  return t.map((ms) => new Date(ms));
}

/**
 * Build Plotly scattergl traces for one signal.
 * Envelope order is max → min (fill tonexty) → avg so the band fills correctly.
 */
export function buildTraces(signal: string, series: SignalSeries, color: string): Data[] {
  const x = toDateX(series.t);

  if (series.mode === "raw") {
    const trace: Partial<PlotData> = {
      type: "scattergl",
      mode: "lines",
      name: signal,
      x,
      y: series.v,
      line: { color, width: 1.5 },
      hovertemplate: "%{y:.4g}<extra>" + signal + "</extra>",
    };
    return [trace as Data];
  }

  const transparent = withAlpha(color, 0);
  const fill = withAlpha(color, 0.25);

  const maxTrace: Partial<PlotData> = {
    type: "scattergl",
    mode: "lines",
    name: `${signal} max`,
    x,
    y: series.max,
    line: { color: transparent, width: 0 },
    showlegend: false,
    hoverinfo: "skip",
  };

  const minTrace: Partial<PlotData> = {
    type: "scattergl",
    mode: "lines",
    name: `${signal} min`,
    x,
    y: series.min,
    line: { color: transparent, width: 0 },
    fill: "tonexty",
    fillcolor: fill,
    showlegend: false,
    hoverinfo: "skip",
  };

  const avgTrace: Partial<PlotData> = {
    type: "scattergl",
    mode: "lines",
    name: `${signal} (avg)`,
    x,
    y: series.avg,
    line: { color, width: 1.5 },
    hovertemplate: "%{y:.4g}<extra>" + signal + "</extra>",
  };

  return [maxTrace as Data, minTrace as Data, avgTrace as Data];
}

/** Normalize a Plotly relayout bound to finite epoch ms, or null if invalid. */
function normalizeRelayoutBound(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Parse a user x-axis relayout into millisecond bounds.
 * Returns `null` when the event has no x-range / autorange keys (ignore to avoid feedback loops),
 * or when bounds are missing/invalid/non-finite/reversed-or-equal.
 * Returns `[NaN, NaN]` only when autorange is requested (double-click reset).
 */
export function parseXRangeRelayout(
  event: Readonly<PlotRelayoutEvent>,
): [number, number] | null {
  const record = event as Readonly<Record<string, unknown>>;

  if (record["xaxis.autorange"] === true) {
    return [Number.NaN, Number.NaN];
  }

  let startRaw: unknown;
  let endRaw: unknown;

  if ("xaxis.range[0]" in record && "xaxis.range[1]" in record) {
    startRaw = record["xaxis.range[0]"];
    endRaw = record["xaxis.range[1]"];
  } else {
    const range = record["xaxis.range"];
    if (!Array.isArray(range) || range.length < 2) {
      return null;
    }
    startRaw = range[0];
    endRaw = range[1];
  }

  const start = normalizeRelayoutBound(startRaw);
  const end = normalizeRelayoutBound(endRaw);
  if (start === null || end === null || !(start < end)) {
    return null;
  }
  return [start, end];
}
