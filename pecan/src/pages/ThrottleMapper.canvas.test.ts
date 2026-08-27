import { describe, expect, it } from "vitest";
import type { ThemeColors } from "../theme/useThemeColors";
import { throttleMapperCanvasStyles } from "./ThrottleMapper";

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

describe("throttleMapperCanvasStyles", () => {
  it("returns light-theme grid, series, and label colors instead of fixed dark/white values", () => {
    const styles = throttleMapperCanvasStyles(LIGHT);

    expect(styles.grid).toBe(LIGHT.grid);
    expect(styles.axis).toBe(LIGHT.border);
    expect(styles.label).toBe(LIGHT.mutedText);
    expect(styles.curve).toBe(LIGHT.secondary);
    expect(styles.deadzone).toBe(LIGHT.danger);
    expect(styles.simPoint).toBe(LIGHT.success);
    expect(styles.simPointStroke).toBe(LIGHT.text);
    expect(styles.grid).not.toBe("#e5e7eb");
    expect(styles.curve).not.toBe("#00a6f4");
    expect(styles.simPointStroke).not.toBe("#ffffff");
  });

  it("returns PSL grid, series, and label colors instead of fixed dark/white values", () => {
    const styles = throttleMapperCanvasStyles(PSL);

    expect(styles.grid).toBe(PSL.grid);
    expect(styles.axis).toBe(PSL.border);
    expect(styles.label).toBe(PSL.mutedText);
    expect(styles.curve).toBe(PSL.secondary);
    expect(styles.deadzone).toBe(PSL.danger);
    expect(styles.simPoint).toBe(PSL.success);
    expect(styles.simPointStroke).toBe(PSL.text);
    expect(styles.label).not.toBe("#ffffff");
    expect(styles.deadzone).not.toBe("#ef4444");
    expect(styles.simPoint).not.toBe("#16a34a");
  });
});
