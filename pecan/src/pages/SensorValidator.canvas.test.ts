import { describe, expect, it } from "vitest";
import type { ThemeColors } from "../theme/useThemeColors";
import { sensorValidatorCanvasStyles } from "./SensorValidator";

const LIGHT: ThemeColors = {
  background: "#dde1e8",
  surface: "#ffffff",
  text: "#334155",
  mutedText: "#94a3b8",
  border: "rgba(0, 0, 0, 0.1)",
  grid: "rgba(0, 0, 0, 0.1)",
  primary: "#7e22ce",
  secondary: "#0369a1",
  success: "#15803d",
  warning: "#b45309",
  danger: "#b91c1c",
  checkpoint: "#b45309",
  checkpointBackground: "rgba(180, 83, 9, 0.16)",
  state: "#a21caf",
  stateBackground: "rgba(162, 28, 175, 0.14)",
  flowNodeBackground: "#ffffff",
  flowNodeText: "#1e293b",
  flowEdge: "#64748b",
  flowGrid: "rgba(0, 0, 0, 0.06)",
};

const PSL: ThemeColors = {
  background: "#160f0b",
  surface: "#291a12",
  text: "#fff4df",
  mutedText: "#c39a72",
  border: "rgba(239, 212, 173, 0.16)",
  grid: "rgba(239, 212, 173, 0.16)",
  primary: "#f59e0b",
  secondary: "#fb923c",
  success: "#84cc16",
  warning: "#fde047",
  danger: "#e11d48",
  checkpoint: "#f59e0b",
  checkpointBackground: "rgba(245, 158, 11, 0.22)",
  state: "#c2410c",
  stateBackground: "rgba(194, 65, 12, 0.22)",
  flowNodeBackground: "#291a12",
  flowNodeText: "#fff4df",
  flowEdge: "#c39a72",
  flowGrid: "rgba(239, 212, 173, 0.08)",
};

const FIXED_DARK_OR_WHITE = ["#ffffff", "#fff", "#000000", "#000", "#666", "#3b82f6", "#ef4444"];

describe("sensorValidatorCanvasStyles", () => {
  it("returns light-theme grid, series, and label colors instead of fixed dark/white values", () => {
    const styles = sensorValidatorCanvasStyles(LIGHT);

    expect(styles.grid).toBe(LIGHT.grid);
    expect(styles.label).toBe(LIGHT.mutedText);
    expect(styles.series).toBe(LIGHT.primary);
    expect(styles.sparkline).toBe(LIGHT.primary);
    expect(styles.livePoint).toBe(LIGHT.danger);
    expect(FIXED_DARK_OR_WHITE).not.toContain(styles.grid);
    expect(FIXED_DARK_OR_WHITE).not.toContain(styles.label);
    expect(FIXED_DARK_OR_WHITE).not.toContain(styles.series);
  });

  it("returns PSL grid, series, and label colors instead of fixed dark/white values", () => {
    const styles = sensorValidatorCanvasStyles(PSL);

    expect(styles.grid).toBe(PSL.grid);
    expect(styles.label).toBe(PSL.mutedText);
    expect(styles.series).toBe(PSL.primary);
    expect(styles.sparkline).toBe(PSL.primary);
    expect(styles.livePoint).toBe(PSL.danger);
    expect(styles.series).not.toBe("#3b82f6");
    expect(styles.livePoint).not.toBe("#ef4444");
    expect(styles.label).not.toBe("#ffffff");
  });
});
