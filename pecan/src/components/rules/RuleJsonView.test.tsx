import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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

/** How the parent hands an edit back down. A parent that rebuilds the document
 * field by field returns the same content under a different key order, which is
 * still the view's own edit and must not be treated as a builder change.
 */
type EchoMode = "identity" | "reordered";

function Harness({ initial, echo = "identity" }: { initial: RuleDoc; echo?: EchoMode }) {
  const [held, setHeld] = useState<RuleDoc>(initial);
  const [ticks, setTicks] = useState(0);
  const handleChange = (next: RuleDoc) => {
    if (echo !== "reordered") {
      setHeld(next);
      return;
    }
    // Put conditions/name first so key order differs from JSON.stringify(next),
    // without repeating those keys in one object literal (TS2783).
    const { conditions, name, ...rest } = next;
    setHeld({ conditions, name, ...rest });
  };
  return (
    <>
      {/* A fresh object each render is what a parent holding the rule inside a larger
          state object hands down, so the view sees a new reference with the same content. */}
      <RuleJsonView doc={{ ...held }} onChange={handleChange} />
      <button data-testid="builder-rename" onClick={() => setHeld((d) => ({ ...d, name: "From builder" }))}>
        rename
      </button>
      <button data-testid="unrelated" onClick={() => setTicks((t) => t + 1)}>
        tick {ticks}
      </button>
    </>
  );
}

const box = () => screen.getByTestId("rule-json") as HTMLTextAreaElement;

// Compact, keys in an order JSON.stringify would never reproduce, so any guard that
// re-serializes the echoed document visibly loses what the user typed.
const typedCompact = '{"name":"Typed by hand","id":"r1","conditions":[],"enabled":true,'
  + '"severity":"WARNING","message":"MOTOR TEMP HI","for_seconds":2,"rearm_seconds":30}';

describe("RuleJsonView synchronization with a live parent", () => {
  it("shows a change made in the visual builder", () => {
    render(<Harness initial={doc} />);
    fireEvent.click(screen.getByTestId("builder-rename"));
    expect(box().value).toContain("From builder");
  });

  it("leaves the user's exact text alone when the parent echoes it back", () => {
    render(<Harness initial={doc} />);
    fireEvent.change(box(), { target: { value: typedCompact } });
    expect(box().value).toBe(typedCompact);
  });

  it("survives an echo whose keys come back in a different order", () => {
    render(<Harness initial={doc} echo="reordered" />);
    fireEvent.change(box(), { target: { value: typedCompact } });
    expect(box().value).toBe(typedCompact);
  });

  it("keeps the second of two rapid edits rather than re-serializing the first", () => {
    render(<Harness initial={doc} />);
    const first = JSON.stringify({ ...doc, name: "First" });
    const second = '{"name":"Second","id":"r1","conditions":[],"enabled":true,'
      + '"severity":"WARNING","message":"MOTOR TEMP HI","for_seconds":2,"rearm_seconds":30}';
    fireEvent.change(box(), { target: { value: first } });
    fireEvent.change(box(), { target: { value: second } });
    expect(box().value).toBe(second);
  });

  it("does not rewrite half-typed text when the parent re-renders for its own reasons", () => {
    render(<Harness initial={doc} />);
    fireEvent.change(box(), { target: { value: typedCompact } });
    fireEvent.click(screen.getByTestId("unrelated"));
    fireEvent.click(screen.getByTestId("unrelated"));
    expect(box().value).toBe(typedCompact);
  });

  it("keeps invalid text through an unrelated re-render but still yields to the builder", () => {
    render(<Harness initial={doc} />);
    fireEvent.change(box(), { target: { value: '{"name": "half typed' } });
    fireEvent.click(screen.getByTestId("unrelated"));
    expect(box().value).toBe('{"name": "half typed');
    expect(screen.getByTestId("rule-json-error").textContent).toMatch(/not valid json/i);

    fireEvent.click(screen.getByTestId("builder-rename"));
    expect(box().value).toContain("From builder");
    expect(screen.queryByTestId("rule-json-error")).toBeNull();
  });
});
