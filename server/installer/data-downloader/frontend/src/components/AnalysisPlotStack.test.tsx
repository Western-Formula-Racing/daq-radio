import { cleanup, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SignalSeries } from "../types";
import { AnalysisPlotStack } from "./AnalysisPlotStack";

vi.mock("react-plotly.js", () => ({
  default: (props: {
    style?: CSSProperties;
    className?: string;
    data?: unknown[];
  }) => (
    <div
      data-testid="plotly-mock"
      className={props.className}
      style={props.style}
      data-trace-count={props.data?.length ?? 0}
    />
  ),
}));

afterEach(() => {
  cleanup();
});

const series: SignalSeries = {
  mode: "raw",
  resolution_ms: null,
  point_count: 3,
  t: [
    Date.parse("2026-06-08T21:00:00.000Z"),
    Date.parse("2026-06-08T22:00:00.000Z"),
    Date.parse("2026-06-08T23:00:00.000Z"),
  ],
  v: [1.0, 2.5, 1.8],
};

describe("AnalysisPlotStack", () => {
  it("passes Plotly an explicit 180px height (not percentage) so plots stay in-card", () => {
    render(
      <AnalysisPlotStack
        seriesBySignal={{ INV_Analog_Input_1: series }}
        signals={["INV_Analog_Input_1"]}
        range={[
          Date.parse("2026-06-08T21:00:00.000Z"),
          Date.parse("2026-06-09T03:00:00.000Z"),
        ]}
        onRangeChange={vi.fn()}
        theme="dark"
      />,
    );

    const plot = screen.getByTestId("plotly-mock");
    expect(Number(plot.getAttribute("data-trace-count"))).toBeGreaterThan(0);
    expect(plot).toHaveStyle({ width: "100%", height: "180px" });
    expect(plot.style.height).not.toBe("100%");
  });
});
