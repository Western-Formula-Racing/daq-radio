import { describe, expect, it, vi } from "vitest";
import { findSeasonWithData, prefetchRunsBySeason } from "./runOverlap";
import type { RunEntry } from "../../types/analysis";

const run = (start: string, end: string): RunEntry => ({
  key: `${start}_${end}`,
  start_utc: start,
  end_utc: end,
  start_local: start,
  end_local: end,
  timezone: "UTC",
});

describe("findSeasonWithData", () => {
  const runsBySeason = {
    WFR25: [run("2025-09-09T03:00:00+00:00", "2025-09-09T04:00:00+00:00")],
    WFR26: [run("2026-04-12T10:00:00+00:00", "2026-04-12T11:00:00+00:00")],
  };

  it("finds the season whose runs overlap the window", () => {
    const start = Date.parse("2025-09-09T03:21:08Z");
    const end = Date.parse("2025-09-09T03:23:38Z");
    expect(findSeasonWithData(runsBySeason, start, end)).toBe("WFR25");
  });

  it("returns null when nothing overlaps", () => {
    const start = Date.parse("2024-01-01T00:00:00Z");
    const end = Date.parse("2024-01-02T00:00:00Z");
    expect(findSeasonWithData(runsBySeason, start, end)).toBeNull();
  });
});

describe("prefetchRunsBySeason", () => {
  it("fetches runs for every season name in parallel and keys by name", async () => {
    const wfr25 = [run("2025-09-09T03:00:00+00:00", "2025-09-09T04:00:00+00:00")];
    const wfr26 = [run("2026-04-12T10:00:00+00:00", "2026-04-12T11:00:00+00:00")];
    const fetchRunsFn = vi.fn(async (season: string) => {
      if (season === "WFR25") return wfr25;
      if (season === "WFR26") return wfr26;
      return [];
    });

    const bySeason = await prefetchRunsBySeason(["WFR25", "WFR26"], fetchRunsFn);

    expect(fetchRunsFn).toHaveBeenCalledTimes(2);
    expect(fetchRunsFn).toHaveBeenCalledWith("WFR25");
    expect(fetchRunsFn).toHaveBeenCalledWith("WFR26");
    expect(bySeason).toEqual({ WFR25: wfr25, WFR26: wfr26 });

    const start = Date.parse("2025-09-09T03:21:08Z");
    const end = Date.parse("2025-09-09T03:23:38Z");
    expect(findSeasonWithData(bySeason, start, end)).toBe("WFR25");
  });
});
