import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "next-themes";
import { ThemeRequestBridge } from "./ThemeRequestBridge";
import { THEME_REQUEST_EVENT } from "./theme";

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: mocks.setTheme }),
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

describe("ThemeRequestBridge", () => {
  beforeEach(() => {
    mocks.setTheme.mockClear();
  });

  it("forwards a valid theme request to setTheme", () => {
    render(
      <ThemeProvider>
        <ThemeRequestBridge />
      </ThemeProvider>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(THEME_REQUEST_EVENT, { detail: { theme: "psl" } })
      );
    });

    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.setTheme).toHaveBeenCalledWith("psl");
  });

  it("ignores invalid theme requests", () => {
    render(
      <ThemeProvider>
        <ThemeRequestBridge />
      </ThemeProvider>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(THEME_REQUEST_EVENT, { detail: { theme: "not-a-theme" } })
      );
    });

    expect(mocks.setTheme).not.toHaveBeenCalled();
  });
});
