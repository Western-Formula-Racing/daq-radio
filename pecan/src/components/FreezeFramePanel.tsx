/** The seconds leading up to a replay fault, one small chart per signal.
 *
 * Numeric signals get a sparkline. A string signal is not a magnitude, so
 * plotting it as one would invent an ordering the DBC never claimed; it is drawn
 * as a stepped line with the value written at each change instead.
 */
import type { WcarsAlert } from "../lib/wcars/engine/types";

const WIDTH = 240;
const HEIGHT = 40;
const PAD = 4;

export type FreezeSamples = Record<string, [number, number | string][]>;

interface FreezeFramePanelProps {
  alert: WcarsAlert;
  samples: FreezeSamples;
  /** Fire moment, in the same timescale as the sample timestamps. */
  atTsMs: number;
  windowMs: number;
  onClose?: () => void;
  formatTime?: (ts: number) => string;
}

function xAt(ts: number, fromMs: number, windowMs: number): number {
  const ratio = windowMs > 0 ? (ts - fromMs) / windowMs : 1;
  const clamped = Math.min(1, Math.max(0, ratio));
  return PAD + clamped * (WIDTH - 2 * PAD);
}

function NumericSpark({ series, fromMs, windowMs }: {
  series: [number, number][];
  fromMs: number;
  windowMs: number;
}) {
  let min = Infinity;
  let max = -Infinity;
  for (const [, value] of series) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // A flat signal has no range to normalize against, so it is centered rather
  // than divided by zero.
  const span = max - min;
  const yAt = (value: number) => (span > 0
    ? HEIGHT - PAD - ((value - min) / span) * (HEIGHT - 2 * PAD)
    : HEIGHT / 2);
  const points = series
    .map(([ts, value]) => `${xAt(ts, fromMs, windowMs).toFixed(1)},${yAt(value).toFixed(1)}`)
    .join(" ");

  return (
    <>
      <polyline points={points} fill="none" stroke="#67e8f9" strokeWidth={1.5} />
      {series.length === 1 && (
        <circle cx={xAt(series[0][0], fromMs, windowMs)} cy={yAt(series[0][1])} r={2} fill="#67e8f9" />
      )}
    </>
  );
}

function StringSteps({ series, fromMs, windowMs }: {
  series: [number, string][];
  fromMs: number;
  windowMs: number;
}) {
  const levels: string[] = [];
  for (const [, value] of series) if (!levels.includes(value)) levels.push(value);
  const rows = Math.max(1, levels.length);
  const yFor = (value: string) => PAD + ((levels.indexOf(value) + 0.5) / rows) * (HEIGHT - 2 * PAD);

  const segments: string[] = [];
  let previous: [number, string] | null = null;
  const labels: { x: number; y: number; text: string }[] = [];
  for (const [ts, value] of series) {
    const x = xAt(ts, fromMs, windowMs);
    const y = yFor(value);
    if (previous === null) {
      segments.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
      labels.push({ x, y, text: value });
    } else {
      const priorY = yFor(previous[1]);
      segments.push(`L ${x.toFixed(1)} ${priorY.toFixed(1)}`);
      if (previous[1] !== value) {
        segments.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
        labels.push({ x, y, text: value });
      }
    }
    previous = [ts, value];
  }
  if (previous !== null) {
    segments.push(`L ${xAt(fromMs + windowMs, fromMs, windowMs).toFixed(1)} ${yFor(previous[1]).toFixed(1)}`);
  }

  return (
    <>
      <path d={segments.join(" ")} fill="none" stroke="#c4b5fd" strokeWidth={1.5} />
      {labels.map((label, i) => (
        <text
          key={`${label.text}-${i}`}
          x={Math.min(label.x + 3, WIDTH - 2)}
          y={Math.max(label.y - 3, 8)}
          fontSize={8}
          fill="#ddd6fe"
        >
          {label.text}
        </text>
      ))}
    </>
  );
}

function FreezeFramePanel({ alert, samples, atTsMs, windowMs, onClose, formatTime }: FreezeFramePanelProps) {
  const fromMs = atTsMs - windowMs;
  const names = Object.keys(samples).sort();
  const when = formatTime ? formatTime(alert.ts) : `${alert.ts} ms`;

  return (
    <section
      className="rounded-lg border border-white/10 bg-data-module-bg p-4"
      data-testid="freeze-frame-panel"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="app-section-title">Freeze Frame</h2>
        <span className="rounded border border-white/20 bg-black/20 px-2 py-1 font-mono text-xs uppercase text-slate-300">
          {alert.title}
        </span>
        <span className="rounded border border-white/20 bg-black/20 px-2 py-1 font-mono text-xs uppercase text-slate-300">
          {when}
        </span>
        {onClose && (
          <button
            type="button"
            className="trace-btn trace-btn-subtle !text-[10px] !px-2 !py-1 ml-auto"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>

      <p className="mb-3 text-xs text-slate-400">
        The {Math.round(windowMs / 1000)} seconds of recorded data before this rule fired. The
        dashed line marks the moment it fired.
      </p>

      {names.length === 0 ? (
        <p className="text-sm text-slate-400" data-testid="freeze-frame-empty">
          No samples for this rule's signals in the window before it fired.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {names.map((name) => {
            const series = samples[name];
            const isText = series.some(([, value]) => typeof value === "string");
            const last = series.length > 0 ? series[series.length - 1][1] : "-";
            return (
              <div
                key={name}
                data-testid={`freeze-signal-${name}`}
                className="rounded border border-white/10 bg-black/20 p-2"
              >
                <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-slate-300">
                  <span>{name}</span>
                  <span className="text-slate-400">{String(last)}</span>
                </div>
                <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-10 w-full" role="img" aria-label={`${name} freeze frame`}>
                  {isText
                    ? <StringSteps series={series.map(([ts, v]) => [ts, String(v)])} fromMs={fromMs} windowMs={windowMs} />
                    : <NumericSpark series={series.map(([ts, v]) => [ts, Number(v)])} fromMs={fromMs} windowMs={windowMs} />}
                  <line
                    x1={WIDTH - PAD}
                    x2={WIDTH - PAD}
                    y1={0}
                    y2={HEIGHT}
                    stroke="#f87171"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default FreezeFramePanel;
