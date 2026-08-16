import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, AlertTriangle, FileJson, Settings as SettingsIcon, Activity, Info } from "lucide-react";
import TimelineBar from "../components/TimelineBar";
import ReplayImportClipModal from "../components/ReplayImportClipModal";
import FaultTrack from "../components/FaultTrack";
import FreezeFramePanel from "../components/FreezeFramePanel";
import type { FreezeSamples } from "../components/FreezeFramePanel";
import { parseReplayFile, REPLAY_FRAME_HARD_CAP } from "../utils/replayParser";
import { REPLAY_PARSED_EVENT } from "../types/replay";
import type { ReplayDecodeMetadata, ReplayFrame, ReplayParsedEventDetail, ReplayParseResult, ReplayPlotsMetadata, ReplayTimelineMetadata } from "../types/replay";
import { useTimeline } from "../context/TimelineContext";
import { getActiveDbcText, setActiveDbcText } from "../utils/canProcessor";
import { importRulesJson, loadRules } from "../utils/ruleSource";
import { runReplayInWorker } from "../utils/replayWorkerClient";
import {
  FREEZE_WINDOW_MS,
  freezeWindow,
  signalsForRules,
} from "../lib/wcars/engine/replayRunner";
import type { DecodeForRules, ReplayResult, ReplayWarning } from "../lib/wcars/engine/replayRunner";
import type { RuleDoc, Severity, WcarsAlert } from "../lib/wcars/engine/types";
import { createRuleDecoder } from "../utils/ruleDecode";

const SEVERITY_ROW_CLASS: Record<Severity, string> = {
  WARNING: "border-red-400/35 bg-red-500/10 text-red-100",
  CAUTION: "border-amber-400/35 bg-amber-500/10 text-amber-100",
  MEMO: "border-slate-400/30 bg-slate-500/10 text-slate-200",
};

/** Warning text a student can act on. The runner's own messages are accurate but
 * written for a log; these are written for someone standing at a car.
 */
function plainWarning(warning: ReplayWarning): string {
  switch (warning.code) {
    case "relative_time_only":
      return "This session carries no wall-clock time, so every fault time below is counted "
        + "from the start of the recording rather than from a clock.";
    case "no_frames_decoded":
      return "None of the frames in this session matched the DBC PECAN has loaded, so no rule "
        + "could be checked at all. Load the DBC for the car that recorded this session, then "
        + "run the analysis again.";
    case "backwards_jump":
      return `Time runs backwards ${warning.count ?? 1} time(s) in this file. The file was `
        + "replayed exactly as recorded, and rule timing starts over at each jump, so a fault "
        + "that needed to hold for several seconds may have been missed around those points.";
    default:
      return warning.message;
  }
}

/** Read a picked file as text. FileReader rather than Blob.text() because jsdom
 * still lacks the latter, and the rules import is covered by tests.
 */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsText(file);
  });
}

/** The wall-clock base the parser used, or 0 when the file carried none.
 *
 * The rule path is fed frames shifted by this base, so an alert timestamp is
 * directly comparable with the frame times shown everywhere else in the file.
 */
function epochBaseOf(frames: readonly ReplayFrame[]): number {
  const withEpoch = frames.find((frame) => typeof frame.tEpochMs === "number");
  if (!withEpoch || typeof withEpoch.tEpochMs !== "number") return 0;
  return withEpoch.tEpochMs - withEpoch.tRelMs;
}

/** The rule document id behind an alert.
 *
 * Both engines label a user rule's alerts "USER:<id>" so they cannot collide with
 * a built-in's id. Matching alert.rule against doc.id directly therefore never
 * hits, which used to send every freeze frame down the "show all rules" fallback.
 */
function ruleIdOf(alert: WcarsAlert): string {
  return alert.rule.startsWith("USER:") ? alert.rule.slice("USER:".length) : alert.rule;
}

/** How far past the fire moment to draw, stopping short of the next fault.
 *
 * Running to a full window regardless would let one fault's tail cover the
 * lead-up of the next one, which is the part that explains it.
 */
function postFireWindowMs(alert: WcarsAlert, alerts: readonly WcarsAlert[]): number {
  let next = Infinity;
  for (const other of alerts) {
    if (other.ts > alert.ts && other.ts < next) next = other.ts;
  }
  if (next === Infinity) return FREEZE_WINDOW_MS;
  return Math.max(0, Math.min(FREEZE_WINDOW_MS, next - alert.ts));
}

function ReplayViewer() {
  const { loadReplayFrames, clearReplaySession, replaySession, source, seek } = useTimeline();
  const [isParsing, setIsParsing] = useState(false);
  const [loadedFileName, setLoadedFileName] = useState<string>("");
  const [result, setResult] = useState<ReplayParseResult | null>(null);
  const [configImportMsg, setConfigImportMsg] = useState<string | null>(null);
  const [pendingClipImport, setPendingClipImport] = useState<{
    frames: ReplayFrame[];
    fileName: string;
    timelineMeta?: ReplayTimelineMetadata;
    plotsMeta?: ReplayPlotsMetadata;
    decodeMeta?: ReplayDecodeMetadata;
  } | null>(null);

  const [rules, setRules] = useState<RuleDoc[]>([]);
  const [ruleStatus, setRuleStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [faultResult, setFaultResult] = useState<ReplayResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | Severity>("ALL");
  const [selectedAlert, setSelectedAlert] = useState<WcarsAlert | null>(null);
  const [freezeSamples, setFreezeSamples] = useState<FreezeSamples>({});
  const [freezeAfterMs, setFreezeAfterMs] = useState(0);

  // The exact frames and base the last run used. Reading them back from state
  // would let a new import silently re-time alerts that came from the old one.
  const runFramesRef = useRef<ReplayFrame[]>([]);
  const runEpochBaseRef = useRef(0);
  const runDecoderRef = useRef<DecodeForRules | null>(null);

  const handleFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setLoadedFileName(file.name);

    try {
      const parseResult = await parseReplayFile(file);
      setResult(parseResult);
      if (parseResult.errors.length === 0 && parseResult.frames.length > 0) {
        if (parseResult.frames.length > REPLAY_FRAME_HARD_CAP) {
          setPendingClipImport({
            frames: parseResult.frames,
            fileName: file.name,
            timelineMeta: parseResult.sessionMeta?.timeline,
            plotsMeta: parseResult.sessionMeta?.plots,
            decodeMeta: parseResult.sessionMeta?.decode,
          });
        } else {
          await loadReplayFrames(
            parseResult.frames,
            file.name,
            parseResult.sessionMeta?.timeline,
            parseResult.sessionMeta?.plots,
            parseResult.sessionMeta?.decode
          );
        }
      }
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  };

  // The timeline owns a second file picker, and importing through it used to leave
  // this page's own state empty: fault analysis reported "import a replay file
  // first" against a session the user could see loaded. Both pickers land here.
  useEffect(() => {
    const onParsed = (event: Event) => {
      const detail = (event as CustomEvent<ReplayParsedEventDetail>).detail;
      if (!detail || !Array.isArray(detail.result?.frames)) return;
      setResult(detail.result);
      setLoadedFileName(detail.fileName ?? "");
    };
    window.addEventListener(REPLAY_PARSED_EVENT, onParsed);
    return () => window.removeEventListener(REPLAY_PARSED_EVENT, onParsed);
  }, []);

  const handleConfigOnlyPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setConfigImportMsg(null);
    try {
      const parseResult = await parseReplayFile(file);
      const meta = parseResult.sessionMeta;
      const layouts = meta?.plots?.layouts ?? [];
      const applied: string[] = [];

      if (layouts.length > 0) {
        const plotsForStorage = layouts
          .map((layout) => ({
            id: String(layout.id),
            signals: (layout.series ?? []).map((series) => ({
              msgID: series.msgId,
              signalName: series.signalName,
              messageName: `CAN_${series.msgId}`,
              unit: "",
            })),
          }))
          .filter((p) => p.signals.length > 0);
        if (plotsForStorage.length > 0) {
          localStorage.setItem("dash:plots", JSON.stringify(plotsForStorage));
          window.dispatchEvent(new CustomEvent("pecan:plots-imported", { detail: plotsForStorage }));
          applied.push(`${plotsForStorage.length} plot${plotsForStorage.length === 1 ? "" : "s"}`);
        }
      }

      const embedded = meta?.decode?.dbcEmbedded;
      if (embedded?.format === "dbc" && embedded.content) {
        setActiveDbcText(embedded.content);
        applied.push("DBC");
      }

      if (typeof meta?.timeline?.windowMs === "number") {
        applied.push(`window ${Math.round(meta.timeline.windowMs / 1000)}s`);
      }

      setConfigImportMsg(
        applied.length > 0
          ? `Config imported: ${applied.join(", ")}`
          : "No plot/DBC config found in file"
      );
    } catch (err) {
      setConfigImportMsg(`Config import failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleFetchRules = async () => {
    const loaded = await loadRules();
    setRules(loaded.rules);
    if (loaded.rules.length === 0) {
      setRuleStatus({
        text: loaded.error
          ?? "That OMT instance has no rules yet. Write one in OMT, or import a rules JSON file.",
        ok: false,
      });
      return;
    }
    setRuleStatus({
      text: `${loaded.rules.length} rule${loaded.rules.length === 1 ? "" : "s"} loaded from `
        + `${loaded.source === "file" ? "an imported file" : "OMT"}.`,
      ok: true,
    });
  };

  const handleRulesFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileText(file);
      const loaded = importRulesJson(text);
      setRules(loaded);
      setRuleStatus({
        text: `${loaded.length} rule${loaded.length === 1 ? "" : "s"} loaded from ${file.name}.`,
        ok: loaded.length > 0,
      });
    } catch (err) {
      setRules([]);
      setRuleStatus({
        text: err instanceof Error ? err.message : "That rules file could not be read.",
        ok: false,
      });
    } finally {
      event.target.value = "";
    }
  };

  // The run takes the parser's frames, never the timeline's: the timeline sorts
  // and re-bases them, which would answer a different question than "what would
  // the car have done with this data".
  const runFrames = useMemo<ReplayFrame[]>(() => result?.frames ?? [], [result]);

  const runBlockedReason = useMemo<string | null>(() => {
    if (rules.length === 0) {
      return "No rules are loaded yet, so there is nothing to check this session against. "
        + "Fetch the car's rules from OMT, or import a rules JSON file.";
    }
    if (runFrames.length === 0) {
      return "Import a replay file first. Fault analysis runs over the frames in the file you "
        + "loaded, not over live data.";
    }
    if (!getActiveDbcText()) {
      return "No DBC is loaded, so frames cannot be decoded into signals. Import a DBC and try "
        + "again.";
    }
    return null;
  }, [rules, runFrames]);

  const handleRunFaults = async () => {
    if (runBlockedReason !== null || isRunning) return;

    const dbcText = getActiveDbcText();
    const epochBase = epochBaseOf(runFrames);
    // Shifting here, rather than inside the runner, is what makes an alert
    // timestamp mean the same thing as a frame timestamp in this file.
    const framesForRun = epochBase === 0
      ? runFrames
      : runFrames.map((frame) => ({ ...frame, tRelMs: frame.tRelMs + epochBase }));

    setIsRunning(true);
    setRunError(null);
    setFaultResult(null);
    setSelectedAlert(null);
    setFreezeSamples({});
    setProgress({ done: 0, total: framesForRun.length });

    try {
      const handle = runReplayInWorker(
        framesForRun,
        rules,
        dbcText,
        (done, total) => setProgress({ done, total }),
      );
      const outcome = await handle.result;
      runFramesRef.current = framesForRun;
      runEpochBaseRef.current = epochBase;
      runDecoderRef.current = null;
      setFaultResult(outcome);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  };

  const formatFaultTime = useCallback((ts: number): string => (
    runEpochBaseRef.current > 0
      ? new Date(ts).toLocaleTimeString()
      : `${(ts / 1000).toFixed(3)} s`
  ), []);

  const handleSelectAlert = (alert: WcarsAlert) => {
    setSelectedAlert(alert);

    // The runner's timescale is the file's; the timeline's is re-based to its own
    // first frame. Seeking with alert.ts directly would clamp every fault on an
    // epoch-based file to the end of the session.
    if (replaySession) {
      seek(replaySession.startTimeMs + (alert.ts - runEpochBaseRef.current));
    }

    const rule = rules.find((doc) => doc.id === ruleIdOf(alert));
    // Falling back to every loaded rule would fill the panel with signals that
    // had nothing to do with this fault, so an unmatched rule shows nothing and
    // says so rather than showing the wrong thing confidently.
    const signals = signalsForRules(rule ? [rule] : []);
    const afterMs = postFireWindowMs(alert, faultResult?.alerts ?? []);
    setFreezeAfterMs(afterMs);
    try {
      if (runDecoderRef.current === null) {
        runDecoderRef.current = createRuleDecoder(getActiveDbcText());
      }
      setFreezeSamples(freezeWindow(
        runFramesRef.current, runDecoderRef.current, alert.ts, signals,
        FREEZE_WINDOW_MS, afterMs,
      ));
    } catch {
      // A freeze frame is a convenience; failing to build one must not take the
      // fault list down with it.
      setFreezeSamples({});
    }
  };

  const visibleAlerts = useMemo<WcarsAlert[]>(() => {
    const alerts = faultResult?.alerts ?? [];
    return severityFilter === "ALL"
      ? alerts
      : alerts.filter((alert) => alert.severity === severityFilter);
  }, [faultResult, severityFilter]);

  const faultTrackBounds = useMemo(() => {
    const frames = runFramesRef.current;
    if (frames.length === 0) return { startMs: 0, endMs: 0 };
    let min = Infinity;
    let max = -Infinity;
    for (const frame of frames) {
      if (frame.tRelMs < min) min = frame.tRelMs;
      if (frame.tRelMs > max) max = frame.tRelMs;
    }
    return { startMs: min, endMs: max };
  }, [faultResult]);

  const previewFrames = useMemo<ReplayFrame[]>(() => {
    if (result?.frames?.length) return result.frames.slice(0, 40);
    if (replaySession?.frames?.length) return replaySession.frames.slice(0, 40);
    return [];
  }, [result, replaySession]);

  const hasErrors = Boolean(result && result.errors.length > 0);

  return (
    <div className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto w-full max-w-[1200px] space-y-4">
        {pendingClipImport && (
          <ReplayImportClipModal
            frames={pendingClipImport.frames}
            fileName={pendingClipImport.fileName}
            onCancel={() => setPendingClipImport(null)}
            onConfirm={(framesToLoad) => {
              void loadReplayFrames(
                framesToLoad,
                pendingClipImport.fileName,
                pendingClipImport.timelineMeta,
                pendingClipImport.plotsMeta,
                pendingClipImport.decodeMeta
              );
              setPendingClipImport(null);
            }}
          />
        )}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="app-menu-title">REPLAY VIEWER</h1>
            <p className="mt-2 text-sm text-slate-400">
              Import .pecan, .json, or replay CSV files and validate them for deterministic timeline replay.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="trace-btn trace-btn-primary cursor-pointer" htmlFor="replay-upload-input">
              <Upload className="h-4 w-4" />
              {isParsing ? "Parsing..." : "Import Replay File"}
            </label>
            <input
              id="replay-upload-input"
              type="file"
              accept=".pecan,.json,.csv,.blf,text/csv,application/json"
              className="hidden"
              onChange={handleFilePick}
              disabled={isParsing}
            />
            <label
              className="trace-btn trace-btn-subtle cursor-pointer"
              htmlFor="replay-config-input"
              title="Apply plot layout, DBC, and window from a .pecan file without loading its frames"
            >
              <SettingsIcon className="h-4 w-4" />
              Import Config Only
            </label>
            <input
              id="replay-config-input"
              type="file"
              accept=".pecan,application/json"
              className="hidden"
              onChange={handleConfigOnlyPick}
            />
          </div>
        </header>

        <TimelineBar sticky={false} />

        <section className="rounded-lg border border-white/10 bg-data-module-bg p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-200">
            <FileJson className="h-4 w-4" />
            <h2 className="app-section-title">Import Status</h2>
          </div>

          {configImportMsg && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-emerald-400/35 bg-emerald-500/10 p-2 text-xs text-emerald-100">
              <span className="font-mono uppercase tracking-wide">{configImportMsg}</span>
              <button
                type="button"
                className="trace-btn trace-btn-subtle !text-[10px] !px-2 !py-1 ml-auto"
                onClick={() => setConfigImportMsg(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {replaySession && source === "replay" && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-cyan-400/35 bg-cyan-500/10 p-2 text-xs text-cyan-100">
              <span className="font-mono uppercase tracking-wide">
                Active replay: {replaySession.fileName}
              </span>
              <span className="font-mono uppercase tracking-wide">
                {replaySession.frameCount.toLocaleString()} frames
              </span>
              <button
                type="button"
                className="trace-btn trace-btn-subtle !text-[10px] !px-2 !py-1"
                onClick={clearReplaySession}
              >
                Unload Replay
              </button>
            </div>
          )}

          {!result && (
            <p className="text-sm text-slate-400">
              No file imported yet. Choose a replay file to parse and preview frame-level validation results.
            </p>
          )}

          {result && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-3 text-slate-300">
                <span className="rounded border border-white/20 bg-black/20 px-2 py-1 font-mono text-xs uppercase">
                  File: {loadedFileName || "unknown"}
                </span>
                <span className="rounded border border-white/20 bg-black/20 px-2 py-1 font-mono text-xs uppercase">
                  Frames: {result.frames.length.toLocaleString()}
                </span>
                <span className={`rounded border px-2 py-1 font-mono text-xs uppercase ${hasErrors ? "border-red-400/40 bg-red-500/15 text-red-200" : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"}`}>
                  {hasErrors ? "Invalid" : "Ready"}
                </span>
              </div>

              {result.warnings.length > 0 && (
                <div className="rounded border border-amber-400/35 bg-amber-500/10 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-200">Warnings</p>
                  <ul className="list-disc space-y-1 pl-5 text-amber-100">
                    {result.warnings.map((warning) => (
                      <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="rounded border border-red-400/35 bg-red-500/10 p-3">
                  <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-200">
                    <AlertTriangle className="h-4 w-4" />
                    Errors
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-red-100">
                    {result.errors.slice(0, 20).map((error, idx) => (
                      <li key={`${error.field ?? "global"}-${error.row ?? idx}-${error.message}`}>
                        {error.row ? `Row ${error.row}: ` : ""}
                        {error.field ? `${error.field} - ` : ""}
                        {error.message}
                      </li>
                    ))}
                  </ul>
                  {result.errors.length > 20 && (
                    <p className="mt-2 text-xs text-red-200/80">
                      Showing first 20 errors of {result.errors.length.toLocaleString()}.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-white/10 bg-data-module-bg p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-200">
            <Activity className="h-4 w-4" />
            <h2 className="app-section-title">Fault Analysis</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="trace-btn trace-btn-subtle"
              onClick={handleFetchRules}
            >
              Load Rules From OMT
            </button>
            <label className="trace-btn trace-btn-subtle cursor-pointer" htmlFor="replay-rules-input">
              Import Rules JSON
            </label>
            <input
              id="replay-rules-input"
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleRulesFilePick}
            />
            <button
              type="button"
              className="trace-btn trace-btn-primary"
              disabled={runBlockedReason !== null || isRunning}
              onClick={handleRunFaults}
            >
              {isRunning ? "Running..." : "Run Fault Analysis"}
            </button>
          </div>

          {ruleStatus && (
            <p
              data-testid="rule-source-status"
              className={`mt-2 text-xs ${ruleStatus.ok ? "text-emerald-200" : "text-amber-200"}`}
            >
              {ruleStatus.text}
            </p>
          )}

          {runBlockedReason && (
            <p data-testid="replay-run-explanation" className="mt-2 text-xs text-slate-400">
              {runBlockedReason}
            </p>
          )}

          {progress && (
            <p data-testid="replay-run-progress" className="mt-2 font-mono text-xs text-cyan-200">
              Analyzing {progress.done.toLocaleString()} of {progress.total.toLocaleString()} frames
            </p>
          )}

          {runError && (
            <div
              data-testid="replay-run-error"
              className="mt-3 rounded border border-red-400/35 bg-red-500/10 p-3 text-sm text-red-100"
            >
              <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-200">
                <AlertTriangle className="h-4 w-4" />
                Fault analysis failed
              </p>
              <p>{runError}</p>
              <p className="mt-1 text-xs text-red-200/80">
                Nothing was checked, so this is not the same as a session with no faults.
              </p>
            </div>
          )}

          {faultResult && (
            <div className="mt-3 space-y-3 text-sm">
              <p
                data-testid="replay-parity-notice"
                className="rounded border border-cyan-400/35 bg-cyan-500/10 p-3 text-xs text-cyan-100"
              >
                <Info className="mr-2 inline h-4 w-4 align-text-bottom" />
                Replay checks your team's own rules only. It does not evaluate the 14 built-in
                faults, which run on the car. A session with nothing listed here means none of
                your rules fired, not that the car was healthy.
              </p>

              {faultResult.warnings.length > 0 && (
                <div
                  data-testid="replay-fault-warnings"
                  className="rounded border border-amber-400/35 bg-amber-500/10 p-3"
                >
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
                    Read this before trusting the result
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-amber-100">
                    {faultResult.warnings.map((warning, idx) => (
                      <li key={`warning-${idx}`}>{plainWarning(warning)}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-slate-300">
                <span className="rounded border border-white/20 bg-black/20 px-2 py-1 font-mono text-xs uppercase">
                  Rules: {rules.length}
                </span>
                <span className="rounded border border-white/20 bg-black/20 px-2 py-1 font-mono text-xs uppercase">
                  Decoded: {faultResult.decodedFrameCount.toLocaleString()} / {faultResult.frameCount.toLocaleString()}
                </span>
                <span className="rounded border border-white/20 bg-black/20 px-2 py-1 font-mono text-xs uppercase">
                  Faults: {faultResult.alerts.length.toLocaleString()}
                </span>
                <label className="ml-auto flex items-center gap-2 font-mono text-xs uppercase text-slate-400">
                  Severity
                  <select
                    data-testid="fault-severity-filter"
                    className="rounded border border-white/20 bg-black/30 px-2 py-1 text-slate-200"
                    value={severityFilter}
                    onChange={(event) => setSeverityFilter(event.target.value as "ALL" | Severity)}
                  >
                    <option value="ALL">All</option>
                    <option value="WARNING">Warning</option>
                    <option value="CAUTION">Caution</option>
                    <option value="MEMO">Memo</option>
                  </select>
                </label>
              </div>

              <FaultTrack
                alerts={faultResult.alerts}
                startMs={faultTrackBounds.startMs}
                endMs={faultTrackBounds.endMs}
                selectedId={selectedAlert?.id ?? null}
                onSelect={handleSelectAlert}
                formatTime={formatFaultTime}
              />

              {faultResult.alerts.length === 0 ? (
                <p data-testid="replay-fault-empty" className="text-sm text-slate-400">
                  No rule fired anywhere in this session.
                </p>
              ) : (
                <ul className="space-y-1">
                  {visibleAlerts.map((alert) => (
                    <li key={alert.id}>
                      <button
                        type="button"
                        data-testid={`fault-alert-${alert.id}`}
                        onClick={() => handleSelectAlert(alert)}
                        className={`flex w-full flex-wrap items-center gap-3 rounded border px-2 py-1 text-left text-xs ${SEVERITY_ROW_CLASS[alert.severity]} ${
                          selectedAlert?.id === alert.id ? "ring-1 ring-white/50" : ""
                        }`}
                      >
                        <span className="font-mono">{formatFaultTime(alert.ts)}</span>
                        <span className="font-mono uppercase tracking-wide">{alert.severity}</span>
                        <span className="font-mono uppercase tracking-wide">{alert.title}</span>
                        <span className="text-slate-300">{alert.detail}</span>
                        {alert.value !== null && (
                          <span className="ml-auto font-mono">{alert.value}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {selectedAlert && (
          <FreezeFramePanel
            alert={selectedAlert}
            samples={freezeSamples}
            atTsMs={selectedAlert.ts}
            windowMs={FREEZE_WINDOW_MS}
            afterMs={freezeAfterMs}
            onClose={() => setSelectedAlert(null)}
            formatTime={formatFaultTime}
          />
        )}

        <section className="rounded-lg border border-white/10 bg-data-module-bg p-4">
          <h2 className="app-section-title mb-3">Frame Preview</h2>
          {previewFrames.length === 0 ? (
            <p className="text-sm text-slate-400">No valid frames to preview yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left font-mono text-xs text-slate-200">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="px-2 py-2">t_rel_ms</th>
                    <th className="px-2 py-2">can_id</th>
                    <th className="px-2 py-2">ext</th>
                    <th className="px-2 py-2">dir</th>
                    <th className="px-2 py-2">dlc</th>
                    <th className="px-2 py-2">data_hex</th>
                  </tr>
                </thead>
                <tbody>
                  {previewFrames.map((frame, idx) => (
                    <tr key={`${frame.canId}-${frame.tRelMs}-${idx}`} className="border-b border-white/5">
                      <td className="px-2 py-2">{frame.tRelMs}</td>
                      <td className="px-2 py-2">0x{frame.canId.toString(16).toUpperCase()}</td>
                      <td className="px-2 py-2">{frame.isExtended ? "1" : "0"}</td>
                      <td className="px-2 py-2 uppercase">{frame.direction}</td>
                      <td className="px-2 py-2">{frame.dlc}</td>
                      <td className="px-2 py-2 uppercase tracking-wide">{frame.dataHex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default ReplayViewer;
