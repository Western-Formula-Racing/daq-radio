import { describe, expect, it } from "vitest";
import { buildIndex } from "./signalIndex";
import { validateRuleDoc } from "./ruleValidate";
import type { RawSignal } from "./omtClient";

const RAW: RawSignal[] = [
  { message: "VCU_Pedal_Info", signal: "pedalPosition", unit: null, minimum: 0, maximum: 100, choices: null },
  { message: "VCU_State_Info", signal: "State", unit: null, minimum: 0, maximum: 6, choices: { "0": "START", "4": "DRIVE" } },
];
const index = buildIndex(RAW);

const base = {
  id: "r1", name: "Rule", enabled: true, severity: "WARNING", message: "MSG",
  conditions: [{ message: "VCU_Pedal_Info", signal: "pedalPosition", op: ">", value: 50 }],
  for_seconds: 0, rearm_seconds: 0,
};

const paths = (doc: unknown) => validateRuleDoc(doc, index).map((p) => p.path);

describe("validateRuleDoc", () => {
  it("accepts a well-formed rule", () => {
    expect(validateRuleDoc(base, index)).toEqual([]);
  });

  it("points a problem at the field that caused it, so the form can show it in place", () => {
    expect(paths({ ...base, message: "ABCDEFGHIJKLMNOPQRSTUVWXY" })).toEqual(["message"]);
    expect(paths({ ...base, name: "" })).toEqual(["name"]);
    expect(paths({ ...base, for_seconds: -1 })).toEqual(["for_seconds"]);
  });

  it("names the offending condition by index", () => {
    expect(paths({ ...base, conditions: [{ message: "VCU_Pedal_Info", signal: "nope", op: ">", value: 1 }] }))
      .toEqual(["conditions.0.signal"]);
  });

  it("rejects an enum compared with a number, which could never match", () => {
    expect(paths({ ...base, conditions: [{ message: "VCU_State_Info", signal: "State", op: "==", value: 4 }] }))
      .toEqual(["conditions.0.value"]);
  });

  it("rejects a label the signal does not define", () => {
    expect(paths({ ...base, conditions: [{ message: "VCU_State_Info", signal: "State", op: "==", value: "DRIVEE" }] }))
      .toEqual(["conditions.0.value"]);
  });

  it("rejects text compared with an ordering operator", () => {
    const problems = validateRuleDoc(
      { ...base, conditions: [{ message: "VCU_State_Info", signal: "State", op: ">", value: "DRIVE" }] }, index);
    expect(problems.map((p) => p.path)).toContain("conditions.0.op");
  });

  it("rejects more than four conditions", () => {
    const five = Array.from({ length: 5 }, () => base.conditions[0]);
    expect(paths({ ...base, conditions: five })).toEqual(["conditions"]);
  });

  // Offline the browser has a DBC but not necessarily the car's, so a name it
  // cannot confirm is left alone rather than rejected: refusing to save a valid
  // rule is worse than deferring the check to the car, which will run it anyway.
  it("skips message and signal checks when there is no index", () => {
    expect(validateRuleDoc({ ...base, conditions: [{ message: "WHO", signal: "KNOWS", op: ">", value: 1 }] }, null))
      .toEqual([]);
  });
});
