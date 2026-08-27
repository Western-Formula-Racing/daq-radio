import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlotControls from "./PlotControls";

const signalInfo = {
  msgID: "256",
  signalName: "PackCurrent",
  messageName: "BMS_Status",
  unit: "A",
};

describe("PlotControls dark-menu contrast", () => {
  it("locks message-header copy to white on the dropdown surface", () => {
    render(
      <PlotControls
        signalInfo={signalInfo}
        existingPlots={[]}
        position={{ x: 0, y: 0 }}
        onNewPlot={vi.fn()}
        onAddToPlot={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const header = screen.getByText("BMS_Status");
    expect(header.className).toMatch(/text-\[#fff\]/);
    expect(header.className).not.toMatch(/text-gray-400/);
    expect(header.closest(".bg-dropdown-menu-bg")).not.toBeNull();
  });
});
