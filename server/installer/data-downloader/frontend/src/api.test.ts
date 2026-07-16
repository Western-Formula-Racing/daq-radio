import { afterEach, describe, expect, it, vi } from "vitest";
import { querySeries } from "./api";

describe("querySeries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs JSON body to /api/series", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        season: "wfr26",
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-01T01:00:00Z",
        series: {},
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = {
      season: "wfr26",
      signals: ["A", "B"],
      start: "2026-01-01T00:00:00Z",
      end: "2026-01-01T01:00:00Z",
      target_points: 4000,
    };
    await querySeries(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/series");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it("surfaces server detail on errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ detail: "TimescaleDB unavailable" }),
      }),
    );

    await expect(
      querySeries({
        season: "wfr26",
        signals: ["A"],
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-01T01:00:00Z",
        target_points: 4000,
      }),
    ).rejects.toThrow("TimescaleDB unavailable");
  });

  it("surfaces non-JSON error bodies as plain text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => "Bad Gateway from upstream",
      }),
    );

    await expect(
      querySeries({
        season: "wfr26",
        signals: ["A"],
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-01T01:00:00Z",
        target_points: 4000,
      }),
    ).rejects.toThrow("Bad Gateway from upstream");
  });

  it("falls back when the error body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "",
      }),
    );

    await expect(
      querySeries({
        season: "wfr26",
        signals: ["A"],
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-01T01:00:00Z",
        target_points: 4000,
      }),
    ).rejects.toThrow("Request failed (500)");
  });
});
