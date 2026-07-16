import { useCallback, useEffect, useRef, useState } from "react";
import { querySeries } from "../api";
import {
  SeriesCache,
  seriesCacheKey,
  targetPointsFor,
  type SeriesMap,
} from "./series-cache";

export interface UseSeriesData {
  seriesBySignal: SeriesMap;
  loading: boolean;
  error: string | null;
  requestRange(
    seasonTable: string,
    signals: string[],
    startMs: number,
    endMs: number,
  ): void;
  retry(): void;
}

interface SeriesRequestArgs {
  seasonTable: string;
  signals: string[];
  startMs: number;
  endMs: number;
}

const DEBOUNCE_MS = 300;
// Shared across hook instances so zoom revisits hit the same window budget.
const seriesCache = new SeriesCache();

export function useSeriesData(): UseSeriesData {
  const [seriesBySignal, setSeriesBySignal] = useState<SeriesMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const lastRequestRef = useRef<SeriesRequestArgs | null>(null);

  const executeRequest = useCallback(async (req: SeriesRequestArgs) => {
    const { seasonTable, signals, startMs, endMs } = req;
    const targetPoints = targetPointsFor(signals.length);
    const key = seriesCacheKey(seasonTable, signals, startMs, endMs, targetPoints);
    const seq = ++sequenceRef.current;

    const cached = seriesCache.get(key);
    if (cached) {
      // Clear loading so a later cache hit cannot leave a prior fetch stuck true.
      if (mountedRef.current && seq === sequenceRef.current) {
        setSeriesBySignal(cached);
        setLoading(false);
        setError(null);
      }
      return;
    }

    if (mountedRef.current && seq === sequenceRef.current) {
      setLoading(true);
    }

    try {
      const response = await querySeries({
        season: seasonTable,
        signals,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        target_points: targetPoints,
      });
      if (!mountedRef.current || seq !== sequenceRef.current) return;
      seriesCache.set(key, response.series);
      setSeriesBySignal(response.series);
      setError(null);
    } catch (err) {
      if (!mountedRef.current || seq !== sequenceRef.current) return;
      const message = err instanceof Error ? err.message : "failed to fetch series";
      setError(
        `${message} (${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()})`,
      );
    } finally {
      if (mountedRef.current && seq === sequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const requestRange = useCallback(
    (seasonTable: string, signals: string[], startMs: number, endMs: number) => {
      // Copy signals so callers can mutate their array without changing the pending request.
      const req: SeriesRequestArgs = {
        seasonTable,
        signals: [...signals],
        startMs,
        endMs,
      };
      lastRequestRef.current = req;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void executeRequest(req);
      }, DEBOUNCE_MS);
    },
    [executeRequest],
  );

  const retry = useCallback(() => {
    const last = lastRequestRef.current;
    if (!last) return;
    // Resubmit the latest intentional range; cache applies only if that fetch already succeeded.
    requestRange(last.seasonTable, last.signals, last.startMs, last.endMs);
  }, [requestRange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { seriesBySignal, loading, error, requestRange, retry };
}
