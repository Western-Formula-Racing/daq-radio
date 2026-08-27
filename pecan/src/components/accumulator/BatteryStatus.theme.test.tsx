import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sensorReading: null as number | null,
}));

vi.mock("../../lib/useDataStore", () => ({
  useSignal: () => ({ sensorReading: mocks.sensorReading }),
}));

import { BatteryStatus } from "./BatteryStatus";

const LEGACY_BRIGHT = /text-(?:green|orange|blue)-\d+/;

function renderStatus(reading: number | null) {
  mocks.sensorReading = reading;
  const view = render(<BatteryStatus />);
  const chip = view.container.firstElementChild as HTMLElement;
  return { ...view, chip };
}

describe("BatteryStatus semantic chrome", () => {
  beforeEach(() => {
    mocks.sensorReading = null;
  });

  it("uses semantic surface, border, and muted text instead of dark gray utilities", () => {
    const { chip } = renderStatus(null);

    expect(chip.className).toMatch(/\bbg-option\b/);
    expect(chip.className).toMatch(/\bborder-border\b/);
    expect(chip.className).toMatch(/\btext-text-muted\b/);
    expect(chip.className).not.toMatch(/bg-gray-800/);
    expect(chip.className).not.toMatch(/border-gray-700/);
    expect(chip.className).not.toMatch(/text-gray-400/);
    expect(screen.getByText("Static").className).not.toMatch(/text-gray-400/);
    expect(chip.className).not.toMatch(LEGACY_BRIGHT);
  });

  it("uses the success series token for charging current", () => {
    const { chip } = renderStatus(-1);

    expect(screen.getByText("Charging")).toBeTruthy();
    expect(chip.className).toMatch(/\btext-chart-series-success\b/);
    expect(chip.className).not.toMatch(LEGACY_BRIGHT);
  });

  it("uses the warning series token for discharging current", () => {
    const { chip } = renderStatus(1);

    expect(screen.getByText("Discharging")).toBeTruthy();
    expect(chip.className).toMatch(/\btext-chart-series-warning\b/);
    expect(chip.className).not.toMatch(LEGACY_BRIGHT);
  });

  it("uses the secondary series token for standby current", () => {
    const { chip } = renderStatus(0);

    expect(screen.getByText("Standby")).toBeTruthy();
    expect(chip.className).toMatch(/\btext-chart-series-secondary\b/);
    expect(chip.className).not.toMatch(LEGACY_BRIGHT);
  });
});
