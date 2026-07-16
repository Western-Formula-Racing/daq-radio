import type { SignalSeries } from "../../types/analysis";

// Hex color to rgba with alpha, for the envelope band fill
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildTraces(
  signal: string,
  series: SignalSeries,
  yaxis: string,
  color: string,
): object[] {
  const x = series.t.map((ms) => new Date(ms));
  if (series.mode === "raw") {
    return [
      {
        type: "scattergl",
        mode: "lines",
        name: signal,
        x,
        y: series.v ?? [],
        line: { color, width: 1 },
        yaxis,
        hovertemplate: "%{y:.4g}<extra>" + signal + "</extra>",
      },
    ];
  }
  // Envelope: max first, then min filled to it, then the mean line on top
  return [
    {
      type: "scattergl",
      mode: "lines",
      name: `${signal} max`,
      x,
      y: series.max ?? [],
      line: { color: withAlpha(color, 0.0), width: 0 },
      yaxis,
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      type: "scattergl",
      mode: "lines",
      name: `${signal} min`,
      x,
      y: series.min ?? [],
      line: { color: withAlpha(color, 0.0), width: 0 },
      fill: "tonexty",
      fillcolor: withAlpha(color, 0.25),
      yaxis,
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      type: "scattergl",
      mode: "lines",
      name: `${signal} (envelope avg)`,
      x,
      y: series.avg ?? [],
      line: { color, width: 1 },
      yaxis,
      hovertemplate: "%{y:.4g}<extra>" + signal + "</extra>",
    },
  ];
}
