import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuleDoc } from "../../lib/wcars/engine/types";
import RuleJsonView from "./RuleJsonView";

const doc: RuleDoc = {
  id: "r1", name: "Motor overtemp", enabled: true, severity: "WARNING", message: "MOTOR TEMP HI",
  conditions: [{ message: "M162_Temperature_Set_3", signal: "INV_Motor_Temp", op: ">", value: 100 }],
  for_seconds: 2, rearm_seconds: 30,
};

describe("RuleJsonView", () => {
  it("shows the document the builder holds", () => {
    render(<RuleJsonView doc={doc} onChange={vi.fn()} />);
    const text = (screen.getByTestId("rule-json") as HTMLTextAreaElement).value;
    expect(JSON.parse(text)).toEqual(doc);
  });

  it("pushes a valid edit back to the builder", () => {
    const onChange = vi.fn();
    render(<RuleJsonView doc={doc} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("rule-json"), {
      target: { value: JSON.stringify({ ...doc, name: "Edited" }) },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "Edited" }));
  });

  it("reports a parse error and leaves the builder on its last good state", () => {
    const onChange = vi.fn();
    render(<RuleJsonView doc={doc} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("rule-json"), { target: { value: "{ not json" } });
    expect(screen.getByTestId("rule-json-error").textContent).toMatch(/not valid json/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the broken text on screen so the edit is not thrown away", () => {
    render(<RuleJsonView doc={doc} onChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("rule-json"), { target: { value: "{ not json" } });
    expect((screen.getByTestId("rule-json") as HTMLTextAreaElement).value).toBe("{ not json");
  });

  it("rejects a JSON array, since a rule is one object", () => {
    const onChange = vi.fn();
    render(<RuleJsonView doc={doc} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("rule-json"), { target: { value: "[]" } });
    expect(screen.getByTestId("rule-json-error").textContent).toMatch(/one rule/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-renders from the builder when the builder changes underneath it", () => {
    const { rerender } = render(<RuleJsonView doc={doc} onChange={vi.fn()} />);
    rerender(<RuleJsonView doc={{ ...doc, name: "From builder" }} onChange={vi.fn()} />);
    expect((screen.getByTestId("rule-json") as HTMLTextAreaElement).value).toContain("From builder");
  });
});
