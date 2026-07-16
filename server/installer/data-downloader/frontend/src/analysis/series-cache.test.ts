import { describe, expect, it } from "vitest";
import { SeriesCache, seriesCacheKey, targetPointsFor } from "./series-cache";

describe("series cache", () => {
  it("makes signal order irrelevant and preserves exact range", () => {
    expect(seriesCacheKey("wfr26", ["B", "A"], 1, 2, 4000)).toBe(
      seriesCacheKey("wfr26", ["A", "B"], 1, 2, 4000),
    );
  });

  it("evicts least-recently-used entries to stay under budget", () => {
    const cache = new SeriesCache(3);
    cache.set("a", { A: { mode: "raw", resolution_ms: null, point_count: 2, t: [1, 2], v: [1, 2] } });
    cache.set("b", { B: { mode: "raw", resolution_ms: null, point_count: 2, t: [1, 2], v: [1, 2] } });
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
  });

  it("shares the million-point budget across signals", () => {
    expect(targetPointsFor(1)).toBe(20_000);
    expect(targetPointsFor(12)).toBeLessThanOrEqual(Math.floor(1_000_000 / 12));
  });
});
