import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildIndex, findSignal, groupByMessage, searchSignals, signalsFromDbcText } from "./signalIndex";
import type { RawSignal } from "./omtClient";

const DBC_TEXT = fs.readFileSync(path.resolve(__dirname, "../assets/example.dbc"), "utf-8");

const RAW: RawSignal[] = [
  { message: "M162_Temperature_Set_3", signal: "INV_Motor_Temp", unit: "temperature:C", minimum: -3276.8, maximum: 3276.7, choices: null },
  { message: "M162_Temperature_Set_3", signal: "INV_Coolant_Temp", unit: "temperature:C", minimum: -3276.8, maximum: 3276.7, choices: null },
  { message: "VCU_State_Info", signal: "State", unit: null, minimum: 0, maximum: 6, choices: { "0": "START", "4": "DRIVE" } },
];

describe("buildIndex", () => {
  it("exposes enum labels as a plain list, since the editor only offers labels", () => {
    const index = buildIndex(RAW);
    expect(findSignal(index, "VCU_State_Info", "State")?.choices).toEqual(["START", "DRIVE"]);
  });

  it("marks a signal with no VAL_ table as numeric", () => {
    const index = buildIndex(RAW);
    expect(findSignal(index, "M162_Temperature_Set_3", "INV_Motor_Temp")?.choices).toBeNull();
  });

  it("returns null for a signal the car does not have", () => {
    expect(findSignal(buildIndex(RAW), "M162_Temperature_Set_3", "Nope")).toBeNull();
  });
});

describe("searchSignals", () => {
  const index = buildIndex(RAW);

  it("matches on the signal name, case-insensitively", () => {
    expect(searchSignals(index, "motor_temp").map((s) => s.signal)).toEqual(["INV_Motor_Temp"]);
  });

  it("matches on the message name so a whole message can be found at once", () => {
    expect(searchSignals(index, "VCU_State").map((s) => s.signal)).toEqual(["State"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchSignals(index, "  ")).toHaveLength(3);
  });
});

describe("groupByMessage", () => {
  it("groups signals under their message, in message name order", () => {
    const groups = groupByMessage(searchSignals(buildIndex(RAW), ""));
    expect(groups.map((g) => g.message)).toEqual(["M162_Temperature_Set_3", "VCU_State_Info"]);
    expect(groups[0].signals).toHaveLength(2);
  });
});

describe("signalsFromDbcText", () => {
  // Offline authoring has to produce the same shape the car's API does, or the
  // palette and the enum-aware value control would behave differently with no
  // car present, which is exactly when nobody can check.
  it("produces the same shape from a local DBC", () => {
    const signals = signalsFromDbcText(DBC_TEXT);
    expect(signals.length).toBeGreaterThan(0);
    const state = signals.find((s) => s.message === "VCU_State_Info" && s.signal === "State");
    expect(state).toBeTruthy();
    expect(Object.values(state!.choices ?? {})).toContain("DRIVE");
  });

  it("gives a numeric signal no choices", () => {
    const signals = signalsFromDbcText(DBC_TEXT);
    const pedal = signals.find((s) => s.signal === "pedalPosition");
    expect(pedal?.choices).toBeNull();
  });
});
