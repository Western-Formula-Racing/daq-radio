import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildIndex } from "../../utils/signalIndex";
import type { RawSignal } from "../../utils/omtClient";
import SignalPalette from "./SignalPalette";

// Realistic collision: the same thermistor signal name reported under two
// different BMS module messages, exactly as WFR25.dbc and example.dbc do.
const COLLIDING_RAW: RawSignal[] = [
  { message: "BMS_Thermistor_Module_1", signal: "Highest_Thermistor_Value", unit: "temperature:C", minimum: -40, maximum: 125, choices: null },
  { message: "BMS_Thermistor_Module_2", signal: "Highest_Thermistor_Value", unit: "temperature:C", minimum: -40, maximum: 125, choices: null },
];
const collidingIndex = buildIndex(COLLIDING_RAW);

const RAW: RawSignal[] = [
  { message: "M162_Temperature_Set_3", signal: "INV_Motor_Temp", unit: "temperature:C", minimum: -100, maximum: 300, choices: null },
  { message: "M162_Temperature_Set_3", signal: "INV_Coolant_Temp", unit: "temperature:C", minimum: -100, maximum: 300, choices: null },
  { message: "VCU_State_Info", signal: "State", unit: null, minimum: 0, maximum: 6, choices: { "0": "START", "4": "DRIVE" } },
];
const index = buildIndex(RAW);

const setup = (over = {}) => {
  const onArm = vi.fn();
  render(<SignalPalette index={index} armed={null} onArm={onArm} {...over} />);
  return onArm;
};

describe("SignalPalette", () => {
  it("shows messages collapsed so 678 signals do not arrive at once", () => {
    setup();
    expect(screen.getAllByTestId(/^palette-message-/)).toHaveLength(2);
    expect(screen.queryByTestId("palette-signal-M162_Temperature_Set_3-INV_Motor_Temp")).toBeNull();
  });

  it("expands a message on tap", () => {
    setup();
    fireEvent.click(screen.getByTestId("palette-message-M162_Temperature_Set_3"));
    expect(screen.getByTestId("palette-signal-M162_Temperature_Set_3-INV_Motor_Temp")).toBeTruthy();
  });

  it("filters by signal name and auto-expands the matches", () => {
    setup();
    fireEvent.change(screen.getByTestId("palette-search"), { target: { value: "coolant" } });
    expect(screen.getByTestId("palette-signal-M162_Temperature_Set_3-INV_Coolant_Temp")).toBeTruthy();
    expect(screen.queryByTestId("palette-signal-M162_Temperature_Set_3-INV_Motor_Temp")).toBeNull();
  });

  it("says so plainly when a search matches nothing", () => {
    setup();
    fireEvent.change(screen.getByTestId("palette-search"), { target: { value: "zzzz" } });
    expect(screen.getByTestId("palette-empty").textContent).toMatch(/no signal/i);
  });

  it("arms the signal that was tapped", () => {
    const onArm = setup();
    fireEvent.change(screen.getByTestId("palette-search"), { target: { value: "motor" } });
    fireEvent.click(screen.getByTestId("palette-signal-M162_Temperature_Set_3-INV_Motor_Temp"));
    expect(onArm).toHaveBeenCalledWith(expect.objectContaining({ signal: "INV_Motor_Temp" }));
  });

  it("disarms when the armed signal is tapped again", () => {
    const armed = { message: "M162_Temperature_Set_3", signal: "INV_Motor_Temp", unit: null, minimum: null, maximum: null, choices: null };
    const onArm = vi.fn();
    render(<SignalPalette index={index} armed={armed} onArm={onArm} />);
    fireEvent.change(screen.getByTestId("palette-search"), { target: { value: "motor" } });
    fireEvent.click(screen.getByTestId("palette-signal-M162_Temperature_Set_3-INV_Motor_Temp"));
    expect(onArm).toHaveBeenCalledWith(null);
  });

  it("shows an enum signal's named values, not a numeric range", () => {
    setup();
    fireEvent.change(screen.getByTestId("palette-search"), { target: { value: "State" } });
    const row = screen.getByTestId("palette-signal-VCU_State_Info-State");
    expect(within(row).getByText(/2 named values/i)).toBeTruthy();
  });

  it("explains itself when there is no catalog at all", () => {
    render(<SignalPalette index={null} armed={null} onArm={vi.fn()}
      emptyReason="No DBC is loaded, so there are no signals to choose from." />);
    expect(screen.getByTestId("palette-empty").textContent).toMatch(/no dbc is loaded/i);
  });

  it("keeps colliding signal names addressable across messages and arms the right one", () => {
    const onArm = vi.fn();
    render(<SignalPalette index={collidingIndex} armed={null} onArm={onArm} />);
    fireEvent.click(screen.getByTestId("palette-message-BMS_Thermistor_Module_1"));
    fireEvent.click(screen.getByTestId("palette-message-BMS_Thermistor_Module_2"));

    const row1 = screen.getByTestId("palette-signal-BMS_Thermistor_Module_1-Highest_Thermistor_Value");
    const row2 = screen.getByTestId("palette-signal-BMS_Thermistor_Module_2-Highest_Thermistor_Value");
    expect(row1).toBeTruthy();
    expect(row2).toBeTruthy();

    fireEvent.click(row2);
    expect(onArm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "BMS_Thermistor_Module_2", signal: "Highest_Thermistor_Value" }),
    );
  });

  it("has aria-expanded on the message toggle reflecting open state", () => {
    setup();
    const toggle = screen.getByTestId("palette-message-M162_Temperature_Set_3");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
