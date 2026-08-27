import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./PlotManager", () => ({
  default: () => <div>plot</div>,
}));

vi.mock("../context/TimelineContext", () => ({
  useTimeline: () => ({ selectedTimeMs: 0, mode: "live" }),
}));

import DraggablePlot from "./DraggablePlot";

describe("DraggablePlot semantic chrome", () => {
  it("uses semantic option/muted tokens for the grip instead of dark gray utilities", () => {
    const { container } = render(
      <DraggablePlot
        isOpen={true}
        onClose={vi.fn()}
        signalInfo={{
          msgID: "256",
          signalName: "PackCurrent",
          messageName: "BMS_Status",
          unit: "A",
        }}
      />
    );

    const shell = container.firstElementChild as HTMLElement;
    const grip = shell.querySelector(".cursor-grab") as HTMLElement;
    const icon = grip.querySelector("svg") as SVGElement;

    expect(shell.className).toMatch(/\bborder-border\b/);
    expect(shell.className).not.toMatch(/border-gray-700/);
    expect(grip.className).toMatch(/\bbg-option\b/);
    expect(grip.className).toMatch(/hover:bg-option-select/);
    expect(grip.className).not.toMatch(/bg-gray-800/);
    expect(grip.className).not.toMatch(/hover:bg-gray-700/);
    expect(icon.getAttribute("class") ?? "").toMatch(/\btext-text-muted\b/);
    expect(icon.getAttribute("class") ?? "").not.toMatch(/text-gray-400/);
  });
});
