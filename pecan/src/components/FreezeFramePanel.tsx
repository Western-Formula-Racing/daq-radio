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
  /** Span drawn past the fire moment, faded. 0 matches what the car records. */
  afterMs?: number;
  onClose?: () => void;
  formatTime?: (ts: number) => string;
}

function xAt(ts: number, fromMs: number, spanMs: number): number {
  const ratio = spanMs > 0 ? (ts - fromMs) / spanMs : 1;
  const clamped = Math.min(1, Math.max(0, ratio));
  return PAD + clamped * (WIDTH - 2 * PAD);
}

/** Split at the fire moment, repeating the boundary sample in both halves so the
 * faded tail starts where the solid lead-up ends instead of leaving a gap. */
function splitAtFire<T extends number | string>(
  series: [number, T][], atTsMs: number,
): { before: [number, T][]; after: [number, T][] } {
  const before = series.filter(([ts]) => ts <= atTsMs);
  const after = series.filter(([ts]) => ts >= atTsMs);
  if (before.length > 0 && after.length > 0 && after[0][0] !== before[before.length - 1][0]) {
    after.unshift(before[before.length - 1]);
  }
  return { before, after };
}

function NumericSpark({ series, fromMs, spanMs, atTsMs }: {
  series: [number, number][];
  fromMs: number;
  spanMs: number;
  atTsMs: number;
}) {
  let min = Infinity;
  let max = -Infinity;
  for (const [, value] of series) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // A flat signal has no range to normalize against, so it is centered rather
  // than divided by zero. Both halves share one scale, so the tail is comparable
  // with the lead-up rather than renormalized against itself.
  const span = max - min;
  const yAt = (value: number) => (span > 0
    ? HEIGHT - PAD - ((value - min) / span) * (HEIGHT - 2 * PAD)
    : HEIGHT / 2);
  const pointsOf = (part: [number, number][]) => part
    .map(([ts, value]) => `${xAt(ts, fromMs, spanMs).toFixed(1)},${yAt(value).toFixed(1)}`)
    .join(" ");
  const { before, after } = splitAtFire(series, atTsMs);

  return (
    <>
      {before.length > 0 && (
        <polyline points={pointsOf(before)} fill="none" stroke="#67e8f9" strokeWidth={1.5} />
      )}
      {after.length > 1 && (
        <polyline
          data-testid="freeze-after-line"
          points={pointsOf(after)}
          fill="none"
          stroke="#67e8f9"
          strokeWidth={1.5}
          strokeOpacity={0.35}
        />
      )}
      {series.length === 1 && (
        <circle cx={xAt(series[0][0], fromMs, spanMs)} cy={yAt(series[0][1])} r={2} fill="#67e8f9" />
      )}
    </>
  );
}

function StringSteps({ series, fromMs, spanMs, atTsMs }: {
  series: [number, string][];
  fromMs: number;
  spanMs: number;
  atTsMs: number;
}) {
  const levels: string[] = [];
  for (const [, value] of series) if (!levels.includes(value)) levels.push(value);
  const rows = Math.max(1, levels.length);
  const yFor = (value: string) => PAD + ((levels.indexOf(value) + 0.5) / rows) * (HEIGHT - 2 * PAD);

  const labels: { x: number; y: number; text: string }[] = [];

  // Labels are collected only from the solid half: a value that persists past the
  // fire moment would otherwise be written twice on the same chart.
  const pathFor = (part: [number, string][], endMs: number, withLabels: boolean) => {
    const segments: string[] = [];
    let previous: [number, string] | null = null;
    for (const [ts, value] of part) {
      const x = xAt(ts, fromMs, spanMs);
      const y = yFor(value);
      if (previous === null) {
        segments.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
        if (withLabels) labels.push({ x, y, text: value });
      } else {
        segments.push(`L ${x.toFixed(1)} ${yFor(previous[1]).toFixed(1)}`);
        if (previous[1] !== value) {
          segments.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
          if (withLabels) labels.push({ x, y, text: value });
        }
      }
      previous = [ts, value];
    }
    if (previous !== null) {
      segments.push(`L ${xAt(endMs, fromMs, spanMs).toFixed(1)} ${yFor(previous[1]).toFixed(1)}`);
    }
    return segments.join(" ");
  };

  const { before, after } = splitAtFire(series, atTsMs);
  const beforePath = pathFor(before, atTsMs, true);
  const afterPath = after.length > 1 ? pathFor(after, fromMs + spanMs, false) : "";

  return (
    <>
      {beforePath && <path d={beforePath} fill="none" stroke="#c4b5fd" strokeWidth={1.5} />}
      {afterPath && (
        <path
          data-testid="freeze-after-line"
          d={afterPath}
          fill="none"
          stroke="#c4b5fd"
          strokeWidth={1.5}
          strokeOpacity={0.35}
        />
      )}
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

function FreezeFramePanel({
  alert, samples, atTsMs, windowMs, afterMs = 0, onClose, formatTime,
}: FreezeFramePanelProps) {
  const fromMs = atTsMs - windowMs;
  const spanMs = windowMs + Math.max(0, afterMs);
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

      <p className="mb-3 text-xs text-slate-400" data-testid="freeze-frame-caption">
        {afterMs > 0 ? (
          <>
            The {Math.round(windowMs / 1000)} seconds before this rule fired, and the{" "}
            {(afterMs / 1000).toFixed(afterMs < 1000 ? 1 : 0)} seconds after it, drawn faded. The
            dashed line marks the moment it fired. The car's own fault log shows only the lead-up,
            because it saves the freeze frame the instant a rule fires and cannot know what
            happens next; replay has the whole recording.
          </>
        ) : (
          <>
            The {Math.round(windowMs / 1000)} seconds of recorded data before this rule fired. The
            dashed line marks the moment it fired.
          </>
        )}
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
                    ? <StringSteps series={series.map(([ts, v]) => [ts, String(v)])} fromMs={fromMs} spanMs={spanMs} atTsMs={atTsMs} />
                    : <NumericSpark series={series.map(([ts, v]) => [ts, Number(v)])} fromMs={fromMs} spanMs={spanMs} atTsMs={atTsMs} />}
                  <line
                    x1={xAt(atTsMs, fromMs, spanMs)}
                    x2={xAt(atTsMs, fromMs, spanMs)}
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
