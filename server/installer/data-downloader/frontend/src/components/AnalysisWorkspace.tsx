import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { findSeasonWithData } from "../analysis/analysis-range";
import { downloadSeriesCsv, seriesToCsv } from "../analysis/export-csv";
import {
  type PlotLayout,
  assignSignals,
  flattenSignals,
  parseLayout,
  pruneUnknown,
  serializeLayout,
  toggleRightAxis,
  toggleSignal,
} from "../analysis/plot-layout";
import type { SeriesMap } from "../analysis/series-cache";
import { useSeriesData } from "../analysis/use-series-data";
import type { RunRecord, Season, SensorsGroupedResponse } from "../types";
import { AnalysisPlotStack } from "./AnalysisPlotStack";
import { AnalysisSignalPicker } from "./AnalysisSignalPicker";
import { AnalysisToolbar } from "./AnalysisToolbar";

const layoutStorageKey = (seasonName: string) => `analysis-layout:${seasonName}`;

function knownSignalsOf(grouped: SensorsGroupedResponse | null): Set<string> | null {
  if (!grouped) return null;
  return new Set([...grouped.messages.flatMap((m) => m.signals), ...grouped.ungrouped]);
}

export interface AnalysisWorkspaceProps {
  season: Season;
  runs: RunRecord[];
  grouped: SensorsGroupedResponse | null;
  theme: "light" | "dark";
  runsBySeason: Record<string, RunRecord[]>;
}

const EMPTY_GROUPED: SensorsGroupedResponse = {
  updated_at: null,
  dbc_source: "none",
  messages: [],
  ungrouped: [],
};

function isValidRange(startMs: number, endMs: number): boolean {
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs;
}

function hasPlottableSeries(
  seriesBySignal: Record<string, { point_count: number }>,
  signals: string[],
): boolean {
  return signals.some((signal) => {
    const series = seriesBySignal[signal];
    return series != null && series.point_count > 0;
  });
}

function signalsMatchExact(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((signal) => set.has(signal));
}

function selectedOnlySeries(seriesBySignal: SeriesMap, signals: string[]): SeriesMap {
  const filtered: SeriesMap = {};
  for (const signal of signals) {
    const series = seriesBySignal[signal];
    if (series) filtered[signal] = series;
  }
  return filtered;
}

export function AnalysisWorkspace({
  season,
  runs,
  grouped,
  theme,
  runsBySeason,
}: AnalysisWorkspaceProps) {
  const [selectedRunKey, setSelectedRunKey] = useState("");
  const [plots, setPlots] = useState<PlotLayout>(() => {
    try {
      return parseLayout(window.localStorage.getItem(layoutStorageKey(season.name))) ?? [];
    } catch {
      return [];
    }
  });
  const [fullRange, setFullRange] = useState<[number, number] | null>(null);
  const [viewRange, setViewRange] = useState<[number, number] | null>(null);
  const [awaitingFirstResponse, setAwaitingFirstResponse] = useState(false);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);

  const { seriesBySignal, loadedRequest, loading, error, requestRange, retry } = useSeriesData();

  const seasonName = season.name;
  const seasonTable = season.table;

  // Persist on every layout change; storage failures must never break the UI.
  useEffect(() => {
    try {
      window.localStorage.setItem(layoutStorageKey(seasonName), serializeLayout(plots));
    } catch {
      // Ignore persistence failures in restricted environments.
    }
  }, [plots, seasonName]);

  const knownSignals = useMemo(() => knownSignalsOf(grouped), [grouped]);

  // Drop persisted signals this season does not know before they can hit the API.
  useEffect(() => {
    if (!knownSignals) return;
    setPlots((prev) => pruneUnknown(prev, knownSignals));
  }, [knownSignals]);

  const selectedSignals = useMemo(() => flattenSignals(plots), [plots]);
  const selectedSet = useMemo(() => new Set(selectedSignals), [selectedSignals]);
  // Order-insensitive key so regrouping between plots never re-triggers a request.
  const signalsKey = useMemo(() => [...selectedSignals].sort().join(" "), [selectedSignals]);

  const handleToggleSignal = useCallback((signal: string) => {
    setPlots((prev) => toggleSignal(prev, signal));
  }, []);

  const handleAssignSignals = useCallback((signals: string[], target: string) => {
    setPlots((prev) => assignSignals(prev, signals, target));
  }, []);

  const handleToggleRightAxis = useCallback((groupId: string, signal: string) => {
    setPlots((prev) => toggleRightAxis(prev, groupId, signal));
  }, []);

  const handleRunChange = useCallback((runKey: string, startMs: number, endMs: number) => {
    setSelectedRunKey(runKey);
    setFullRange([startMs, endMs]);
    setViewRange([startMs, endMs]);
    setExportConfirmOpen(false);
  }, []);

  const handleSelectCustom = useCallback(() => {
    setSelectedRunKey("");
  }, []);

  const handleCustomRange = useCallback((startMs: number, endMs: number) => {
    setSelectedRunKey("");
    setFullRange([startMs, endMs]);
    setViewRange([startMs, endMs]);
    setExportConfirmOpen(false);
  }, []);

  const handlePlotRangeChange = useCallback(
    (startMs: number, endMs: number) => {
      if (Number.isNaN(startMs) && Number.isNaN(endMs)) {
        if (fullRange) setViewRange(fullRange);
        return;
      }
      if (!isValidRange(startMs, endMs)) return;
      setViewRange([startMs, endMs]);
    },
    [fullRange],
  );

  // Request series whenever table + signals + view range are valid.
  useEffect(() => {
    if (!viewRange || !isValidRange(viewRange[0], viewRange[1]) || selectedSignals.length === 0) {
      return;
    }
    // Wait for the sensor list so restored layouts are pruned before the first request.
    if (!knownSignals) return;
    setAwaitingFirstResponse(true);
    setExportConfirmOpen(false);
    requestRange(seasonTable, [...selectedSignals].sort(), viewRange[0], viewRange[1]);
    // signalsKey stands in for selectedSignals so regrouping does not refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonTable, signalsKey, viewRange, requestRange, knownSignals]);

  // Mark first response complete once loading settles after a request.
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (loading) {
      wasLoadingRef.current = true;
      return;
    }
    if (wasLoadingRef.current || Object.keys(seriesBySignal).length > 0 || error || loadedRequest) {
      setAwaitingFirstResponse(false);
      wasLoadingRef.current = false;
    }
  }, [loading, seriesBySignal, error, loadedRequest]);

  const exportSeries = useMemo(
    () => selectedOnlySeries(seriesBySignal, selectedSignals),
    [seriesBySignal, selectedSignals],
  );

  const loadedMatchesSelection =
    loadedRequest != null &&
    viewRange != null &&
    loadedRequest.seasonTable === seasonTable &&
    loadedRequest.startMs === viewRange[0] &&
    loadedRequest.endMs === viewRange[1] &&
    signalsMatchExact(loadedRequest.signals, selectedSignals) &&
    signalsMatchExact(Object.keys(exportSeries), selectedSignals);

  const toolbarRange: [number, number] = viewRange ?? [Number.NaN, Number.NaN];
  const exportDisabled =
    selectedSignals.length === 0 ||
    !viewRange ||
    loading ||
    awaitingFirstResponse ||
    !loadedMatchesSelection ||
    !hasPlottableSeries(exportSeries, selectedSignals);

  const wrongSeasonHint = useMemo(() => {
    if (!viewRange || !isValidRange(viewRange[0], viewRange[1])) return null;
    if (loading || awaitingFirstResponse) return null;
    if (hasPlottableSeries(seriesBySignal, selectedSignals)) return null;
    if (selectedSignals.length === 0) return null;
    return findSeasonWithData(runsBySeason, viewRange[0], viewRange[1], seasonName);
  }, [
    viewRange,
    loading,
    awaitingFirstResponse,
    seriesBySignal,
    selectedSignals,
    runsBySeason,
    seasonName,
  ]);

  const showEmpty =
    !error &&
    !awaitingFirstResponse &&
    !loading &&
    selectedSignals.length > 0 &&
    viewRange != null &&
    !hasPlottableSeries(seriesBySignal, selectedSignals);

  const keepPreviousPlots =
    !error &&
    selectedSignals.length > 0 &&
    viewRange != null &&
    hasPlottableSeries(seriesBySignal, selectedSignals);

  const performExport = useCallback(() => {
    if (!loadedRequest || exportDisabled) return;
    downloadSeriesCsv(
      exportSeries,
      seasonName,
      loadedRequest.startMs,
      loadedRequest.endMs,
    );
    setExportConfirmOpen(false);
  }, [loadedRequest, exportDisabled, exportSeries, seasonName]);

  const handleExport = useCallback(() => {
    if (exportDisabled) return;
    const { containsEnvelope } = seriesToCsv(exportSeries);
    if (containsEnvelope) {
      setExportConfirmOpen(true);
      return;
    }
    performExport();
  }, [exportDisabled, exportSeries, performExport]);

  const pickerGrouped = grouped ?? EMPTY_GROUPED;

  const plotOptions = useMemo(
    () => plots.map((p, i) => ({ id: p.id, label: `Plot ${i + 1}` })),
    [plots],
  );
  const assignments = useMemo(() => {
    const map: Record<string, number> = {};
    plots.forEach((p, i) =>
      p.signals.forEach((s) => {
        map[s] = i + 1;
      }),
    );
    return map;
  }, [plots]);

  return (
    <div className="analysis-workspace">
      <AnalysisToolbar
        runs={runs}
        selectedRunKey={selectedRunKey}
        range={toolbarRange}
        loading={loading || awaitingFirstResponse}
        exportDisabled={exportDisabled}
        onRunChange={handleRunChange}
        onSelectCustom={handleSelectCustom}
        onCustomRange={handleCustomRange}
        onExport={handleExport}
      />

      {exportConfirmOpen && (
        <div
          className="analysis-export-confirm"
          data-testid="analysis-export-confirm"
          role="status"
        >
          <p>
            This export includes envelope (downsampled) data with avg/min/max columns — not raw
            samples.
          </p>
          <div className="analysis-export-confirm-actions">
            <button type="button" className="button" onClick={performExport}>
              Export anyway
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setExportConfirmOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="analysis-grid">
        <aside className="analysis-rail">
          <AnalysisSignalPicker
            grouped={pickerGrouped}
            selected={selectedSet}
            onToggle={handleToggleSignal}
            onAssignSignals={handleAssignSignals}
            assignments={assignments}
            plotOptions={plotOptions}
            theme={theme}
          />
        </aside>

        <section className="analysis-plots" aria-live="polite">
          {error && (
            <div className="analysis-error card" role="alert">
              <strong>Could not load series.</strong>
              <p>{error}</p>
              <button type="button" className="button" onClick={() => retry()}>
                Retry
              </button>
            </div>
          )}

          {!error && awaitingFirstResponse && !keepPreviousPlots && (
            <div className="analysis-status-badge" role="status">
              Loading series…
            </div>
          )}

          {!error && showEmpty && (
            <div className="analysis-empty" data-testid="analysis-empty" role="status">
              <p>No samples in this range for the selected signals.</p>
              {wrongSeasonHint && (
                <p className="analysis-empty-hint">
                  Overlapping indexed runs exist in {wrongSeasonHint}. Try switching seasons.
                </p>
              )}
            </div>
          )}

          {!error && keepPreviousPlots && viewRange && (
            <AnalysisPlotStack
              layout={plots}
              seriesBySignal={seriesBySignal}
              range={viewRange}
              onRangeChange={handlePlotRangeChange}
              onAssignSignals={handleAssignSignals}
              onRemoveSignal={handleToggleSignal}
              onToggleRightAxis={handleToggleRightAxis}
              theme={theme}
            />
          )}

          {!error &&
            !awaitingFirstResponse &&
            !loading &&
            !showEmpty &&
            !keepPreviousPlots &&
            selectedSignals.length === 0 && (
              <div className="analysis-idle" role="status">
                Select a run window and one or more signals to load linked plots.
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
