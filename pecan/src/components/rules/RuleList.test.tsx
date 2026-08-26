import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RuleList, { summarize } from "./RuleList";
import type { StoredRule } from "./RuleList";

const rule: StoredRule = {
  id: "r1", name: "Motor overtemp", enabled: true, severity: "WARNING", message: "MOTOR TEMP HI",
  conditions: [{ message: "M162_Temperature_Set_3", signal: "INV_Motor_Temp", op: ">", value: 100 }],
  for_seconds: 2, rearm_seconds: 30, rev: 4,
};

describe("summarize", () => {
  it("reads as a sentence a student can check at a glance", () => {
    expect(summarize(rule)).toBe("INV_Motor_Temp > 100 held 2 s");
  });

  it("joins multiple conditions with and", () => {
    expect(summarize({ ...rule, for_seconds: 0, conditions: [
      rule.conditions[0],
      { message: "VCU_State_Info", signal: "State", op: "==", value: "DRIVE" },
    ] })).toBe("INV_Motor_Temp > 100 and State == DRIVE");
  });
});

describe("RuleList", () => {
  const setup = (over: Partial<StoredRule> = {}) => {
    const handlers = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() };
    render(<RuleList rules={[{ ...rule, ...over }]} {...handlers} />);
    return handlers;
  };

  it("lists a rule with its severity and summary", () => {
    setup();
    const row = screen.getByTestId("rule-row-r1");
    expect(row.textContent).toContain("Motor overtemp");
    expect(row.textContent).toContain("WARNING");
    expect(row.textContent).toContain("INV_Motor_Temp > 100 held 2 s");
  });

  it("says plainly when a rule is disarmed", () => {
    setup({ enabled: false });
    expect(screen.getByTestId("rule-row-r1").textContent).toMatch(/disarmed/i);
  });

  it("shows why a broken rule is not being evaluated", () => {
    setup({ broken: true, broken_reason: "signal 'INV_Motor_Temp' not in message" });
    expect(screen.getByTestId("rule-broken-r1").textContent)
      .toContain("signal 'INV_Motor_Temp' not in message");
  });

  it("names a broken rule even when the car gave no reason", () => {
    setup({ broken: true, broken_reason: null });
    expect(screen.getByTestId("rule-broken-r1").textContent).toMatch(/not being evaluated/i);
  });

  it("edits, toggles, and deletes", () => {
    const handlers = setup();
    fireEvent.click(screen.getByTestId("rule-edit-r1"));
    fireEvent.click(screen.getByTestId("rule-toggle-r1"));
    fireEvent.click(screen.getByTestId("rule-delete-r1"));
    expect(handlers.onEdit).toHaveBeenCalled();
    expect(handlers.onToggle).toHaveBeenCalled();
    expect(handlers.onDelete).toHaveBeenCalled();
  });

  it("says so when the car has no rules yet, rather than showing an empty box", () => {
    render(<RuleList rules={[]} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId("rule-list-empty").textContent).toMatch(/no rules/i);
  });
});
