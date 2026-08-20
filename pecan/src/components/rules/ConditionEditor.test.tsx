import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Condition } from "../../lib/wcars/engine/types";
import type { SignalInfo } from "../../utils/signalIndex";
import ConditionEditor from "./ConditionEditor";

const NUMERIC: SignalInfo = {
  message: "M162_Temperature_Set_3", signal: "INV_Motor_Temp",
  unit: "temperature:C", minimum: -100, maximum: 300, choices: null,
};
const ENUM: SignalInfo = {
  message: "VCU_State_Info", signal: "State",
  unit: null, minimum: 0, maximum: 6, choices: ["START", "DRIVE"],
};

const cond = (over: Partial<Condition> = {}): Condition => ({
  message: NUMERIC.message, signal: NUMERIC.signal, op: ">", value: 100, ...over,
});

const setup = (condition: Condition, info: SignalInfo | null, problems = []) => {
  const onChange = vi.fn();
  const onClear = vi.fn();
  render(<ConditionEditor condition={condition} info={info} problems={problems}
    index={0} onChange={onChange} onClear={onClear} />);
  return { onChange, onClear };
};

describe("a numeric signal", () => {
  it("offers all six operators", () => {
    setup(cond(), NUMERIC);
    for (const op of [">", ">=", "<", "<=", "==", "!="]) {
      expect(screen.getByTestId(`condition-0-op-${op}`)).toBeTruthy();
    }
  });

  it("takes a number and reports it as a number, not a string", () => {
    const { onChange } = setup(cond(), NUMERIC);
    fireEvent.change(screen.getByTestId("condition-0-value-number"), { target: { value: "85" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: 85 }));
  });

  it("shows the DBC range as a hint rather than enforcing it", () => {
    setup(cond({ value: 9999 }), NUMERIC);
    expect(screen.getByTestId("condition-0-range").textContent).toContain("-100");
    expect(screen.getByTestId("condition-0-range").textContent).toContain("300");
  });
});

describe("an enum signal", () => {
  it("offers only equality operators, because ordering a label invents a scale", () => {
    setup(cond({ message: ENUM.message, signal: ENUM.signal, op: "==", value: "DRIVE" }), ENUM);
    expect(screen.getByTestId("condition-0-op-==")).toBeTruthy();
    expect(screen.getByTestId("condition-0-op-!=")).toBeTruthy();
    expect(screen.queryByTestId("condition-0-op->")).toBeNull();
  });

  it("offers the labels as a picker, so nobody has to spell one from memory", () => {
    setup(cond({ message: ENUM.message, signal: ENUM.signal, op: "==", value: "DRIVE" }), ENUM);
    const picker = screen.getByTestId("condition-0-value-enum") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(["START", "DRIVE"]);
    expect(screen.queryByTestId("condition-0-value-number")).toBeNull();
  });

  it("switches the value to a label when an ordering operator is replaced", () => {
    const { onChange } = setup(cond({ message: ENUM.message, signal: ENUM.signal, op: "==", value: "START" }), ENUM);
    fireEvent.change(screen.getByTestId("condition-0-value-enum"), { target: { value: "DRIVE" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: "DRIVE" }));
  });
});

describe("problems and clearing", () => {
  it("shows the problem for this condition next to it", () => {
    setup(cond(), NUMERIC, [{ path: "conditions.0.value", message: "Enter a number to compare against." }] as never);
    expect(screen.getByTestId("condition-0-problems").textContent)
      .toContain("Enter a number to compare against.");
  });

  it("clears the slot", () => {
    const { onClear } = setup(cond(), NUMERIC);
    fireEvent.click(screen.getByTestId("condition-0-clear"));
    expect(onClear).toHaveBeenCalled();
  });

  // Offline, or against a mismatched DBC, the signal may be unknown. The slot
  // must stay editable rather than trapping whatever is already in it.
  it("still edits when the signal is not in the catalog", () => {
    const { onChange } = setup(cond({ message: "GONE", signal: "MISSING", value: 5 }), null);
    fireEvent.change(screen.getByTestId("condition-0-value-number"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: 7 }));
  });
});
