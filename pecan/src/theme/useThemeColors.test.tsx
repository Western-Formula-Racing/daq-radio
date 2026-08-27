import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "next-themes";
import type { ThemeColors } from "./useThemeColors";
import { readThemeColors, useThemeColors } from "./useThemeColors";

const mocks = vi.hoisted(() => ({
  theme: "dark" as string | undefined,
  resolvedTheme: "dark" as string | undefined,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: mocks.theme,
    resolvedTheme: mocks.resolvedTheme,
  }),
}));

const SAMPLE_COLORS: ThemeColors = {
  background: "#111111",
  surface: "#222222",
  text: "#eeeeee",
  mutedText: "#aaaaaa",
  border: "rgba(255, 255, 255, 0.2)",
  grid: "rgba(255, 255, 255, 0.3)",
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

const LIGHT_COLORS: ThemeColors = {
  ...SAMPLE_COLORS,
  background: "#dde1e8",
  surface: "#ffffff",
  text: "#334155",
  mutedText: "#6b6b7a",
  primary: "#7e22ce",
};

const CSS_VARS: Record<keyof ThemeColors, string> = {
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

function applyColors(element: HTMLElement, colors: ThemeColors) {
  for (const key of Object.keys(CSS_VARS) as (keyof ThemeColors)[]) {
    element.style.setProperty(CSS_VARS[key], colors[key]);
  }
}

function clearColors(element: HTMLElement) {
  for (const token of Object.values(CSS_VARS)) {
    element.style.removeProperty(token);
  }
}

let latestColors: ThemeColors | undefined;

function ColorProbe() {
  latestColors = useThemeColors();
  return <div data-testid="background">{latestColors.background}</div>;
}

async function flushDeferredThemeRead() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("readThemeColors", () => {
  beforeEach(() => {
    clearColors(document.documentElement);
  });

  it("reads visualization tokens from document.documentElement by default", () => {
    applyColors(document.documentElement, SAMPLE_COLORS);

    expect(readThemeColors()).toEqual(SAMPLE_COLORS);
  });

  it("reads visualization tokens from a supplied element", () => {
    const host = document.createElement("div");
    applyColors(host, LIGHT_COLORS);
    document.body.appendChild(host);

    expect(readThemeColors(host)).toEqual(LIGHT_COLORS);
    host.remove();
  });

  it("supplies safe dark fallbacks when tokens are missing", () => {
    expect(readThemeColors()).toEqual(DARK_FALLBACKS);
  });
});

describe("useThemeColors", () => {
  beforeEach(() => {
    mocks.theme = "dark";
    mocks.resolvedTheme = "dark";
    latestColors = undefined;
    clearColors(document.documentElement);
    applyColors(document.documentElement, SAMPLE_COLORS);
  });

  it("returns the resolved token colors under the mocked theme", async () => {
    render(<ColorProbe />);
    await flushDeferredThemeRead();

    expect(latestColors).toEqual(SAMPLE_COLORS);
  });

  it("updates from next-themes state after CSS class tokens change", async () => {
    const { rerender } = render(<ColorProbe />);
    await flushDeferredThemeRead();
    const first = latestColors;

    applyColors(document.documentElement, LIGHT_COLORS);
    mocks.theme = "light";
    mocks.resolvedTheme = "light";
    rerender(<ColorProbe />);
    await flushDeferredThemeRead();

    expect(latestColors).not.toBe(first);
    expect(latestColors).toEqual(LIGHT_COLORS);
  });

  it("depends on resolvedTheme ?? theme rather than theme alone", async () => {
    mocks.theme = "dark";
    mocks.resolvedTheme = "psl";
    applyColors(document.documentElement, {
      ...SAMPLE_COLORS,
      background: "#160f0b",
    });

    const { rerender } = render(<ColorProbe />);
    await flushDeferredThemeRead();
    const first = latestColors;
    expect(first?.background).toBe("#160f0b");

    applyColors(document.documentElement, LIGHT_COLORS);
    mocks.theme = "light";
    rerender(<ColorProbe />);
    await flushDeferredThemeRead();
    expect(latestColors).toBe(first);

    mocks.resolvedTheme = "light";
    rerender(<ColorProbe />);
    await flushDeferredThemeRead();
    expect(latestColors).not.toBe(first);
    expect(latestColors).toEqual(LIGHT_COLORS);
  });

  it("eventually reads tokens applied by a later parent passive effect", async () => {
    function ThemeClassParent({ children }: { children: ReactNode }) {
      const { resolvedTheme, theme } = useTheme();
      const themeKey = resolvedTheme ?? theme;

      useEffect(() => {
        if (themeKey === "light") {
          applyColors(document.documentElement, LIGHT_COLORS);
        }
      }, [themeKey]);

      return children;
    }

    const { rerender } = render(
      <ThemeClassParent>
        <ColorProbe />
      </ThemeClassParent>
    );
    expect(latestColors).toEqual(SAMPLE_COLORS);

    mocks.theme = "light";
    mocks.resolvedTheme = "light";
    rerender(
      <ThemeClassParent>
        <ColorProbe />
      </ThemeClassParent>
    );

    await waitFor(() => {
      expect(latestColors).toEqual(LIGHT_COLORS);
    });
  });

  it("stays stable across unrelated rerenders", async () => {
    function Harness() {
      const [, setTick] = useState(0);
      return (
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          <ColorProbe />
        </button>
      );
    }

    const { getByRole } = render(<Harness />);
    await flushDeferredThemeRead();
    const first = latestColors;

    act(() => {
      getByRole("button").click();
    });
    act(() => {
      getByRole("button").click();
    });

    expect(latestColors).toBe(first);
  });
});
