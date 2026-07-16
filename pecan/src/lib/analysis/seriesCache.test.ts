import { describe, expect, it } from "vitest";
import {
  CLIENT_POINT_BUDGET,
  SeriesCache,
  cacheKey,
  targetPointsFor,
} from "./seriesCache";
import type { SeriesResponse } from "../../types/analysis";

const dummy = (season: string): SeriesResponse => ({
  season, start: "s", end: "e", series: {},
});

describe("targetPointsFor", () => {
  it("returns the default 4000 for few signals", () => {
    expect(targetPointsFor(1)).toBe(4000);
    expect(targetPointsFor(12)).toBe(4000);
  });

  it("never lets signals x target exceed the client budget", () => {
    const n = 500; // absurd, but the invariant must hold
    expect(n * targetPointsFor(n)).toBeLessThanOrEqual(CLIENT_POINT_BUDGET);
  });
});

describe("cacheKey", () => {
  it("is order-insensitive for signals and rounds times to the second", () => {
    const a = cacheKey("wfr25", ["B", "A"], 1000, 61_400);
    const b = cacheKey("wfr25", ["A", "B"], 1400, 61_900);
    expect(a).toBe(b);
  });
});

describe("SeriesCache", () => {
  it("stores and retrieves", () => {
    const c = new SeriesCache();
    c.set("k", dummy("wfr25"));
    expect(c.get("k")?.season).toBe("wfr25");
  });

  it("evicts the least recently used entry beyond 32", () => {
    const c = new SeriesCache();
    for (let i = 0; i < 33; i++) c.set(`k${i}`, dummy("wfr25"));
    expect(c.get("k0")).toBeUndefined();
    expect(c.get("k32")).toBeDefined();
  });

  it("refreshes recency on get", () => {
    const c = new SeriesCache();
    for (let i = 0; i < 32; i++) c.set(`k${i}`, dummy("wfr25"));
    c.get("k0"); // touch: k1 becomes the oldest
    c.set("k32", dummy("wfr25"));
    expect(c.get("k0")).toBeDefined();
    expect(c.get("k1")).toBeUndefined();
  });
});
