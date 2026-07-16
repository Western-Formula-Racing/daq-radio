import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../services/AnalysisApi";
import { useSeriesData } from "./useSeriesData";
import type { SeriesResponse } from "../../types/analysis";

const resp = (season: string): SeriesResponse => ({
  season,
  start: "s",
  end: "e",
  series: { A: { mode: "raw", resolution_ms: null, point_count: 1, t: [1], v: [2] } },
});

describe("useSeriesData", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces bursts of requestRange calls into one fetch", async () => {
    const spy = vi.spyOn(api, "fetchSeries").mockResolvedValue(resp("wfr25"));
    const { result } = renderHook(() => useSeriesData(300));
    act(() => {
      result.current.requestRange("wfr25", ["A"], 0, 1000);
      result.current.requestRange("wfr25", ["A"], 0, 2000);
      result.current.requestRange("wfr25", ["A"], 0, 3000);
    });
    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].end).toBe(new Date(3000).toISOString());
    expect(result.current.seriesBySignal.A?.v).toEqual([2]);
  });

  it("serves a repeated range from cache without fetching again", async () => {
    const spy = vi.spyOn(api, "fetchSeries").mockResolvedValue(resp("wfr25"));
    const { result } = renderHook(() => useSeriesData(300));
    act(() => result.current.requestRange("wfr25", ["A"], 0, 3000));
    await act(() => vi.advanceTimersByTimeAsync(350));
    act(() => result.current.requestRange("wfr25", ["A"], 0, 3000));
    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("exposes AnalysisApiError messages via error", async () => {
    vi.spyOn(api, "fetchSeries").mockRejectedValue(
      new api.AnalysisApiError("query timed out; narrow the time window", 504),
    );
    const { result } = renderHook(() => useSeriesData(300));
    act(() => result.current.requestRange("wfr25", ["A"], 0, 3000));
    await act(() => vi.advanceTimersByTimeAsync(350));
    await waitFor(() => expect(result.current.error).toMatch(/narrow/));
  });
});
