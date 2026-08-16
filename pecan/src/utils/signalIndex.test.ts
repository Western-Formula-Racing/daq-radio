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

  // A naive "message + signal" join would let ("AB","C") and ("A","BC") share a
  // key. The NUL separator in signalIndex.ts's key() helper is what prevents that.
  it("does not confuse two signals whose names concatenate the same way", () => {
    const raw: RawSignal[] = [
      { message: "AB", signal: "C", unit: null, minimum: null, maximum: null, choices: null },
      { message: "A", signal: "BC", unit: null, minimum: null, maximum: null, choices: null },
    ];
    const index = buildIndex(raw);
    expect(findSignal(index, "AB", "C")).not.toBe(findSignal(index, "A", "BC"));
    expect(findSignal(index, "AB", "C")?.signal).toBe("C");
    expect(findSignal(index, "A", "BC")?.signal).toBe("BC");
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
  //
  // The VAL_ line in example.dbc for VCU_State_Info.State is:
  //   VAL_ 2002 State 0 "START" 1 "PRECHARGE_ENABLE" 2 "PRECHARGE_OK"
  //     3 "STARTUP_DELAY" 4 "DRIVE" 5 "PRECHARGE_ERROR" 6 "DEVICE_FAULT" ;
  // Pinning every label in order catches a dropped, mis-keyed, or reordered
  // entry that a mere toContain("DRIVE") would silently pass through.
  it("produces the full, ordered enum choice set for VCU_State_Info.State", () => {
    const signals = signalsFromDbcText(DBC_TEXT);
    const state = signals.find((s) => s.message === "VCU_State_Info" && s.signal === "State");
    expect(state).toBeTruthy();
    expect(state!.choices).toEqual({
      "0": "START",
      "1": "PRECHARGE_ENABLE",
      "2": "PRECHARGE_OK",
      "3": "STARTUP_DELAY",
      "4": "DRIVE",
      "5": "PRECHARGE_ERROR",
      "6": "DEVICE_FAULT",
    });
  });

  // example.dbc declares INV_Motor_Temp as:
  //   SG_ INV_Motor_Temp : 32|16@1- (0.1,0) [-3276.8|3276.7] "temperature:C"
  // so unit and range must survive the DBC-to-RawSignal conversion, not just
  // the enum table.
  it("carries unit, minimum, and maximum through from the DBC", () => {
    const signals = signalsFromDbcText(DBC_TEXT);
    const motorTemp = signals.find(
      (s) => s.message === "M162_Temperature_Set_3" && s.signal === "INV_Motor_Temp",
    );
    expect(motorTemp).toBeTruthy();
    expect(motorTemp!.unit).toBe("temperature:C");
    expect(motorTemp!.minimum).toBe(-3276.8);
    expect(motorTemp!.maximum).toBe(3276.7);
  });

  it("gives a numeric signal no choices", () => {
    const signals = signalsFromDbcText(DBC_TEXT);
    const pedal = signals.find((s) => s.signal === "pedalPosition");
    expect(pedal?.choices).toBeNull();
  });

  // This is the path the UI actually walks: a loaded DBC feeds signalsFromDbcText,
  // whose output feeds buildIndex, whose SignalInfo.choices drives the enum-aware
  // value control. No earlier test exercised both halves together.
  it("composes with buildIndex to produce enum choices as a labeled list", () => {
    const index = buildIndex(signalsFromDbcText(DBC_TEXT));
    const state = findSignal(index, "VCU_State_Info", "State");
    expect(state).toBeTruthy();
    expect(state!.choices).toEqual([
      "START",
      "PRECHARGE_ENABLE",
      "PRECHARGE_OK",
      "STARTUP_DELAY",
      "DRIVE",
      "PRECHARGE_ERROR",
      "DEVICE_FAULT",
    ]);
  });
});
