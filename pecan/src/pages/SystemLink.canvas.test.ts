import { describe, expect, it } from "vitest";
import type { ThemeColors } from "../theme/useThemeColors";
import { systemLinkSparklineColor, systemLinkWaveformStyles } from "./SystemLink";

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

describe("systemLinkWaveformStyles", () => {
  it("returns light-theme background and series colors instead of fixed dark/white values", () => {
    const styles = systemLinkWaveformStyles(LIGHT);

    expect(styles.background).toBe(LIGHT.surface);
    expect(styles.stroke).toBe(LIGHT.primary);
    expect(styles.background).not.toBe("#20202f");
    expect(styles.stroke).not.toBe("#8e8eab");
    expect(styles.stroke).not.toBe("#ffffff");
  });

  it("returns PSL background and series colors instead of fixed dark/white values", () => {
    const styles = systemLinkWaveformStyles(PSL);

    expect(styles.background).toBe(PSL.surface);
    expect(styles.stroke).toBe(PSL.primary);
    expect(styles.background).not.toBe("#20202f");
    expect(styles.stroke).not.toBe("#ffffff");
  });
});

describe("systemLinkSparklineColor", () => {
  it("uses warning for stale and mutedText for live under light", () => {
    expect(systemLinkSparklineColor(LIGHT, true)).toBe(LIGHT.warning);
    expect(systemLinkSparklineColor(LIGHT, false)).toBe(LIGHT.mutedText);
    expect(systemLinkSparklineColor(LIGHT, true)).not.toBe("#f59e0b");
    expect(systemLinkSparklineColor(LIGHT, false)).not.toBe("#8e8eab");
  });

  it("uses warning for stale and mutedText for live under PSL", () => {
    expect(systemLinkSparklineColor(PSL, true)).toBe(PSL.warning);
    expect(systemLinkSparklineColor(PSL, false)).toBe(PSL.mutedText);
    expect(systemLinkSparklineColor(PSL, true)).not.toBe("#f59e0b");
  });
});
