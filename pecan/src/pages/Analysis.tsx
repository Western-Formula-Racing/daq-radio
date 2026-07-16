import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  fetchRuns,
  fetchSeasons,
  fetchSensorsGrouped,
} from "../services/AnalysisApi";
import type { GroupedSensors, RunEntry, SeasonEntry } from "../types/analysis";
import { useSeriesData } from "../lib/analysis/useSeriesData";
import { findSeasonWithData } from "../lib/analysis/runOverlap";
import { exportCsv } from "../lib/analysis/exportCsv";
import RunList from "../components/analysis/RunList";
import SignalTree from "../components/analysis/SignalTree";
import PlotStack from "../components/analysis/PlotStack";

export default function Analysis() {
  const [seasonEntries, setSeasonEntries] = useState<SeasonEntry[]>([]);
  const [season, setSeason] = useState<string>(""); // SeasonEntry.name for GETs / UI
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [runsBySeason, setRunsBySeason] = useState<Record<string, RunEntry[]>>({});
  const [grouped, setGrouped] = useState<GroupedSensors>({
    messages: [],
    ungrouped: [],
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);
  // Full selected window (run or custom range); zoom narrows within it
  const [fullRange, setFullRange] = useState<[number, number] | null>(null);
  const [viewRange, setViewRange] = useState<[number, number] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { seriesBySignal, loading, error, requestRange } = useSeriesData();

  const seasonNames = useMemo(
    () => seasonEntries.map((s) => s.name),
    [seasonEntries],
  );

  // /api/series expects the Postgres table name (e.g. wfr25), not the display name.
  const seasonTable = useMemo(() => {
    const entry = seasonEntries.find((s) => s.name === season);
    return entry?.table ?? season.toLowerCase();
  }, [seasonEntries, season]);

  useEffect(() => {
    fetchSeasons()
      .then((list) => {
        setSeasonEntries(list);
        if (list.length) setSeason(list[0].name);
      })
      .catch((e) => setLoadError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!season) return;
    fetchRuns(season)
      .then((r) => {
        setRuns(r);
        setRunsBySeason((prev) => ({ ...prev, [season]: r }));
      })
      .catch((e) => setLoadError(String(e.message ?? e)));
    fetchSensorsGrouped(season)
      .then(setGrouped)
      .catch((e) => setLoadError(String(e.message ?? e)));
  }, [season]);

  const signals = useMemo(() => [...selected], [selected]);

  useEffect(() => {
    if (!viewRange || signals.length === 0) return;
    requestRange(seasonTable, signals, viewRange[0], viewRange[1]);
  }, [seasonTable, signals, viewRange, requestRange]);

  const onSelectRange = useCallback(
    (startMs: number, endMs: number, runKey: string | null) => {
      setSelectedRunKey(runKey);
      setFullRange([startMs, endMs]);
      setViewRange([startMs, endMs]);
    },
    [],
  );

  const onZoom = useCallback(
    (startMs: number, endMs: number) => {
      // NaN sentinel from PlotStack means double-click autoscale: reset
      if (Number.isNaN(startMs)) {
        if (fullRange) setViewRange([...fullRange] as [number, number]);
        return;
      }
      setViewRange([startMs, endMs]);
    },
    [fullRange],
  );

  const onToggle = useCallback((sig: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sig)) next.delete(sig);
      else next.add(sig);
      return next;
    });
  }, []);

  // v1 grouping: one stacked subplot per signal
  const plotGroups = useMemo(() => signals.map((s) => [s]), [signals]);

  const allEmpty =
    signals.length > 0 &&
    !loading &&
    Object.values(seriesBySignal).every((s) => s.point_count === 0);
  const seasonHint =
    allEmpty && viewRange
      ? findSeasonWithData(runsBySeason, viewRange[0], viewRange[1])
      : null;

  const badges = Object.entries(seriesBySignal).map(([sig, s]) => (
    <span
      key={sig}
      className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 tabular-nums"
    >
      {sig}:{" "}
      {s.mode === "raw"
        ? `raw (${Intl.NumberFormat().format(s.point_count)} pts)`
        : `envelope @ ${(s.resolution_ms ?? 0) / 1000}s — zoom in for raw`}
    </span>
  ));

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide">Analysis</h1>
        <Link
          to="/dashboard"
          className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200"
        >
          ⇄ Live
        </Link>
        {viewRange && (
          <span className="text-xs text-zinc-500 tabular-nums">
            {new Date(viewRange[0]).toISOString()} → {new Date(viewRange[1]).toISOString()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {loading && <span className="text-xs text-purple-400">loading…</span>}
          <button
            onClick={() => exportCsv(seriesBySignal, `analysis_${seasonTable}.csv`)}
            disabled={signals.length === 0}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1 px-4 py-1">{badges}</div>

      {(error || loadError) && (
        <div className="mx-4 my-1 rounded border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {error ?? loadError}
        </div>
      )}
      {allEmpty && (
        <div className="mx-4 my-1 rounded border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          No data in {season} for this window.
          {seasonHint && seasonHint !== season && (
            <> The run index shows data in <b>{seasonHint}</b> here — switch season.</>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-zinc-800 p-3">
          <RunList
            seasons={seasonNames}
            selectedSeason={season}
            onSeasonChange={setSeason}
            runs={runs}
            selectedRunKey={selectedRunKey}
            onSelectRange={onSelectRange}
          />
          <SignalTree grouped={grouped} selected={selected} onToggle={onToggle} />
        </aside>
        <main className="min-w-0 flex-1">
          {viewRange && signals.length > 0 ? (
            <PlotStack
              seriesBySignal={seriesBySignal}
              plotGroups={plotGroups}
              rangeMs={viewRange}
              onRangeChange={onZoom}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-600">
              Pick a run and select signals to plot.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
