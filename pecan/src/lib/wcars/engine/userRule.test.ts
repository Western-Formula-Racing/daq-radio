/** Mirrors tests/test_wcars_user_rules.py case for case.
 *
 * The rule document format is trivial; the timing behaviors are not, and they
 * are the whole reason two runtimes can disagree. Every timing case in the
 * Python suite has a twin here, named after the behavior it pins.
 */
import { describe, expect, it } from "vitest";
import { STALENESS_MS, UserRule } from "./userRule";
import type { DecodedFrame, RuleDoc } from "./types";

const doc = (over: Partial<RuleDoc> = {}): RuleDoc => ({
  id: "r1", name: "T", enabled: true, severity: "WARNING", message: "OVERTEMP",
  conditions: [{ message: "M", signal: "S", op: ">", value: 10 }],
  for_seconds: 0, rearm_seconds: 0, ...over,
});

const frame = (
  value: number | string, message = "M", signal = "S",
): DecodedFrame => ({ message, signals: { [signal]: value } });

const other = (value: number | string = 1): DecodedFrame =>
  ({ message: "N", signals: { T: value } });

const twoConditions: RuleDoc = doc({
  conditions: [
    { message: "M", signal: "S", op: ">", value: 10 },
    { message: "N", signal: "T", op: ">", value: 5 },
  ],
});

describe("UserRule", () => {
  it("fires when the condition is met", () => {
    expect(new UserRule(doc()).update(frame(11), 1000)).not.toBeNull();
  });

  it("does not fire below the threshold", () => {
    expect(new UserRule(doc()).update(frame(9), 1000)).toBeNull();
  });

  it("populates the alert from the document", () => {
    const alert = new UserRule(doc()).update(frame(11), 1000);
    expect(alert).not.toBeNull();
    expect(alert!.rule).toBe("USER:r1");
    expect(alert!.severity).toBe("WARNING");
    expect(alert!.title).toBe("OVERTEMP");
    expect(alert!.detail).toBe("T");
    expect(alert!.value).toBe(11);
    expect(alert!.ts).toBe(1000);
    expect(alert!.replay).toBe(false);
    expect(alert!.id).toBeTruthy();
  });

  it("gives each alert a distinct id", () => {
    const r = new UserRule(doc());
    const first = r.update(frame(11), 1000);
    r.update(frame(9), 2000);
    const second = r.update(frame(11), 3000);
    expect(first!.id).not.toBe(second!.id);
  });

  it("ANDs conditions across different messages", () => {
    const r = new UserRule(twoConditions);
    expect(r.update(frame(11), 1000)).toBeNull();
    expect(r.update(other(10), 1100)).not.toBeNull();
  });

  it("holds for for_seconds before firing", () => {
    const r = new UserRule(doc({ for_seconds: 2 }));
    expect(r.update(frame(11), 1000)).toBeNull();
    expect(r.update(frame(11), 2900)).toBeNull();
    expect(r.update(frame(11), 3000)).not.toBeNull();
  });

  it("restarts the hold when the condition drops", () => {
    const r = new UserRule(doc({ for_seconds: 2 }));
    r.update(frame(11), 1000);
    r.update(frame(9), 2000);
    r.update(frame(11), 2100);
    expect(r.update(frame(11), 4000)).toBeNull();
    expect(r.update(frame(11), 4100)).not.toBeNull();
  });

  it("does not refire while the condition stays true", () => {
    const r = new UserRule(doc());
    expect(r.update(frame(11), 1000)).not.toBeNull();
    expect(r.update(frame(12), 2000)).toBeNull();
  });

  it("does not refire inside the rearm window", () => {
    const r = new UserRule(doc({ rearm_seconds: 10 }));
    expect(r.update(frame(11), 1000)).not.toBeNull();
    expect(r.update(frame(11), 2000)).toBeNull();
  });

  it("refires only after going false and clearing the rearm window", () => {
    const r = new UserRule(doc({ rearm_seconds: 10 }));
    expect(r.update(frame(11), 1000)).not.toBeNull();
    r.update(frame(9), 2000);
    expect(r.update(frame(11), 3000)).toBeNull();
    r.update(frame(9), 10500);
    expect(r.update(frame(11), 11500)).not.toBeNull();
  });

  it("combines for_seconds with rearm_seconds", () => {
    const r = new UserRule(doc({ for_seconds: 2, rearm_seconds: 10 }));
    expect(r.update(frame(11), 1000)).toBeNull();
    expect(r.update(frame(11), 3000)).not.toBeNull();
    r.update(frame(9), 4000);
    expect(r.update(frame(11), 5000)).toBeNull();
    expect(r.update(frame(11), 8000)).toBeNull();
    expect(r.update(frame(11), 12000)).toBeNull();
    expect(r.update(frame(11), 13500)).not.toBeNull();
  });

  it("starts a hold at the high water mark, not at a late frame's own time", () => {
    // Mirrors the high_water_late_frame conformance vector: a frame 2 s in the
    // past completes the AND, and the hold is measured from 4000, so the alert
    // lands at 6000 instead of 5000.
    const r = new UserRule(doc({ ...twoConditions, for_seconds: 2 }));
    expect(r.update(frame(11), 4000)).toBeNull();
    expect(r.update(other(11), 2000)).toBeNull();
    expect(r.update(frame(11), 5000)).toBeNull();
    expect(r.update(frame(11), 6000)).not.toBeNull();
  });

  it("does not refire when a late frame arrives after the fire", () => {
    const r = new UserRule(doc({ for_seconds: 2 }));
    expect(r.update(frame(11), 1000)).toBeNull();
    expect(r.update(frame(11), 3000)).not.toBeNull();
    // The hold is already satisfied and the rule has not gone false, so a frame
    // 1 s in the past neither undoes the fire nor produces a second one.
    expect(r.update(frame(11), 2000)).toBeNull();
  });

  it("keeps the newest sample when an older reading arrives late", () => {
    const r = new UserRule(doc());
    r.update(frame(11), 2000);
    // The older reading is discarded, so the rule stays satisfied.
    expect(r.update(frame(9), 1000)).toBeNull();
  });

  it("does not fire on a late frame older than the stored reading", () => {
    const r = new UserRule(doc());
    expect(r.update(frame(9), 5000)).toBeNull();
    expect(r.update(frame(11), 3000)).toBeNull();
  });

  it("resets the hold when a signal gap exceeds the staleness window", () => {
    const r = new UserRule(doc({ for_seconds: 2 }));
    r.update(frame(11), 1000);
    // A gap means the hold was never observed to be continuous.
    expect(r.update(frame(11), 1000 + STALENESS_MS + 1)).toBeNull();
  });

  it("does not satisfy a hold across a long observation gap", () => {
    const r = new UserRule(doc({ for_seconds: 10 }));
    expect(r.update(frame(11), 0)).toBeNull();
    expect(r.update(frame(11), 60000)).toBeNull();
    expect(r.update(frame(11), 64000)).toBeNull();
    expect(r.update(frame(11), 68000)).toBeNull();
    expect(r.update(frame(11), 70000)).not.toBeNull();
  });

  it("allows a refire after a total outage", () => {
    const r = new UserRule(doc());
    expect(r.update(frame(11), 1000)).not.toBeNull();
    expect(r.update(frame(11), 61000)).not.toBeNull();
  });

  it("ignores a backwards step smaller than the staleness window", () => {
    const r = new UserRule(doc({ for_seconds: 2 }));
    r.update(frame(11), 1000);
    r.update(frame(11), 2900);
    // Ordinary out of order arrival must not restart the hold.
    expect(r.update(frame(11), 3000)).not.toBeNull();
  });

  it("survives a recovered datagram arriving mid-hold", () => {
    const r = new UserRule(doc({ for_seconds: 10 }));
    expect(r.update(frame(11), 10000)).toBeNull();
    expect(r.update(frame(11), 14800)).toBeNull();
    expect(r.update(frame(11), 14600)).toBeNull();
    expect(r.update(frame(11), 18000)).toBeNull();
    expect(r.update(frame(11), 20000)).not.toBeNull();
  });

  it("keeps the fired timestamp across a small backwards step", () => {
    const r = new UserRule(doc({ rearm_seconds: 10 }));
    expect(r.update(frame(11), 10000)).not.toBeNull();
    r.update(frame(9), 11000);
    expect(r.update(frame(11), 10800)).toBeNull();
    expect(r.update(frame(11), 12000)).toBeNull();
  });

  it("resets state on a backwards jump larger than the staleness window", () => {
    const r = new UserRule(doc({ rearm_seconds: 10 }));
    expect(r.update(frame(11), 60000)).not.toBeNull();
    // A replay restart is a new source, so rearm state is wiped.
    expect(r.update(frame(11), 1000)).not.toBeNull();
  });

  it("does not reset on a backwards step of exactly the staleness window", () => {
    // The reset check is strictly greater than STALENESS_MS, so 5000 is still
    // reordering and the rearm window must survive it.
    const r = new UserRule(doc({ rearm_seconds: 10 }));
    expect(r.update(frame(11), 10000)).not.toBeNull();
    expect(r.update(frame(11), 5000)).toBeNull();
  });

  it("resets on a backwards step one millisecond past the window", () => {
    const r = new UserRule(doc({ rearm_seconds: 10 }));
    expect(r.update(frame(11), 10000)).not.toBeNull();
    expect(r.update(frame(11), 4999)).not.toBeNull();
  });

  it("treats a signal one millisecond past the window as stale", () => {
    const r = new UserRule(twoConditions);
    r.update(other(10), 1000);
    expect(r.update(frame(11), 6001)).toBeNull();
  });

  it("restarts the hold after a replay restart", () => {
    const r = new UserRule(doc({ for_seconds: 2 }));
    expect(r.update(frame(11), 100000)).toBeNull();
    expect(r.update(frame(11), 1000)).toBeNull();
    expect(r.update(frame(11), 2500)).toBeNull();
    expect(r.update(frame(11), 3000)).not.toBeNull();
  });

  it("treats a stale signal as false", () => {
    const r = new UserRule(twoConditions);
    r.update(other(10), 1000);
    // T has not been seen within the window, so the AND cannot hold.
    expect(r.update(frame(11), 1000 + STALENESS_MS + 1)).toBeNull();
  });

  it("treats a sample exactly at the staleness window as fresh", () => {
    const r = new UserRule(twoConditions);
    r.update(other(10), 1000);
    expect(r.update(frame(11), 1000 + STALENESS_MS)).not.toBeNull();
  });

  it("lets an unrelated frame reset a hold that went stale", () => {
    const r = new UserRule(doc({ for_seconds: 2 }));
    expect(r.update(frame(11), 1000)).toBeNull();
    expect(r.update(other(), 1000 + STALENESS_MS + 1)).toBeNull();
    // The hold restarts from the returning sample instead of completing.
    expect(r.update(frame(11), 7000)).toBeNull();
    expect(r.update(frame(11), 8000)).toBeNull();
    expect(r.update(frame(11), 9000)).not.toBeNull();
  });

  it("lets an unrelated frame notice staleness and allow a refire", () => {
    const r = new UserRule(doc());
    expect(r.update(frame(11), 1000)).not.toBeNull();
    expect(r.update(other(), 1000 + STALENESS_MS + 1)).toBeNull();
    expect(r.update(frame(11), 20000)).not.toBeNull();
  });

  it("uses the firing frame timestamp, not the high water mark", () => {
    const r = new UserRule(doc());
    expect(r.update(other(), 5000)).toBeNull();
    const alert = r.update(frame(11), 3000);
    expect(alert).not.toBeNull();
    expect(alert!.ts).toBe(3000);
  });

  it("compares enum signals by string equality", () => {
    const r = new UserRule(doc({
      conditions: [{ message: "M", signal: "S", op: "==", value: "PRECHARGE" }],
    }));
    expect(r.update(frame("RUN"), 1000)).toBeNull();
    const alert = r.update(frame("PRECHARGE"), 2000);
    expect(alert).not.toBeNull();
    // A textual first condition has no numeric trigger value to report.
    expect(alert!.value).toBeNull();
  });

  it("supports != against a named value", () => {
    const r = new UserRule(doc({
      conditions: [{ message: "M", signal: "S", op: "!=", value: "RUN" }],
    }));
    expect(r.update(frame("RUN"), 1000)).toBeNull();
    expect(r.update(frame("FAULT"), 2000)).not.toBeNull();
  });

  it("does not throw when a numeric comparison meets a string value", () => {
    const r = new UserRule(doc());
    expect(r.update(frame("FAULT"), 1000)).toBeNull();
  });

  it("supports every operator", () => {
    const cases: [RuleDoc["conditions"][0]["op"], number, boolean][] = [
      [">", 11, true], [">", 10, false],
      [">=", 10, true], [">=", 9, false],
      ["<", 9, true], ["<", 10, false],
      ["<=", 10, true], ["<=", 11, false],
      ["==", 10, true], ["==", 11, false],
      ["!=", 11, true], ["!=", 10, false],
    ];
    for (const [op, value, expected] of cases) {
      const r = new UserRule(doc({
        conditions: [{ message: "M", signal: "S", op, value: 10 }],
      }));
      expect(r.update(frame(value), 1000) !== null).toBe(expected);
    }
  });

  it("ignores frames for other messages", () => {
    expect(new UserRule(doc()).update(frame(11, "OTHER"), 1000)).toBeNull();
  });

  it("ignores a frame that does not carry the condition's signal", () => {
    expect(new UserRule(doc()).update(frame(11, "M", "OTHER"), 1000)).toBeNull();
  });

  it("supports up to four ANDed conditions", () => {
    const r = new UserRule(doc({
      conditions: [
        { message: "M", signal: "A", op: ">", value: 1 },
        { message: "M", signal: "B", op: ">", value: 1 },
        { message: "M", signal: "C", op: ">", value: 1 },
        { message: "M", signal: "D", op: ">", value: 1 },
      ],
    }));
    expect(r.update({ message: "M", signals: { A: 2, B: 2, C: 2 } }, 1000)).toBeNull();
    expect(r.update({ message: "M", signals: { D: 2 } }, 1100)).not.toBeNull();
  });

  it("exports the staleness window the Python engine uses", () => {
    expect(STALENESS_MS).toBe(5000);
  });
});
