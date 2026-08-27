import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_THEMES,
  THEME_CLASS,
  THEME_REQUEST_EVENT,
  getStoredTheme,
  isAppTheme,
  requestTheme,
} from "./theme";

describe("theme registry", () => {
  it("maps every app theme to its exact CSS class", () => {
    expect(APP_THEMES).toEqual(["dark", "light", "psl", "internal", "local-can"]);
    expect(THEME_CLASS).toEqual({
      dark: "theme-dark",
      light: "theme-light",
      psl: "theme-psl",
      internal: "theme-internal",
      "local-can": "theme-local-can",
    });
  });

  it("accepts only registered theme names", () => {
    expect(isAppTheme("dark")).toBe(true);
    expect(isAppTheme("psl")).toBe(true);
    expect(isAppTheme("local-can")).toBe(true);
    expect(isAppTheme("sunset")).toBe(false);
    expect(isAppTheme(null)).toBe(false);
  });

  describe("getStoredTheme", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("returns a stored app theme", () => {
      localStorage.setItem("pecan:theme", "psl");
      expect(getStoredTheme("dark")).toBe("psl");
    });

    it("rejects unknown storage values instead of casting them", () => {
      localStorage.setItem("pecan:theme", "sunset");
      expect(getStoredTheme("dark")).toBe("dark");
      expect(getStoredTheme("light")).toBe("light");
    });

    it("uses the fallback when storage is empty", () => {
      expect(getStoredTheme("internal")).toBe("internal");
    });
  });

  it("requestTheme dispatches pecan:theme-request with the theme", () => {
    const handler = vi.fn();
    window.addEventListener(THEME_REQUEST_EVENT, handler);

    requestTheme("psl");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.theme).toBe("psl");
    window.removeEventListener(THEME_REQUEST_EVENT, handler);
  });
});
