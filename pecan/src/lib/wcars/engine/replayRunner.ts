/** Drives the user-rule interpreter over a whole recorded session.
 *
 * Frames are fed in file order and never sorted. Reordering would answer a
 * different question than "what would the car have done with this data", so the
 * rule path deliberately shares no frames with PECAN's display path, which does
 * sort and re-base timestamps.
 *
 * Decoding is injected rather than imported so this directory keeps its promise
 * of no PECAN imports and stays unit-testable without a DBC.
 */
import { STALENESS_MS, UserRule } from "./userRule";
import type { DecodedFrame, RuleDoc, WcarsAlert } from "./types";

/** Frames as the parser produced them. Structurally a subset of PECAN's
 * ReplayFrame, so parseResult.frames can be passed straight in.
 */
export interface ReplayInputFrame {
  tRelMs: number;
  canId: number;
  dataHex: string;
  tEpochMs?: number;
}

export type DecodeForRules = (canId: number, dataHex: string) => DecodedFrame | null;

export type ReplayWarningCode =
  | "backwards_jump"
  | "relative_time_only"
  | "rule_error"
  | "no_frames_decoded";

export interface ReplayWarning {
  code: ReplayWarningCode;
  message: string;
  /** Rule document id, present only on rule_error. */
  ruleId?: string;
  /** How many times the condition was observed, present only on backwards_jump. */
  count?: number;
}

export interface ReplayResult {
  alerts: WcarsAlert[];
  warnings: ReplayWarning[];
  frameCount: number;
  decodedFrameCount: number;
  relativeTimeOnly: boolean;
}

export type ProgressCallback = (done: number, total: number) => void;

/** Frames between progress reports. Small enough that a worker's progress bar
 * moves smoothly on a million frames, large enough that postMessage is noise.
 */
export const PROGRESS_CHUNK = 10_000;

export const FREEZE_WINDOW_MS = 10_000;
export const FREEZE_MAX_HZ = 20;

/** Rejects a decoder whose signals are not plain scalars.
 *
 * PECAN's display decoder yields {sensorReading, unit} per signal. Passed
 * through unchanged every condition's numeric guard is false, so no rule ever
 * fires and the replay reports a clean session with nothing red on screen.
 * Failing loudly here is the only way that mistake is visible.
 */
function assertFlatSignals(decoded: DecodedFrame): void {
  for (const [name, value] of Object.entries(decoded.signals)) {
    if (typeof value === "number" || typeof value === "string") continue;
    throw new Error(
      `Decoder returned a non-scalar value for signal '${name}' of message `
      + `'${decoded.message}'. Rule evaluation needs a number or a string per `
      + "signal; PECAN's display decoder nests {sensorReading, unit} and would "
      + "make every rule silently dead.",
    );
  }
}

export function runReplay(
  frames: readonly ReplayInputFrame[],
  rules: readonly RuleDoc[],
  decode: DecodeForRules,
  onProgress?: ProgressCallback,
): ReplayResult {
  const warnings: ReplayWarning[] = [];
  const alerts: WcarsAlert[] = [];

  // Neither engine consults doc.enabled: Python filters in WcarsEngine, and the
  // TS UserRule does not look at it, so this is where a disabled rule is kept
  // out of a replay.
  const active = rules
    .filter((doc) => doc.enabled !== false)
    .map((doc) => ({ doc, rule: new UserRule(doc), failed: false }));

  const total = frames.length;
  let decodedFrameCount = 0;
  let backwardsJumps = 0;
  let firstJump: { from: number; to: number } | null = null;
  let previousTs: number | null = null;
  let epochSeen = false;
  const shapeChecked = new Set<string>();

  for (let i = 0; i < total; i += 1) {
    const frame = frames[i];
    const tsMs = frame.tRelMs;
    if (frame.tEpochMs !== undefined && Number.isFinite(frame.tEpochMs)) epochSeen = true;

    // Reported, never repaired: the interpreter treats a jump this large as a
    // new source and wipes its timing state, so the alerts after it are not
    // continuous with the ones before, and the student needs to know that.
    if (previousTs !== null && previousTs - tsMs > STALENESS_MS) {
      backwardsJumps += 1;
      if (firstJump === null) firstJump = { from: previousTs, to: tsMs };
    }
    previousTs = tsMs;

    const decoded = decode(frame.canId, frame.dataHex);
    if (decoded !== null) {
      decodedFrameCount += 1;
      if (!shapeChecked.has(decoded.message)) {
        shapeChecked.add(decoded.message);
        assertFlatSignals(decoded);
      }
      for (const entry of active) {
        if (entry.failed) continue;
        try {
          const alert = entry.rule.update(decoded, tsMs);
          if (alert) alerts.push(alert);
        } catch (error) {
          // One broken rule must not cost the student the whole run, and a rule
          // that threw once will throw on every frame, so it is retired here
          // rather than reported a million times.
          entry.failed = true;
          warnings.push({
            code: "rule_error",
            ruleId: entry.doc.id,
            message: `Rule '${entry.doc.name}' failed and was skipped for the rest `
              + `of the run: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    if ((i + 1) % PROGRESS_CHUNK === 0) onProgress?.(i + 1, total);
  }

  onProgress?.(total, total);

  if (firstJump !== null) {
    warnings.push({
      code: "backwards_jump",
      count: backwardsJumps,
      message: `Frame time jumps backwards ${backwardsJumps} time(s), first from `
        + `${firstJump.from} ms to ${firstJump.to} ms. The file was replayed as `
        + "recorded; rule timing restarts at each jump.",
    });
  }

  if (!epochSeen) {
    warnings.push({
      code: "relative_time_only",
      message: "This session carries no wall-clock base, so fault times are "
        + "milliseconds from the start of the recording.",
    });
  }

  if (total > 0 && decodedFrameCount === 0) {
    warnings.push({
      code: "no_frames_decoded",
      message: "No frame in this session matched the loaded DBC, so no rule could "
        + "be evaluated. Check that the DBC matches the car that recorded it.",
    });
  }

  return {
    alerts,
    warnings,
    frameCount: total,
    decodedFrameCount,
    relativeTimeOnly: !epochSeen,
  };
}

/** Samples for the given signals in the window ending at atTsMs.
 *
 * The car keeps a rolling buffer because it cannot hold a test day in memory.
 * The browser already has every frame, so nothing is buffered during the run
 * and the window is queried after the fact, once, when a fault is selected.
 */
export function freezeWindow(
  frames: readonly ReplayInputFrame[],
  decode: DecodeForRules,
  atTsMs: number,
  signals: readonly string[],
  windowMs: number = FREEZE_WINDOW_MS,
): Record<string, [number, number | string][]> {
  const wanted = new Set(signals);
  if (wanted.size === 0) return {};
  const from = atTsMs - windowMs;
  const collected = new Map<string, [number, number | string][]>();

  for (const frame of frames) {
    const tsMs = frame.tRelMs;
    if (tsMs < from || tsMs > atTsMs) continue;
    const decoded = decode(frame.canId, frame.dataHex);
    if (decoded === null) continue;
    for (const name of Object.keys(decoded.signals)) {
      if (!wanted.has(name)) continue;
      const value = decoded.signals[name];
      if (typeof value !== "number" && typeof value !== "string") continue;
      let series = collected.get(name);
      if (series === undefined) collected.set(name, series = []);
      series.push([tsMs, value]);
    }
  }

  // Sorting is safe here in a way it is not on the rule path: this feeds a
  // sparkline, which needs time order, and no rule decision depends on it.
  const minGapMs = 1000 / FREEZE_MAX_HZ;
  const out: Record<string, [number, number | string][]> = {};
  for (const [name, series] of collected) {
    series.sort((a, b) => a[0] - b[0]);
    const kept: [number, number | string][] = [];
    let lastBucket: number | null = null;
    for (const sample of series) {
      const bucket = Math.floor(sample[0] / minGapMs);
      // Newest wins inside a bucket so the sample nearest the fire moment lives.
      if (bucket === lastBucket) kept[kept.length - 1] = sample;
      else { kept.push(sample); lastBucket = bucket; }
    }
    out[name] = kept;
  }
  return out;
}

/** Every signal the given rules read, so a freeze frame covers what fired one. */
export function signalsForRules(rules: readonly RuleDoc[]): string[] {
  const names = new Set<string>();
  for (const doc of rules) {
    for (const cond of doc.conditions ?? []) {
      if (typeof cond?.signal === "string") names.add(cond.signal);
    }
  }
  return [...names];
}
