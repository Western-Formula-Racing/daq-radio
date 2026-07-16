import { describe, expect, it } from "vitest";
import { seriesToCsv } from "./exportCsv";
import type { SignalSeries } from "../../types/analysis";

describe("seriesToCsv", () => {
  it("merges signals on time and leaves blanks for missing samples", () => {
    const series: Record<string, SignalSeries> = {
      A: { mode: "raw", resolution_ms: null, point_count: 2, t: [0, 1000], v: [1, 2] },
      B: { mode: "raw", resolution_ms: null, point_count: 1, t: [1000], v: [9] },
    };
    const csv = seriesToCsv(series);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("time_utc,A,B");
    expect(lines[1]).toBe("1970-01-01T00:00:00.000Z,1,");
    expect(lines[2]).toBe("1970-01-01T00:00:01.000Z,2,9");
  });

  it("uses avg for envelope series and appends min/max columns", () => {
    const series: Record<string, SignalSeries> = {
      A: {
        mode: "envelope", resolution_ms: 1000, point_count: 1,
        t: [0], min: [1], max: [3], avg: [2],
      },
    };
    const csv = seriesToCsv(series);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("time_utc,A_avg,A_min,A_max");
    expect(lines[1]).toBe("1970-01-01T00:00:00.000Z,2,1,3");
  });
});
