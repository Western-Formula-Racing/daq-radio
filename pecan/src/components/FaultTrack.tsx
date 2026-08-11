/** Severity-colored marks for replay faults, stacked under the TimelineBar.
 *
 * Positions come from the same timescale the alerts were produced in, not from
 * the display timescale, so the caller passes the run's own start and end. The
 * translation to the timeline cursor happens on select, in one place.
 */
import type { Severity, WcarsAlert } from "../lib/wcars/engine/types";

const MARK_CLASS: Record<Severity, string> = {
  WARNING: "bg-red-400 border-red-200",
  CAUTION: "bg-amber-400 border-amber-200",
  MEMO: "bg-slate-400 border-slate-200",
};

interface FaultTrackProps {
  alerts: readonly WcarsAlert[];
  startMs: number;
  endMs: number;
  selectedId?: string | null;
  onSelect: (alert: WcarsAlert) => void;
  formatTime?: (ts: number) => string;
}

function FaultTrack({ alerts, startMs, endMs, selectedId, onSelect, formatTime }: FaultTrackProps) {
  // A zero-length session would divide by zero, so everything lands at the left
  // edge rather than disappearing.
  const span = endMs - startMs;

  return (
    <div className="w-full" data-testid="fault-track">
      <div className="relative h-7 w-full overflow-hidden rounded border border-white/10 bg-black/30">
        {alerts.length === 0 && (
          <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-wide text-slate-500">
            No faults on this track
          </span>
        )}
        {alerts.map((alert) => {
          const ratio = span > 0 ? (alert.ts - startMs) / span : 0;
          const pct = Math.min(100, Math.max(0, ratio * 100));
          const when = formatTime ? formatTime(alert.ts) : `${alert.ts} ms`;
          return (
            <button
              key={alert.id}
              type="button"
              data-testid={`fault-mark-${alert.id}`}
              title={`${alert.severity} ${alert.title} at ${when}`}
              onClick={() => onSelect(alert)}
              style={{ left: `${pct}%` }}
              className={`absolute top-1 h-5 w-[3px] -translate-x-1/2 cursor-pointer border ${MARK_CLASS[alert.severity]} ${
                selectedId === alert.id ? "ring-1 ring-white" : ""
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

export default FaultTrack;
