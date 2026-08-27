import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  theme: "psl" as string,
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../lib/useDataStore", () => ({
  useAllSignals: () => [],
  useDataStoreControls: () => ({
    setRetentionWindow: vi.fn(),
    getRetentionWindow: () => 30 * 60 * 1000,
  }),
}));

vi.mock("../lib/useRemoteConfig", () => ({
  useRemoteConfig: () => ({
    session: null,
    loadConfig: vi.fn(async () => null),
    saveConfig: vi.fn(),
  }),
}));

vi.mock("../lib/useSerialStatus", () => ({
  useSerialStatus: () => false,
}));

vi.mock("./DbcSelector", () => ({
  DbcSelector: () => null,
}));

vi.mock("./NotNotGame", () => ({
  default: () => null,
}));

vi.mock("../services/WebSocketService", () => ({
  webSocketService: { reconnect: vi.fn() },
  PECAN_WS_CANDIDATES_KEY: "pecan:ws-candidates",
  DEFAULT_WS_FAILOVER_URLS: ["ws://localhost:9080"],
}));

vi.mock("../services/SerialService", () => ({
  serialService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getConnectionStatus: () => false,
  },
}));

vi.mock("../utils/canProcessor", () => ({
  forceCache: vi.fn(),
  clearDbcCache: vi.fn(),
}));

import SettingsModal from "./SettingsModal";

const bannerApi = {
  showDefault: vi.fn(),
  showCache: vi.fn(),
  hideDefault: vi.fn(),
  hideCache: vi.fn(),
  toggleDefault: vi.fn(),
  toggleCache: vi.fn(),
};

function renderOpenSettings() {
  return render(
    <SettingsModal isOpen={true} onClose={vi.fn()} bannerApi={bannerApi} />
  );
}

describe("SettingsModal theme control", () => {
  beforeEach(() => {
    mocks.theme = "psl";
    mocks.setTheme.mockClear();
  });

  it("renders Dark, Light, and Pumpkin Spice in the Theme group", () => {
    renderOpenSettings();

    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Light" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pumpkin Spice" })).toBeTruthy();
  });

  it("marks Pumpkin Spice pressed when the active theme is psl", () => {
    renderOpenSettings();

    expect(screen.getByRole("button", { name: "Pumpkin Spice" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("calls setTheme(light) when Light is clicked", async () => {
    const user = userEvent.setup();
    renderOpenSettings();

    await user.click(screen.getByRole("button", { name: "Light" }));

    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });

  it("exposes a visible focus-visible indicator using the focus token", () => {
    renderOpenSettings();

    for (const name of ["Dark", "Light", "Pumpkin Spice"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toMatch(/focus-visible:ring-2/);
      expect(button.className).toMatch(/focus-visible:ring-focus/);
    }
  });

  it("activates the focused theme button from the keyboard", async () => {
    const user = userEvent.setup();
    renderOpenSettings();

    const light = screen.getByRole("button", { name: "Light" });
    light.focus();
    await user.keyboard("{Enter}");

    expect(mocks.setTheme).toHaveBeenCalledWith("light");
    mocks.setTheme.mockClear();

    const dark = screen.getByRole("button", { name: "Dark" });
    dark.focus();
    await user.keyboard(" ");

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });
});
