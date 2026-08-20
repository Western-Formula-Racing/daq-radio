import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildIndex } from "../../utils/signalIndex";
import type { RawSignal } from "../../utils/omtClient";
import type { Condition } from "../../lib/wcars/engine/types";
import ConditionSlots from "./ConditionSlots";

const RAW: RawSignal[] = [
  { message: "M162_Temperature_Set_3", signal: "INV_Motor_Temp", unit: "C", minimum: 0, maximum: 300, choices: null },
  { message: "VCU_State_Info", signal: "State", unit: null, minimum: 0, maximum: 6, choices: { "0": "START", "4": "DRIVE" } },
];
const index = buildIndex(RAW);
const MOTOR = index.all[0];
const STATE = index.all[1];

const existing: Condition = { message: MOTOR.message, signal: MOTOR.signal, op: ">", value: 100 };

const setup = (conditions: Condition[], armed = null) => {
  const onChange = vi.fn();
  const onPlaced = vi.fn();
  render(<ConditionSlots conditions={conditions} index={index} armed={armed}
    problems={[]} onChange={onChange} onPlaced={onPlaced} />);
  return { onChange, onPlaced };
};

describe("placing a signal", () => {
  it("invites a tap only while a signal is armed", () => {
    setup([]);
    expect(screen.getByTestId("condition-empty-slot").textContent).toMatch(/pick a signal/i);
    expect((screen.getByTestId("condition-empty-slot") as HTMLButtonElement).disabled).toBe(true);
  });

  it("places the armed signal into the empty slot with a sensible default", () => {
    const { onChange, onPlaced } = setup([], MOTOR as never);
    fireEvent.click(screen.getByTestId("condition-empty-slot"));
    expect(onChange).toHaveBeenCalledWith([
      { message: MOTOR.message, signal: MOTOR.signal, op: ">", value: 0 },
    ]);
    expect(onPlaced).toHaveBeenCalled();
  });

  it("defaults an enum placement to == and its first label, which is always valid", () => {
    const { onChange } = setup([], STATE as never);
    fireEvent.click(screen.getByTestId("condition-empty-slot"));
    expect(onChange).toHaveBeenCalledWith([
      { message: STATE.message, signal: STATE.signal, op: "==", value: "START" },
    ]);
  });

  it("replaces the signal of a filled slot that is tapped while armed", () => {
    const { onChange } = setup([existing], STATE as never);
    fireEvent.click(screen.getByTestId("condition-0-replace"));
    expect(onChange).toHaveBeenCalledWith([
      { message: STATE.message, signal: STATE.signal, op: "==", value: "START" },
    ]);
  });
});

describe("slot structure", () => {
  it("joins conditions with AND, never a chooser, because the engine only ANDs", () => {
    setup([existing, { ...existing, signal: "INV_Motor_Temp", value: 200 }]);
    expect(screen.getAllByTestId("condition-joiner")).toHaveLength(1);
    expect(screen.getAllByTestId("condition-joiner")[0].textContent).toBe("AND");
    expect(screen.queryByRole("combobox", { name: /join/i })).toBeNull();
  });

  it("stops offering an empty slot at the four-condition limit", () => {
    setup([existing, existing, existing, existing]);
    expect(screen.queryByTestId("condition-empty-slot")).toBeNull();
    expect(screen.getAllByTestId(/^condition-\d+$/)).toHaveLength(4);
  });

  it("shifts the remaining conditions up when one is cleared", () => {
    const second: Condition = { ...existing, value: 200 };
    const { onChange } = setup([existing, second]);
    fireEvent.click(screen.getByTestId("condition-0-clear"));
    expect(onChange).toHaveBeenCalledWith([second]);
  });
});
