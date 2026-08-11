/** Covers the replay fault-analysis UI: rule loading, the run action, the alert
 * list, the timescale mapping from an alert to the timeline cursor, freeze
 * frames, plain-language warnings, and the parity notice.
 *
 * The timeline, the parser, the worker client and the rule source are mocked so
 * the assertions are about this page and not about the machinery underneath it,
 * which has its own suites.
 */
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ReplayResult } from "../lib/wcars/engine/replayRunner";
import type { RuleDoc, WcarsAlert } from "../lib/wcars/engine/types";
import type { ReplayFrame, ReplayParseResult } from "../types/replay";
import type { LoadedRules } from "../utils/ruleSource";

const seek = vi.fn();
let replaySession: { fileName: string; frameCount: number; startTimeMs: number; endTimeMs: number } | null = null;

vi.mock("../context/TimelineContext", () => ({
  useTimeline: () => ({
    loadReplayFrames: vi.fn(async () => {}),
    clearReplaySession: vi.fn(),
    replaySession,
    source: "replay",
    seek,
  }),
}));

vi.mock("../components/TimelineBar", () => ({ default: () => <div data-testid="timeline-bar" /> }));

let parseResult: ReplayParseResult;
vi.mock("../utils/replayParser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/replayParser")>();
  return { ...actual, parseReplayFile: vi.fn(async () => parseResult) };
});

let loadRulesResult: LoadedRules;
let importedRules: RuleDoc[] = [];
let importThrows: string | null = null;
vi.mock("../utils/ruleSource", () => ({
  loadRules: vi.fn(async () => loadRulesResult),
  importRulesJson: vi.fn(() => {
    if (importThrows) throw new Error(importThrows);
    return importedRules;
  }),
  clearImportedRules: vi.fn(),
}));

type RunArgs = Parameters<typeof import("../utils/replayWorkerClient").runReplayInWorker>;
let runImpl: (...args: RunArgs) => { result: Promise<ReplayResult>; cancel: () => void };
const runReplayInWorker = vi.fn((...args: RunArgs) => runImpl(...args));
vi.mock("../utils/replayWorkerClient", () => ({
  runReplayInWorker: (...args: RunArgs) => runReplayInWorker(...args),
}));

vi.mock("../utils/canProcessor", () => ({
  getActiveDbcText: () => "DBC TEXT",
  setActiveDbcText: vi.fn(),
}));

// A stand-in decoder so freezeWindow has something to chart without a real DBC.
vi.mock("../utils/ruleDecode", () => ({
  createRuleDecoder: () => (canId: number, dataHex: string) => (
    canId === 0x100
      ? { message: "M", signals: { Speed: parseInt(dataHex, 16), Gear: dataHex === "10" ? "DRIVE" : "NEUTRAL" } }
      : null
  ),
}));

import ReplayViewer from "./ReplayViewer";

const RULE: RuleDoc = {
  id: "r1",
  name: "Brake pressure low",
  enabled: true,
  severity: "WARNING",
  message: "BRK PRESS LO",
  conditions: [{ message: "M", signal: "Speed", op: ">", value: 5 }],
  for_seconds: 0,
  rearm_seconds: 0,
};

const MEMO_RULE: RuleDoc = { ...RULE, id: "r2", name: "Gear note", severity: "MEMO", message: "GEAR NOTE" };

function frames(epochBaseMs: number): ReplayFrame[] {
  return [0, 1000, 2000].map((tRelMs) => ({
    tRelMs,
    canId: 0x100,
    isExtended: false,
    direction: "rx" as const,
    dlc: 1,
    dataHex: tRelMs === 1000 ? "10" : "20",
    tEpochMs: epochBaseMs ? epochBaseMs + tRelMs : undefined,
  }));
}

function parseResultWith(epochBaseMs: number): ReplayParseResult {
  return {
    frames: frames(epochBaseMs),
    errors: [],
    warnings: [],
    rowCount: 3,
  } as unknown as ReplayParseResult;
}

function alertAt(ts: number, over: Partial<WcarsAlert> = {}): WcarsAlert {
  return {
    id: "a1",
    rule: "r1",
    severity: "WARNING",
    title: "BRK PRESS LO",
    detail: "Brake pressure low",
    value: 16,
    ts,
    replay: false,
    ...over,
  };
}

function runResult(over: Partial<ReplayResult> = {}): ReplayResult {
  return {
    alerts: [],
    warnings: [],
    frameCount: 3,
    decodedFrameCount: 3,
    relativeTimeOnly: false,
    ...over,
  };
}

function resolveWith(result: ReplayResult) {
  runImpl = () => ({ result: Promise.resolve(result), cancel: () => {} });
}

async function importReplayFile() {
  const input = document.getElementById("replay-upload-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "session.csv")] } });
  await screen.findByText(/Frames:/);
}

async function loadRulesFromOmt() {
  fireEvent.click(screen.getByRole("button", { name: /load rules from omt/i }));
  await screen.findByTestId("rule-source-status");
}

async function runAnalysis() {
  fireEvent.click(screen.getByRole("button", { name: /run fault analysis/i }));
  await screen.findByTestId("replay-parity-notice");
}

describe("ReplayViewer fault analysis", () => {
  beforeEach(() => {
    seek.mockClear();
    runReplayInWorker.mockClear();
    replaySession = { fileName: "session.csv", frameCount: 3, startTimeMs: 500_000, endTimeMs: 502_000 };
    parseResult = parseResultWith(0);
    loadRulesResult = { rules: [RULE, MEMO_RULE], source: "omt" };
    importedRules = [RULE];
    importThrows = null;
    resolveWith(runResult());
  });

  it("disables the run action with a plain explanation when no rules are loaded", async () => {
    render(<ReplayViewer />);
    await importReplayFile();

    const button = screen.getByRole("button", { name: /run fault analysis/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const why = screen.getByTestId("replay-run-explanation").textContent ?? "";
    expect(why.toLowerCase()).toContain("no rules");
    expect(why).toMatch(/import/i);
  });

  it("disables the run action when rules are loaded but no session is imported", async () => {
    render(<ReplayViewer />);
    await loadRulesFromOmt();

    expect((screen.getByRole("button", { name: /run fault analysis/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("replay-run-explanation").textContent ?? "").toMatch(/replay file/i);
  });

  it("reports which source the rules came from and how many loaded", async () => {
    render(<ReplayViewer />);
    await loadRulesFromOmt();

    const status = screen.getByTestId("rule-source-status").textContent ?? "";
    expect(status).toMatch(/2 rules/i);
    expect(status).toMatch(/OMT/i);
  });

  it("explains in words when OMT cannot be reached", async () => {
    loadRulesResult = { rules: [], source: "none", error: "Could not reach OMT at http://car.local." };
    render(<ReplayViewer />);
    await loadRulesFromOmt();

    expect(screen.getByTestId("rule-source-status").textContent ?? "")
      .toContain("Could not reach OMT at http://car.local.");
    expect((screen.getByRole("button", { name: /run fault analysis/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("loads rules from an imported JSON file", async () => {
    render(<ReplayViewer />);
    const input = document.getElementById("replay-rules-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["[]"], "rules.json")] } });

    await waitFor(() => {
      expect(screen.getByTestId("rule-source-status").textContent ?? "").toMatch(/1 rule/i);
    });
    expect(screen.getByTestId("rule-source-status").textContent ?? "").toMatch(/rules\.json/i);
  });

  it("renders a rejected rules file as an explanation, not a crash", async () => {
    importThrows = "That file is not valid JSON.";
    render(<ReplayViewer />);
    const input = document.getElementById("replay-rules-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["nope"], "rules.json")] } });

    await waitFor(() => {
      expect(screen.getByTestId("rule-source-status").textContent ?? "")
        .toContain("That file is not valid JSON.");
    });
  });

  it("shows a progress readout while the run is in flight", async () => {
    let report: ((done: number, total: number) => void) | undefined;
    let finish: (result: ReplayResult) => void = () => {};
    runImpl = (_frames, _rules, _dbc, onProgress) => {
      report = onProgress;
      return { result: new Promise<ReplayResult>((resolve) => { finish = resolve; }), cancel: () => {} };
    };

    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    fireEvent.click(screen.getByRole("button", { name: /run fault analysis/i }));

    act(() => report?.(1, 3));
    await waitFor(() => {
      expect(screen.getByTestId("replay-run-progress").textContent ?? "").toMatch(/1.*3/);
    });

    finish(runResult());
    await screen.findByTestId("replay-parity-notice");
    expect(screen.queryByTestId("replay-run-progress")).toBeNull();
  });

  it("renders one row per alert", async () => {
    resolveWith(runResult({
      alerts: [alertAt(1000), alertAt(2000, { id: "a2", rule: "r2", severity: "MEMO", title: "GEAR NOTE" })],
    }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    expect(screen.getAllByTestId(/^fault-alert-/)).toHaveLength(2);
    expect(screen.getByTestId("fault-alert-a1").textContent).toContain("BRK PRESS LO");
    expect(screen.getByTestId("fault-alert-a2").textContent).toContain("GEAR NOTE");
  });

  it("filters the alert list by severity", async () => {
    resolveWith(runResult({
      alerts: [alertAt(1000), alertAt(2000, { id: "a2", rule: "r2", severity: "MEMO", title: "GEAR NOTE" })],
    }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    fireEvent.change(screen.getByTestId("fault-severity-filter"), { target: { value: "MEMO" } });
    const rows = screen.getAllByTestId(/^fault-alert-/);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("GEAR NOTE");
  });

  it("seeks the timeline to the alert on a session with no wall-clock base", async () => {
    resolveWith(runResult({ alerts: [alertAt(1000)] }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    fireEvent.click(screen.getByTestId("fault-alert-a1"));
    // Relative file: the runner ran on unshifted frames, so alert.ts is already
    // an offset from the start of the recording.
    expect(seek).toHaveBeenCalledWith(501_000);
  });

  it("seeks correctly on an epoch-based session, not to the end of the window", async () => {
    const epochBaseMs = 1_700_000_000_000;
    parseResult = parseResultWith(epochBaseMs);
    resolveWith(runResult({ alerts: [alertAt(epochBaseMs + 1000)] }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    // The frames handed to the runner carry the epoch base, so its alert times
    // are wall clock and have to be brought back before they mean anything to
    // the re-based display timescale.
    const handed = runReplayInWorker.mock.calls[0][0];
    expect(handed[0].tRelMs).toBe(epochBaseMs);

    fireEvent.click(screen.getByTestId("fault-alert-a1"));
    expect(seek).toHaveBeenCalledWith(501_000);
  });

  it("opens the freeze frame for the clicked alert", async () => {
    resolveWith(runResult({ alerts: [alertAt(1000)] }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    expect(screen.queryByTestId("freeze-frame-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("fault-alert-a1"));

    const panel = await screen.findByTestId("freeze-frame-panel");
    expect(panel.textContent).toContain("Speed");
    expect(within(panel).getByTestId("freeze-signal-Speed")).toBeTruthy();
  });

  it("draws a string-valued signal as labeled steps rather than a sparkline", async () => {
    const textRule: RuleDoc = {
      ...RULE,
      id: "r3",
      name: "Gear check",
      severity: "CAUTION",
      conditions: [{ message: "M", signal: "Gear", op: "==", value: "DRIVE" }],
    };
    loadRulesResult = { rules: [textRule], source: "omt" };
    resolveWith(runResult({ alerts: [alertAt(1000, { rule: "r3", severity: "CAUTION" })] }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    fireEvent.click(screen.getByTestId("fault-alert-a1"));
    const chart = await screen.findByTestId("freeze-signal-Gear");
    expect(chart.textContent).toContain("DRIVE");
    expect(chart.querySelector("svg path")).toBeTruthy();
    expect(chart.querySelector("svg polyline")).toBeNull();
  });

  it("renders warnings as plain language, not raw codes", async () => {
    resolveWith(runResult({
      relativeTimeOnly: true,
      warnings: [
        { code: "relative_time_only", message: "This session carries no wall-clock base." },
        { code: "no_frames_decoded", message: "No frame in this session matched the loaded DBC." },
      ],
    }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    const banner = screen.getByTestId("replay-fault-warnings");
    expect(banner.textContent).not.toContain("relative_time_only");
    expect(banner.textContent).not.toContain("no_frames_decoded");
    expect(banner.textContent).toMatch(/from the start of the recording/i);
    expect(banner.textContent).toMatch(/DBC/);
  });

  it("always shows the built-in-fault parity notice with results and offers no way to dismiss it", async () => {
    resolveWith(runResult({ alerts: [alertAt(1000)] }));
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    const notice = screen.getByTestId("replay-parity-notice");
    expect(notice.textContent).toMatch(/your team's own rules/i);
    expect(notice.textContent).toMatch(/14 built-in/i);
    expect(notice.textContent).toMatch(/does not/i);
    expect(within(notice).queryByRole("button")).toBeNull();
  });

  it("keeps the parity notice on a run that found nothing", async () => {
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    await runAnalysis();

    expect(screen.getByTestId("replay-parity-notice")).toBeTruthy();
    expect(screen.getByTestId("replay-fault-empty").textContent ?? "").toMatch(/no rule fired/i);
    expect(screen.queryByTestId("replay-run-error")).toBeNull();
  });

  it("renders the error when a run throws, instead of an empty list", async () => {
    runImpl = () => ({
      result: Promise.reject(new Error("Decoder returned a non-scalar value")),
      cancel: () => {},
    });
    render(<ReplayViewer />);
    await importReplayFile();
    await loadRulesFromOmt();
    fireEvent.click(screen.getByRole("button", { name: /run fault analysis/i }));

    const error = await screen.findByTestId("replay-run-error");
    expect(error.textContent).toContain("Decoder returned a non-scalar value");
    // A failed run is not a clean session, so neither the empty-result line nor
    // the parity notice may make it look like one.
    expect(screen.queryByTestId("replay-fault-empty")).toBeNull();
    expect(screen.queryByTestId("replay-parity-notice")).toBeNull();
  });
});
