import { useCallback, useRef, useState } from "react";
import { AnalysisApiError, fetchSeries } from "../../services/AnalysisApi";
import type { SignalSeries } from "../../types/analysis";
import { SeriesCache, cacheKey, targetPointsFor } from "./seriesCache";

export interface UseSeriesData {
  seriesBySignal: Record<string, SignalSeries>;
  loading: boolean;
  error: string | null;
  requestRange: (
    season: string,
    signals: string[],
    startMs: number,
    endMs: number,
  ) => void;
}

export function useSeriesData(debounceMs = 300): UseSeriesData {
  const [seriesBySignal, setSeriesBySignal] = useState<Record<string, SignalSeries>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef(new SeriesCache());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const requestRange = useCallback(
    (season: string, signals: string[], startMs: number, endMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const seq = ++requestSeq.current;
        if (signals.length === 0) {
          setSeriesBySignal({});
          return;
        }
        const key = cacheKey(season, signals, startMs, endMs);
        const cached = cacheRef.current.get(key);
        if (cached) {
          setSeriesBySignal(cached.series);
          setError(null);
          return;
        }
        setLoading(true);
        try {
          const resp = await fetchSeries({
            season,
            signals,
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            target_points: targetPointsFor(signals.length),
          });
          if (seq !== requestSeq.current) return; // stale response
          cacheRef.current.set(key, resp);
          setSeriesBySignal(resp.series);
          setError(null);
        } catch (e) {
          if (seq !== requestSeq.current) return;
          setError(
            e instanceof AnalysisApiError ? e.message : "failed to fetch series",
          );
        } finally {
          if (seq === requestSeq.current) setLoading(false);
        }
      }, debounceMs);
    },
    [debounceMs],
  );

  return { seriesBySignal, loading, error, requestRange };
}
