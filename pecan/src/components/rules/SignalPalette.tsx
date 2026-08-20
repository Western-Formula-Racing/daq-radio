/** The catalog a rule author picks signals from.
 *
 * Tap to arm, then tap a condition slot to place. There is no drag: HTML5 drag
 * events never fire on iOS Safari touch, and this tool's primary client is an
 * iPad on the car's hotspot.
 */
import { useMemo, useState } from "react";

import { groupByMessage, searchSignals } from "../../utils/signalIndex";
import type { SignalIndex, SignalInfo } from "../../utils/signalIndex";

interface SignalPaletteProps {
  index: SignalIndex | null;
  armed: SignalInfo | null;
  onArm: (signal: SignalInfo | null) => void;
  /** Shown instead of the list when there is no catalog to show. */
  emptyReason?: string;
}

function describe(info: SignalInfo): string {
  if (info.choices !== null) {
    return `${info.choices.length} named value${info.choices.length === 1 ? "" : "s"}`;
  }
  const unit = info.unit ? ` ${info.unit}` : "";
  if (info.minimum === null || info.maximum === null) return unit.trim() || "numeric";
  return `${info.minimum} to ${info.maximum}${unit}`;
}

function SignalPalette({ index, armed, onArm, emptyReason }: SignalPaletteProps) {
  const [query, setQuery] = useState("");
  const [openMessages, setOpenMessages] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => (index === null ? [] : groupByMessage(searchSignals(index, query))),
    [index, query],
  );

  // A search is an explicit request to see the matches, so it expands them; with
  // no search, 133 collapsed messages beat 678 rows on a tablet.
  const searching = query.trim().length > 0;

  if (index === null) {
    return (
      <div className="rounded-lg border border-white/10 bg-data-module-bg p-4">
        <h2 className="app-section-title mb-2">Signals</h2>
        <p data-testid="palette-empty" className="text-sm text-slate-400">
          {emptyReason ?? "No signals are available."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-data-module-bg p-4">
      <h2 className="app-section-title mb-2">Signals</h2>
      <input
        data-testid="palette-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search signals"
        className="mb-3 min-h-[44px] w-full rounded border border-white/20 bg-black/30 px-3 py-2 text-sm text-slate-100"
      />
      {groups.length === 0 ? (
        <p data-testid="palette-empty" className="text-sm text-slate-400">
          No signal matches that search.
        </p>
      ) : (
        <ul className="space-y-1">
          {groups.map((group) => {
            const open = searching || openMessages.has(group.message);
            return (
              <li key={group.message}>
                <button
                  type="button"
                  data-testid={`palette-message-${group.message}`}
                  aria-expanded={open}
                  className="flex min-h-[44px] w-full items-center justify-between rounded border border-white/10 bg-black/20 px-3 text-left font-mono text-xs uppercase tracking-wide text-slate-200"
                  onClick={() => setOpenMessages((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.message)) next.delete(group.message);
                    else next.add(group.message);
                    return next;
                  })}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true">{open ? "▲" : "▼"}</span>
                    <span>{group.message}</span>
                  </span>
                  <span className="text-slate-400">{group.signals.length}</span>
                </button>
                {open && (
                  <ul className="mt-1 space-y-1 pl-2">
                    {group.signals.map((info) => {
                      const isArmed = armed?.message === info.message && armed?.signal === info.signal;
                      return (
                        <li key={info.signal}>
                          <button
                            type="button"
                            data-testid={`palette-signal-${info.message}-${info.signal}`}
                            aria-pressed={isArmed}
                            className={`flex min-h-[44px] w-full flex-wrap items-center justify-between gap-2 rounded border px-3 text-left font-mono text-xs ${
                              isArmed
                                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                                : "border-white/10 bg-black/20 text-slate-200"
                            }`}
                            onClick={() => onArm(isArmed ? null : info)}
                          >
                            <span>{info.signal}</span>
                            <span className="text-slate-400">{describe(info)}</span>
                            {isArmed && <span className="w-full text-[10px] uppercase text-cyan-200">Armed, now tap a slot</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default SignalPalette;
