/** Proves the rule decode path end to end against a real DBC.
 *
 * A replay driven by a stubbed decode function passes whatever the interpreter
 * does, so these tests exist to catch the failure the stub cannot see: a decoder
 * whose output shape the interpreter silently rejects, which reports zero faults
 * and looks exactly like a clean session.
 */
import fs from "node:fs";
import path from "node:path";
import { Can, Dbc } from "candied";
import { describe, expect, it } from "vitest";

import { runReplay } from "../lib/wcars/engine/replayRunner";
import type { ReplayInputFrame } from "../lib/wcars/engine/replayRunner";
import type { RuleDoc } from "../lib/wcars/engine/types";
import { decodeCanMessage } from "./canProcessor";
import { createRuleDecoder } from "./ruleDecode";

const DBC_TEXT = fs.readFileSync(
  path.resolve(__dirname, "../assets/example.dbc"), "utf-8");

// VCU_Pedal_Info.pedalPosition sits in byte 1, unscaled; VCU_State_Info.State
// sits in byte 1 and is VAL_-mapped, so 4 decodes to "DRIVE".
const PEDAL_ID = 2000;
const STATE_ID = 2002;
const byte1 = (v: number) => `00${v.toString(16).padStart(2, "0")}000000000000`;

const frame = (tRelMs: number, canId: number, dataHex: string): ReplayInputFrame =>
  ({ tRelMs, canId, dataHex });

const doc = (over: Partial<RuleDoc>): RuleDoc => ({
  id: "r1", name: "Test rule", enabled: true, severity: "WARNING",
  message: "OVERTEMP", conditions: [], for_seconds: 0, rearm_seconds: 0, ...over,
});

describe("createRuleDecoder", () => {
  const decode = createRuleDecoder(DBC_TEXT);

  it("names the message the DBC names", () => {
    expect(decode(PEDAL_ID, byte1(50))?.message).toBe("VCU_Pedal_Info");
  });

  it("gives a numeric signal a plain number, not a nested reading", () => {
    const value = decode(PEDAL_ID, byte1(50))?.signals.pedalPosition;
    expect(value).toBe(50);
    expect(typeof value).toBe("number");
  });

  it("gives an enum signal its string label, matching the car-side decoder", () => {
    expect(decode(STATE_ID, byte1(4))?.signals.State).toBe("DRIVE");
  });

  it("falls back to the number when an enum value has no label", () => {
    // M170_Internal_States.INV_VSM_State spans 0-15 but VAL_ names only 0-7, 14
    // and 15, so 10 has no label and must stay a comparable number.
    const decoded = decode(170, "0a00000000000000");
    expect(decoded?.signals.INV_VSM_State).toBe(10);
  });

  it("returns null for a CAN id the DBC does not define", () => {
    expect(decode(0x7ff, "0000000000000000")).toBeNull();
  });

  it("returns null for a payload whose length disagrees with the DBC", () => {
    expect(decode(PEDAL_ID, "0032")).toBeNull();
  });

  it("differs from PECAN's display decoder, which nests the reading", () => {
    // Pinned deliberately: the display shape is {sensorReading, unit} and for an
    // enum it puts the number in sensorReading and the label in unit, so feeding
    // it to the interpreter would make every rule dead.
    const can = new Can();
    can.database = new Dbc().load(DBC_TEXT);
    const display = decodeCanMessage(can, STATE_ID, [0, 4, 0, 0, 0, 0, 0, 0], 0);
    expect(display?.signals.State).toEqual({ sensorReading: 4, unit: "DRIVE" });
    expect(decode(STATE_ID, byte1(4))?.signals.State).toBe("DRIVE");
  });
});

describe("runReplay driven by the real decoder", () => {
  const decode = createRuleDecoder(DBC_TEXT);

  it("fires a numeric rule that would have fired on the car", () => {
    const rule = doc({
      id: "pedal",
      conditions: [{ message: "VCU_Pedal_Info", signal: "pedalPosition", op: ">", value: 10 }],
    });
    const result = runReplay([
      frame(0, PEDAL_ID, byte1(0)),
      frame(1000, PEDAL_ID, byte1(50)),
    ], [rule], decode);

    expect(result.alerts.map((a) => ({ rule: a.rule, ts: a.ts, value: a.value })))
      .toEqual([{ rule: "USER:pedal", ts: 1000, value: 50 }]);
  });

  it("fires an enum-equality rule through the real decode path", () => {
    const rule = doc({
      id: "state",
      conditions: [{ message: "VCU_State_Info", signal: "State", op: "==", value: "DRIVE" }],
    });
    const result = runReplay([
      frame(0, STATE_ID, byte1(0)),
      frame(1000, STATE_ID, byte1(4)),
    ], [rule], decode);

    expect(result.alerts.map((a) => a.ts)).toEqual([1000]);
  });

  it("does not fire an enum rule while the state is something else", () => {
    const rule = doc({
      id: "state",
      conditions: [{ message: "VCU_State_Info", signal: "State", op: "==", value: "DRIVE" }],
    });
    const result = runReplay([frame(0, STATE_ID, byte1(0))], [rule], decode);
    expect(result.alerts).toEqual([]);
  });

  it("rejects PECAN's display decoder rather than reporting a clean session", () => {
    const can = new Can();
    can.database = new Dbc().load(DBC_TEXT);
    const displayDecode = (canId: number, dataHex: string) => {
      const bytes = dataHex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [];
      const decoded = decodeCanMessage(can, canId, bytes, 0);
      if (!decoded) return null;
      return { message: decoded.messageName, signals: decoded.signals as never };
    };
    const rule = doc({
      id: "pedal",
      conditions: [{ message: "VCU_Pedal_Info", signal: "pedalPosition", op: ">", value: 10 }],
    });
    expect(() => runReplay([frame(1000, PEDAL_ID, byte1(50))], [rule], displayDecode))
      .toThrow(/non-scalar value for signal .* of message 'VCU_Pedal_Info'/);
  });

  // candied clamps to the DBC's declared [min|max]; cantools does not. These are
  // the values real cantools produces for this frame, measured against
  // example.dbc, and they are what the car would evaluate rules on. An
  // over-range reading is precisely the fault a diagnostics tool must not hide.
  it("does not clamp an over-range reading the way candied does", () => {
    const dec = createRuleDecoder(DBC_TEXT);
    const out = dec(0x420, "ffffffffffffffff");
    expect(out).not.toBeNull();
    expect(out!.signals.PackCurrent).toBeCloseTo(3277.5, 5);
    expect(out!.signals.SOC).toBeCloseTo(655.35, 5);
  });
});
