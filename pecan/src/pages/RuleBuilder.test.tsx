import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSignals = vi.fn();
const fetchDbc = vi.fn();
const fetchRules = vi.fn();
const createRule = vi.fn();
const updateRule = vi.fn();
const toggleRule = vi.fn();
const deleteRule = vi.fn();
vi.mock("../utils/omtClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/omtClient")>();
  return {
    ...actual,
    getOmtBaseUrl: () => "http://car.local:9090",
    setOmtBaseUrl: vi.fn(),
    fetchSignals: (...a: unknown[]) => fetchSignals(...a),
    fetchDbc: (...a: unknown[]) => fetchDbc(...a),
    fetchRules: (...a: unknown[]) => fetchRules(...a),
    createRule: (...a: unknown[]) => createRule(...a),
    updateRule: (...a: unknown[]) => updateRule(...a),
    toggleRule: (...a: unknown[]) => toggleRule(...a),
    deleteRule: (...a: unknown[]) => deleteRule(...a),
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

  it("hashes the car's own DBC when it sends no digest header, rather than reading silence as agreement", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "OTHER DBC", sha256: "" });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-connection").textContent).toMatch(/different dbc/i));
    expect((screen.getByTestId("rule-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("connects when the car sends no digest header but serves the same DBC", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "LOCAL DBC", sha256: "" });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-connection").textContent).toMatch(/connected/i));
  });

  it("blocks saving when the DBCs cannot be compared at all", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "LOCAL DBC", sha256: "b".repeat(64) });
    // What a plain-http origin looks like: crypto.subtle is not there to hash with.
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("subtle is undefined"));
    try {
      render(<RuleBuilder />);
      await waitFor(() => expect(screen.getByTestId("dbc-unverified-notice")).toBeTruthy());
      expect((screen.getByTestId("rule-save") as HTMLButtonElement).disabled).toBe(true);
      // The car is still reachable, so its catalog is still worth authoring against.
      expect(screen.getByTestId("palette-message-VCU_Pedal_Info")).toBeTruthy();
    } finally {
      digest.mockRestore();
    }
  });

  it("does not let a save ride on the previous address's verdict while a reconnect is in flight", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "LOCAL DBC", sha256: await sha256("LOCAL DBC") });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-connection").textContent).toMatch(/connected/i));

    let release: (value: unknown) => void = () => {};
    fetchSignals.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByTestId("omt-reconnect"));
    await waitFor(() => expect(screen.getByTestId("omt-connection").textContent).toMatch(/checking/i));
    expect((screen.getByTestId("rule-save") as HTMLButtonElement).disabled).toBe(true);
    release(SIGNALS);
  });

  it("lets the address be changed without a rebuild", async () => {
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "LOCAL DBC", sha256: await sha256("LOCAL DBC") });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("omt-url")).toBeTruthy());
    expect((screen.getByTestId("omt-url") as HTMLInputElement).value).toBe("http://car.local:9090");
  });
});

const STORED = {
  id: "r1", name: "Existing", enabled: true, severity: "WARNING", message: "EXIST",
  conditions: [{ message: "VCU_Pedal_Info", signal: "pedalPosition", op: ">", value: 10 }],
  for_seconds: 0, rearm_seconds: 0, rev: 2,
};

describe("saving", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localDbcText = "LOCAL DBC";
    fetchRules.mockResolvedValue([]);
    fetchSignals.mockResolvedValue(SIGNALS);
    fetchDbc.mockResolvedValue({ text: "LOCAL DBC", sha256: await sha256("LOCAL DBC") });
  });

  /** Builds a rule that passes client validation, so what these tests exercise
   * is the car's answer and not the local form's. */
  async function buildValidRule() {
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("palette-message-VCU_Pedal_Info")).toBeTruthy());
    fireEvent.click(screen.getByTestId("palette-message-VCU_Pedal_Info"));
    fireEvent.click(screen.getByTestId("palette-signal-VCU_Pedal_Info-pedalPosition"));
    fireEvent.click(screen.getByTestId("condition-empty-slot"));
    fireEvent.change(screen.getByTestId("rule-name"), { target: { value: "Pedal high" } });
    fireEvent.change(screen.getByTestId("rule-message"), { target: { value: "PEDAL HI" } });
    await waitFor(() =>
      expect((screen.getByTestId("rule-save") as HTMLButtonElement).disabled).toBe(false));
  }

  it("renders the car's own validation messages when it rejects a rule", async () => {
    const { OmtError } = await import("../utils/omtClient");
    createRule.mockRejectedValue(new OmtError(422, ["condition 1: message 'NOPE' not in DBC"]));
    await buildValidRule();
    fireEvent.click(screen.getByTestId("rule-save"));
    await waitFor(() => expect(screen.getByTestId("save-problems").textContent)
      .toContain("condition 1: message 'NOPE' not in DBC"));
  });

  it("says the rule was not stored when the car's card is not writable", async () => {
    const { OmtError } = await import("../utils/omtClient");
    createRule.mockRejectedValue(new OmtError(503, ["rule store at /data is not writable"]));
    await buildValidRule();
    fireEvent.click(screen.getByTestId("rule-save"));
    // A student must never be left believing an unarmed rule is armed.
    await waitFor(() => expect(screen.getByTestId("save-problems").textContent)
      .toMatch(/was not stored/i));
  });

  it("updates the rule it is editing at the rev it was opened at, rather than adding a second copy", async () => {
    fetchRules.mockResolvedValue([STORED]);
    updateRule.mockResolvedValue({ ...STORED, name: "Existing", rev: 3 });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("rule-edit-r1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("rule-edit-r1"));
    fireEvent.click(screen.getByTestId("rule-save"));
    await waitFor(() => expect(updateRule).toHaveBeenCalled());
    expect(createRule).not.toHaveBeenCalled();
    const [id, sent, rev] = updateRule.mock.calls[0];
    expect(id).toBe("r1");
    expect(rev).toBe(2);
    // The car owns the rev and its verdict; sending them back as rule fields
    // would have the tablet asserting things it does not decide.
    expect(sent).not.toHaveProperty("rev");
    expect(sent).not.toHaveProperty("broken");
    // The next save must carry the rev the car just minted, or it self-conflicts.
    await waitFor(() => expect(screen.getByTestId("editing-notice").textContent).toContain("rev 3"));
  });

  it("offers a reload rather than overwriting when someone else edited the rule", async () => {
    const { OmtError } = await import("../utils/omtClient");
    fetchRules.mockResolvedValue([STORED]);
    updateRule.mockRejectedValue(new OmtError(409, ["rule was edited by someone else"]));
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("rule-edit-r1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("rule-edit-r1"));
    fireEvent.click(screen.getByTestId("rule-save"));
    await waitFor(() => expect(screen.getByTestId("save-conflict")).toBeTruthy());
    expect(screen.getByTestId("save-conflict-reload")).toBeTruthy();

    fetchRules.mockResolvedValue([{ ...STORED, name: "Renamed by someone else", rev: 5 }]);
    fireEvent.click(screen.getByTestId("save-conflict-reload"));
    await waitFor(() =>
      expect((screen.getByTestId("rule-name") as HTMLInputElement).value)
        .toBe("Renamed by someone else"));
    expect(screen.getByTestId("editing-notice").textContent).toContain("rev 5");
  });

  it("arms and disarms by sending the state it wants, not an empty toggle", async () => {
    fetchRules.mockResolvedValue([STORED]);
    toggleRule.mockResolvedValue({ ...STORED, enabled: false, rev: 3 });
    render(<RuleBuilder />);
    await waitFor(() => expect(screen.getByTestId("rule-toggle-r1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("rule-toggle-r1"));
    await waitFor(() => expect(toggleRule).toHaveBeenCalled());
    expect(toggleRule.mock.calls[0][1]).toBe(false);
  });

  it("asks before deleting, and does not delete when the answer is no", async () => {
    fetchRules.mockResolvedValue([STORED]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<RuleBuilder />);
      await waitFor(() => expect(screen.getByTestId("rule-delete-r1")).toBeTruthy());
      fireEvent.click(screen.getByTestId("rule-delete-r1"));
      expect(confirm).toHaveBeenCalled();
      expect(deleteRule).not.toHaveBeenCalled();

      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByTestId("rule-delete-r1"));
      await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("r1"));
    } finally {
      confirm.mockRestore();
    }
  });
});
