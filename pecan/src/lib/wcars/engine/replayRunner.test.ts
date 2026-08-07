import { describe, expect, it, vi } from "vitest";

import {
  FREEZE_MAX_HZ,
  FREEZE_WINDOW_MS,
  freezeWindow,
  runReplay,
} from "./replayRunner";
import type { DecodeForRules, ReplayInputFrame } from "./replayRunner";
import { STALENESS_MS } from "./userRule";
import type { DecodedFrame, RuleDoc } from "./types";

const doc = (over: Partial<RuleDoc> = {}): RuleDoc => ({
  id: "r1",
  name: "Test rule",
  enabled: true,
  severity: "WARNING",
  message: "OVERTEMP",
  conditions: [{ message: "M", signal: "S", op: ">", value: 10 }],
  for_seconds: 0,
  rearm_seconds: 0,
  ...over,
});

const frame = (tRelMs: number, canId = 1, dataHex = "00"): ReplayInputFrame =>
  ({ tRelMs, canId, dataHex });

// canId 1 carries message M with signal S; the payload byte is the reading, so a
// test can steer a rule by choosing the hex.
const decodeM: DecodeForRules = (canId, dataHex) => {
  if (canId !== 1) return null;
  return { message: "M", signals: { S: parseInt(dataHex, 16) } };
};

describe("runReplay", () => {
  it("counts every frame it was given", () => {
    const result = runReplay([frame(0), frame(1000)], [doc()], decodeM);
    expect(result.frameCount).toBe(2);
  });

  it("produces alerts in file order", () => {
    const rules = [doc({ id: "a", rearm_seconds: 0 })];
    const result = runReplay(
      [frame(1000, 1, "0b"), frame(2000, 1, "00"), frame(3000, 1, "0c")],
      rules,
      decodeM,
    );
    expect(result.alerts.map((a) => a.ts)).toEqual([1000, 3000]);
  });

  it("feeds frames in file order and never sorts them", () => {
    const seen: number[] = [];
    const spy: DecodeForRules = (canId, dataHex) => {
      seen.push(parseInt(dataHex, 16));
      return decodeM(canId, dataHex);
    };
    // Deliberately out of order: a runner that sorted would report 1, 2, 3.
    runReplay([frame(3000, 1, "03"), frame(1000, 1, "01"), frame(2000, 1, "02")],
      [doc()], spy);
    expect(seen).toEqual([3, 1, 2]);
  });

  it("warns about a backwards jump past the staleness window", () => {
    const result = runReplay(
      [frame(60_000), frame(60_000 - STALENESS_MS - 1)], [doc()], decodeM);
    const warning = result.warnings.find((w) => w.code === "backwards_jump");
    expect(warning).toBeDefined();
    expect(warning?.count).toBe(1);
    expect(warning?.message).toMatch(/backwards/i);
  });

  it("does not repair the order it warned about", () => {
    const seen: number[] = [];
    const spy: DecodeForRules = (canId, dataHex) => {
      seen.push(parseInt(dataHex, 16));
      return decodeM(canId, dataHex);
    };
    runReplay([frame(60_000, 1, "01"), frame(1000, 1, "02")], [doc()], spy);
    expect(seen).toEqual([1, 2]);
  });

  it("does not warn about a regression inside the staleness window", () => {
    const result = runReplay(
      [frame(60_000), frame(60_000 - STALENESS_MS)], [doc()], decodeM);
    expect(result.warnings.some((w) => w.code === "backwards_jump")).toBe(false);
  });

  it("reports relative time only when no frame carries an epoch base", () => {
    const result = runReplay([frame(0), frame(10)], [doc()], decodeM);
    expect(result.relativeTimeOnly).toBe(true);
    expect(result.warnings.some((w) => w.code === "relative_time_only")).toBe(true);
  });

  it("does not report relative time only when an epoch base is present", () => {
    const frames: ReplayInputFrame[] = [
      { tRelMs: 0, canId: 1, dataHex: "00", tEpochMs: 1_700_000_000_000 },
    ];
    const result = runReplay(frames, [doc()], decodeM);
    expect(result.relativeTimeOnly).toBe(false);
    expect(result.warnings.some((w) => w.code === "relative_time_only")).toBe(false);
  });

  it("skips disabled rules", () => {
    // Neither engine consults doc.enabled, so the runner is the only place a
    // disabled rule can be kept out of a replay.
    const result = runReplay([frame(1000, 1, "0b")],
      [doc({ id: "off", enabled: false })], decodeM);
    expect(result.alerts).toEqual([]);
  });

  it("still runs the enabled rules alongside a disabled one", () => {
    const result = runReplay([frame(1000, 1, "0b")],
      [doc({ id: "off", enabled: false }), doc({ id: "on" })], decodeM);
    expect(result.alerts.map((a) => a.rule)).toEqual(["USER:on"]);
  });

  it("reports progress and reaches the total", () => {
    const onProgress = vi.fn();
    const frames = Array.from({ length: 25_000 }, (_, i) => frame(i));
    const result = runReplay(frames, [doc()], decodeM, onProgress);
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)).toEqual([25_000, 25_000]);
    expect(onProgress.mock.calls.length).toBeGreaterThan(1);
    expect(result.frameCount).toBe(25_000);
  });

  it("reports progress once even when there are no frames", () => {
    const onProgress = vi.fn();
    runReplay([], [doc()], decodeM, onProgress);
    expect(onProgress.mock.calls.at(-1)).toEqual([0, 0]);
  });

  it("isolates a rule that throws instead of aborting the run", () => {
    const good = doc({ id: "good" });
    // A malformed document is the realistic way a rule blows up mid-run.
    const bad = doc({ id: "bad" });
    (bad as unknown as { conditions: unknown }).conditions = {
      [Symbol.iterator]() { throw new Error("boom"); },
    };

    const result = runReplay([frame(1000, 1, "0b"), frame(2000, 1, "00"),
      frame(3000, 1, "0c")], [bad, good], decodeM);

    expect(result.alerts.map((a) => a.rule)).toEqual(["USER:good", "USER:good"]);
    const warning = result.warnings.find((w) => w.code === "rule_error");
    expect(warning?.ruleId).toBe("bad");
    expect(warning?.message).toMatch(/boom/);
  });

  it("reports a rule that throws only once", () => {
    const bad = doc({ id: "bad" });
    (bad as unknown as { conditions: unknown }).conditions = {
      [Symbol.iterator]() { throw new Error("boom"); },
    };
    const frames = Array.from({ length: 50 }, (_, i) => frame(i * 100));
    const result = runReplay(frames, [bad], decodeM);
    expect(result.warnings.filter((w) => w.code === "rule_error")).toHaveLength(1);
  });

  it("rejects a decoder that returns PECAN's nested display shape", () => {
    // PECAN's display decoder yields {sensorReading, unit} per signal. Passed
    // through unchanged, every condition's numeric guard is false and a replay
    // reports zero faults with nothing red on screen, so this must be loud.
    const nested = (): DecodedFrame => ({
      message: "M",
      signals: { S: { sensorReading: 11, unit: "C" } as unknown as number },
    });
    expect(() => runReplay([frame(1000)], [doc()], nested))
      .toThrow(/S/);
    expect(() => runReplay([frame(1000)], [doc()], nested))
      .toThrow(/number or a string/i);
  });

  it("warns when the DBC decoded nothing at all", () => {
    const result = runReplay([frame(1000), frame(2000)], [doc()], () => null);
    expect(result.warnings.some((w) => w.code === "no_frames_decoded")).toBe(true);
    expect(result.alerts).toEqual([]);
  });

  it("does not warn about an empty decode when there were no frames", () => {
    const result = runReplay([], [doc()], () => null);
    expect(result.warnings.some((w) => w.code === "no_frames_decoded")).toBe(false);
  });
});

describe("freezeWindow", () => {
  const frames: ReplayInputFrame[] = Array.from({ length: 200 }, (_, i) =>
    frame(i * 100, 1, (i % 200).toString(16).padStart(2, "0")));

  const decodePair: DecodeForRules = (canId, dataHex) => {
    if (canId !== 1) return null;
    const v = parseInt(dataHex, 16);
    return { message: "M", signals: { S: v, Mode: v % 2 === 0 ? "IDLE" : "DRIVE" } };
  };

  it("returns only the requested signals", () => {
    const out = freezeWindow(frames, decodePair, 10_000, ["S"], 2000);
    expect(Object.keys(out)).toEqual(["S"]);
  });

  it("omits a signal the session never carried", () => {
    const out = freezeWindow(frames, decodePair, 10_000, ["S", "Nope"], 2000);
    expect(out.Nope).toBeUndefined();
  });

  it("keeps only samples inside the window before the fire moment", () => {
    const out = freezeWindow(frames, decodePair, 10_000, ["S"], 2000);
    const stamps = out.S.map(([ts]) => ts);
    expect(Math.min(...stamps)).toBeGreaterThanOrEqual(8000);
    expect(Math.max(...stamps)).toBeLessThanOrEqual(10_000);
  });

  it("downsamples to at most FREEZE_MAX_HZ per second", () => {
    // 100 Hz input over the full window must come back at 20 Hz.
    const dense: ReplayInputFrame[] = Array.from({ length: 1200 }, (_, i) =>
      frame(i * 10, 1, (i % 200).toString(16).padStart(2, "0")));
    const out = freezeWindow(dense, decodePair, 12_000, ["S"], FREEZE_WINDOW_MS);
    const cap = (FREEZE_WINDOW_MS / 1000) * FREEZE_MAX_HZ + 1;
    expect(out.S.length).toBeLessThanOrEqual(cap);
    expect(out.S.length).toBeGreaterThan(10);
  });

  it("preserves string values", () => {
    const out = freezeWindow(frames, decodePair, 10_000, ["Mode"], 2000);
    expect(out.Mode.every(([, v]) => typeof v === "string")).toBe(true);
  });

  it("returns samples oldest first so a sparkline needs no sorting", () => {
    const out = freezeWindow(frames, decodePair, 10_000, ["S"], 2000);
    const stamps = out.S.map(([ts]) => ts);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });

  it("returns an empty map when nothing falls inside the window", () => {
    expect(freezeWindow(frames, decodePair, 1_000_000, ["S"], 1000)).toEqual({});
  });
});
