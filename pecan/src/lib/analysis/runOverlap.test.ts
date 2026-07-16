import { describe, expect, it } from "vitest";
import { findSeasonWithData } from "./runOverlap";
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
    wfr25: [run("2025-09-09T03:00:00+00:00", "2025-09-09T04:00:00+00:00")],
    wfr26: [run("2026-04-12T10:00:00+00:00", "2026-04-12T11:00:00+00:00")],
  };

  it("finds the season whose runs overlap the window", () => {
    const start = Date.parse("2025-09-09T03:21:08Z");
    const end = Date.parse("2025-09-09T03:23:38Z");
    expect(findSeasonWithData(runsBySeason, start, end)).toBe("wfr25");
  });

  it("returns null when nothing overlaps", () => {
    const start = Date.parse("2024-01-01T00:00:00Z");
    const end = Date.parse("2024-01-02T00:00:00Z");
    expect(findSeasonWithData(runsBySeason, start, end)).toBeNull();
  });
});
