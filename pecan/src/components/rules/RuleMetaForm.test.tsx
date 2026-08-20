import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuleDoc } from "../../lib/wcars/engine/types";
import { validateRuleDoc } from "../../utils/ruleValidate";
import RuleMetaForm from "./RuleMetaForm";

const doc: RuleDoc = {
  id: "r1", name: "Motor overtemp", enabled: true, severity: "WARNING", message: "MOTOR TEMP HI",
  conditions: [], for_seconds: 2, rearm_seconds: 30,
};

const setup = (over: Partial<RuleDoc> = {}, problems = []) => {
  const onChange = vi.fn();
  render(<RuleMetaForm doc={{ ...doc, ...over }} problems={problems} onChange={onChange} />);
  return onChange;
};

describe("RuleMetaForm", () => {
  it("edits the name", () => {
    const onChange = setup();
    fireEvent.change(screen.getByTestId("rule-name"), { target: { value: "Motor hot" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "Motor hot" }));
  });

  it("counts the display message against the limit that fits the display line", () => {
    setup({ message: "MOTOR TEMP HI" });
    expect(screen.getByTestId("rule-message-count").textContent).toBe("13/24");
  });

  it("flags an over-length message rather than truncating it, which would misinform a driver", () => {
    setup({ message: "ABCDEFGHIJKLMNOPQRSTUVWXY" },
      [{ path: "message", message: "The message must be 24 characters or fewer so it fits the display line." }] as never);
    expect(screen.getByTestId("rule-problem-message").textContent).toMatch(/24 characters or fewer/);
  });

  it("offers exactly the three severities the engine knows", () => {
    setup();
    const select = screen.getByTestId("rule-severity") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["WARNING", "CAUTION", "MEMO"]);
  });

  it("reports seconds as numbers, not strings", () => {
    const onChange = setup();
    fireEvent.change(screen.getByTestId("rule-for-seconds"), { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ for_seconds: 1.5 }));
  });

  it("toggles enabled", () => {
    const onChange = setup({ enabled: true });
    fireEvent.click(screen.getByTestId("rule-enabled"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("emits a value the validator rejects when a seconds field is emptied, rather than a silent fire-immediately 0", () => {
    const validCondition = { message: "Motor", signal: "temp", op: ">" as const, value: 80 };
    const onChange = setup({ conditions: [validCondition] });
    fireEvent.change(screen.getByTestId("rule-for-seconds"), { target: { value: "" } });
    const [next] = onChange.mock.calls[0];
    const problems = validateRuleDoc(next, null);
    expect(problems).toContainEqual(expect.objectContaining({ path: "for_seconds" }));
  });

  it("shows a for_seconds problem where the user can see it", () => {
    setup({}, [{ path: "for_seconds", message: "Must be a number of seconds, zero or more." }] as never);
    expect(screen.getByTestId("rule-problem-for_seconds")).toBeTruthy();
  });

  it("renders an emptied seconds field as empty, not as the text NaN", () => {
    setup({ for_seconds: NaN });
    const input = screen.getByTestId("rule-for-seconds") as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
