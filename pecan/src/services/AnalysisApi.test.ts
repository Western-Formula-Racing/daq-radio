import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_API_URL_KEY,
  AnalysisApiError,
  fetchSeries,
  resolveApiBase,
} from "./AnalysisApi";

describe("resolveApiBase", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the localStorage override", () => {
    localStorage.setItem(ANALYSIS_API_URL_KEY, "http://100.72.11.60:8000/");
    expect(resolveApiBase()).toBe("http://100.72.11.60:8000");
  });

  it("falls back to VITE_ANALYSIS_API_URL", () => {
    vi.stubEnv("VITE_ANALYSIS_API_URL", "https://data-api.example.org");
    expect(resolveApiBase()).toBe("https://data-api.example.org");
  });

  it("defaults to localhost:8000 on localhost dev", () => {
    // vitest jsdom runs on localhost
    expect(resolveApiBase()).toBe("http://localhost:8000");
  });
});

describe("fetchSeries", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /api/series and returns parsed JSON", async () => {
    const payload = { season: "wfr25", start: "s", end: "e", series: {} };
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    const result = await fetchSeries({
      season: "wfr25",
      signals: ["A"],
      start: "2025-09-09T03:21:08Z",
      end: "2025-09-09T03:21:18Z",
    });
    expect(result).toEqual(payload);
    expect(mock).toHaveBeenCalledWith(
      "http://localhost:8000/api/series",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws AnalysisApiError with the server detail on 4xx/5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "narrow the time window" }), {
        status: 504,
      }),
    );
    await expect(
      fetchSeries({ season: "wfr25", signals: ["A"], start: "s", end: "e" }),
    ).rejects.toThrowError(AnalysisApiError);
    await expect(
      fetchSeries({ season: "wfr25", signals: ["A"], start: "s", end: "e" }),
    ).rejects.toThrow(/narrow the time window/);
  });

  it("throws AnalysisApiError with null status on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const err = await fetchSeries({
      season: "wfr25", signals: ["A"], start: "s", end: "e",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AnalysisApiError);
    expect(err.status).toBeNull();
  });
});
