import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SensorsGroupedResponse } from "../types";
import { AnalysisSignalPicker } from "./AnalysisSignalPicker";
import { subsystemColor } from "./sensor-palette";

const grouped: SensorsGroupedResponse = {
  updated_at: null,
  dbc_source: "test.dbc",
  messages: [
    {
      name: "PDU_Status",
      subsystem: "Powertrain",
      can_id: 256,
      can_id_hex: "0x100",
      signals: ["battery_voltage"],
    },
  ],
  ungrouped: [],
};

afterEach(() => {
  cleanup();
});

describe("AnalysisSignalPicker", () => {
  it("updates subsystem palette styles when theme prop changes", () => {
    const lightBorder = subsystemColor("Powertrain", "light").border;
    const darkBorder = subsystemColor("Powertrain", "dark").border;
    expect(lightBorder).not.toBe(darkBorder);

    const { rerender } = render(
      <AnalysisSignalPicker
        grouped={grouped}
        selected={new Set()}
        onToggle={vi.fn()}
        theme="light"
      />,
    );

    const header = screen.getByRole("button", { name: /PDU_Status/i });
    expect(header).toHaveStyle({ borderLeftColor: lightBorder });

    rerender(
      <AnalysisSignalPicker
        grouped={grouped}
        selected={new Set()}
        onToggle={vi.fn()}
        theme="dark"
      />,
    );

    expect(header).toHaveStyle({ borderLeftColor: darkBorder });
  });
});
