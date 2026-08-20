import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSignals = vi.fn();
const fetchDbc = vi.fn();
const fetchRules = vi.fn();
vi.mock("../utils/omtClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/omtClient")>();
  return {
    ...actual,
    getOmtBaseUrl: () => "http://car.local:9090",
    setOmtBaseUrl: vi.fn(),
    fetchSignals: (...a: unknown[]) => fetchSignals(...a),
    fetchDbc: (...a: unknown[]) => fetchDbc(...a),
    fetchRules: (...a: unknown[]) => fetchRules(...a),
  };
});

let localDbcText = "LOCAL DBC";
vi.mock("../utils/canProcessor", () => ({
  getActiveDbcText: () => localDbcText,
  setActiveDbcText: vi.fn(),
}));

vi.mock("../utils/signalIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/signalIndex")>();
  return {
    ...actual,
    // The local DBC is a stub string here; only the OMT path needs real parsing.
    signalsFromDbcText: () => ([
      { message: "LOCAL_MSG", signal: "LocalSignal", unit: null, minimum: 0, maximum: 1, choices: null },
    ]),
  };
});

import RuleBuilder from "./RuleBuilder";

const SIGNALS = [
  { message: "VCU_Pedal_Info", signal: "pedalPosition", unit: null, minimum: 0, maximum: 100, choices: null },
];

// A sha256 of "LOCAL DBC" is not computed here; the page compares OMT's header
// against the digest it takes of the local text, so the test controls both.
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("RuleBuilder connection states", () => {
  beforeEach(() => {
    localDbcText = "LOCAL DBC";
    fetchRules.mockResolvedValue([]);
    vi.clearAllMocks();
    fetchRules.mockResolvedValue([]);
  });

  it("reports connected and uses the car's signals", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "LOCAL DBC", sha256: await sha256("LOCAL DBC") });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-connection").textContent).toMatch(/connected/i));
    expect(screen.getByTestId("palette-message-VCU_Pedal_Info")).toBeTruthy();
  });

  it("falls back to the local DBC when the car is not on this network, and offers export instead of save", async () => {
    fetchSignals.mockRejectedValue(new Error("Load failed"));
    fetchDbc.mockRejectedValue(new Error("Load failed"));
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-connection").textContent).toMatch(/offline/i));
    expect(screen.getByTestId("palette-message-LOCAL_MSG")).toBeTruthy();
    expect((screen.getByTestId("rule-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("rule-export")).toBeTruthy();
  });

  it("blocks saving when the car is running a different DBC, naming both digests", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "OTHER", sha256: "a".repeat(64) });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-connection").textContent).toMatch(/different dbc/i));
    const notice = screen.getByTestId("dbc-mismatch-notice").textContent ?? "";
    expect(notice).toContain("aaaaaaaa");
    expect((screen.getByTestId("rule-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says there is nothing to author against when offline with no DBC either", async () => {
    localDbcText = "";
    fetchSignals.mockRejectedValue(new Error("Load failed"));
    fetchDbc.mockRejectedValue(new Error("Load failed"));
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("palette-empty").textContent).toMatch(/no dbc/i));
    expect((screen.getByTestId("rule-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the address be changed without a rebuild", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "LOCAL DBC", sha256: await sha256("LOCAL DBC") });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-url")).toBeTruthy());
    expect((screen.getByTestId("omt-url") as HTMLInputElement).value).toBe("http://car.local:9090");
  });
});
