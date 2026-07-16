import { describe, expect, it } from "vitest";
import { buildTraces } from "./plotTraces";
import type { SignalSeries } from "../../types/analysis";

const raw: SignalSeries = {
  mode: "raw", resolution_ms: null, point_count: 2, t: [0, 1000], v: [1, 2],
};

const env: SignalSeries = {
  mode: "envelope", resolution_ms: 2500, point_count: 2,
  t: [0, 2500], min: [1, 2], max: [3, 4], avg: [2, 3],
};

describe("buildTraces", () => {
  it("builds one scattergl line for raw series", () => {
    const traces = buildTraces("A", raw, "y", "#f47560") as any[];
    expect(traces).toHaveLength(1);
    expect(traces[0].type).toBe("scattergl");
    expect(traces[0].x).toHaveLength(2);
    expect(traces[0].x[0]).toBeInstanceOf(Date);
  });

  it("builds max, min band, and avg traces for envelope series", () => {
    const traces = buildTraces("A", env, "y2", "#f47560") as any[];
    expect(traces).toHaveLength(3);
    const [, minT, avgT] = traces;
    expect(minT.fill).toBe("tonexty"); // band between max and min
    expect(avgT.name).toContain("A");
    expect(traces.every((t) => t.yaxis === "y2")).toBe(true);
  });
});
