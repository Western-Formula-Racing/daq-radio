import type { RunEntry } from "../../types/analysis";

interface RunListProps {
  seasons: string[];
  selectedSeason: string;
  onSeasonChange: (season: string) => void;
  runs: RunEntry[];
  selectedRunKey: string | null;
  onSelectRange: (startMs: number, endMs: number, runKey: string | null) => void;
}

function fmtLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function RunList({
  seasons,
  selectedSeason,
  onSeasonChange,
  runs,
  selectedRunKey,
  onSelectRange,
}: RunListProps) {
  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Season"
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
        value={selectedSeason}
        onChange={(e) => onSeasonChange(e.target.value)}
      >
        {seasons.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div className="max-h-72 overflow-y-auto">
        {runs.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-500">
            No indexed runs for this season.
          </p>
        )}
        {runs.map((run) => (
          <button
            key={run.key}
            onClick={() =>
              onSelectRange(Date.parse(run.start_utc), Date.parse(run.end_utc), run.key)
            }
            className={`block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-800 ${
              run.key === selectedRunKey ? "bg-zinc-800 text-purple-300" : "text-zinc-300"
            }`}
          >
            <span className="font-medium tabular-nums">{fmtLocal(run.start_local)}</span>
            {run.row_count != null && (
              <span className="ml-1 text-zinc-500 tabular-nums">
                {Intl.NumberFormat().format(run.row_count)} rows
              </span>
            )}
            {run.note && <span className="block truncate text-zinc-500">{run.note}</span>}
          </button>
        ))}
      </div>

      <CustomRange onSelectRange={onSelectRange} />
    </div>
  );
}

function CustomRange({
  onSelectRange,
}: {
  onSelectRange: (startMs: number, endMs: number, runKey: null) => void;
}) {
  const apply = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const start = Date.parse(String(data.get("start")));
    const end = Date.parse(String(data.get("end")));
    if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
      onSelectRange(start, end, null);
    }
  };
  return (
    <form
      className="flex flex-col gap-1 border-t border-zinc-800 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
    >
      <label className="text-xs text-zinc-500">Custom range (local time)</label>
      <input
        name="start"
        type="datetime-local"
        step="1"
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
      />
      <input
        name="end"
        type="datetime-local"
        step="1"
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
      >
        Apply range
      </button>
    </form>
  );
}
