import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  grid: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  checkpoint: string;
  checkpointBackground: string;
  state: string;
  stateBackground: string;
  flowNodeBackground: string;
  flowNodeText: string;
  flowEdge: string;
  flowGrid: string;
}

const TOKEN_BY_FIELD: Record<keyof ThemeColors, string> = {
  background: "--color-background",
  surface: "--color-data-module-bg",
  text: "--color-text-primary",
  mutedText: "--color-text-muted",
  border: "--color-border",
  grid: "--color-chart-grid",
  primary: "--color-chart-series-primary",
  secondary: "--color-chart-series-secondary",
  success: "--color-chart-series-success",
  warning: "--color-chart-series-warning",
  danger: "--color-chart-series-danger",
  checkpoint: "--color-chart-checkpoint",
  checkpointBackground: "--color-chart-checkpoint-bg",
  state: "--color-chart-state",
  stateBackground: "--color-chart-state-bg",
  flowNodeBackground: "--color-flow-node-bg",
  flowNodeText: "--color-flow-node-text",
  flowEdge: "--color-flow-edge",
  flowGrid: "--color-flow-grid",
};

const DARK_FALLBACKS: ThemeColors = {
  background: "#0d0c11",
  surface: "#20202f",
  text: "#ffffff",
  mutedText: "#8e8eab",
  border: "rgba(255, 255, 255, 0.12)",
  grid: "rgba(255, 255, 255, 0.12)",
  primary: "#a855f7",
  secondary: "#38bdf8",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  checkpoint: "#f59e0b",
  checkpointBackground: "rgba(245, 158, 11, 0.2)",
  state: "#d946ef",
  stateBackground: "rgba(217, 70, 239, 0.2)",
  flowNodeBackground: "#20202f",
  flowNodeText: "#ffffff",
  flowEdge: "#8e8eab",
  flowGrid: "rgba(255, 255, 255, 0.06)",
};

export function readThemeColors(element?: Element): ThemeColors {
  const target = element ?? document.documentElement;
  const styles = getComputedStyle(target);
  const colors = {} as ThemeColors;

  for (const field of Object.keys(TOKEN_BY_FIELD) as (keyof ThemeColors)[]) {
    colors[field] = styles.getPropertyValue(TOKEN_BY_FIELD[field]).trim() || DARK_FALLBACKS[field];
  }

  return colors;
}

export function useThemeColors(): ThemeColors {
  const { resolvedTheme, theme } = useTheme();
  const themeKey = resolvedTheme ?? theme;
  const [colors, setColors] = useState(() => readThemeColors());

  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (!cancelled) {
        setColors(readThemeColors());
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [themeKey]);

  return colors;
}
