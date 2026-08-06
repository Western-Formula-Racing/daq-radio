/** Spike benchmark for the Phase B replay rule engine.
 *
 * There is no real interpreter yet (userRule.ts does not exist). This inlines
 * a minimal evaluation loop that does the same per-frame work the real one
 * will: per rule, per condition, check the frame's message against the
 * condition's message, look up the signal in a decoded-frame map, compare
 * timestamps for staleness, call a comparator, then update hold/rearm state.
 * The goal is a representative cost, not a correct fault engine.
 *
 * Run directly: npx tsx src/lib/wcars/engine/bench.ts
 */

export type Op = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface Condition {
  message: string;
  signal: string;
  op: Op;
  value: number;
}

export interface BenchRule {
  id: string;
  conditions: Condition[];
  forMs: number;
  rearmMs: number;
}

export interface DecodedFrame {
  message: string;
  signals: Record<string, number>;
  ts: number;
}

// Matches the 5000 ms staleness window described for the real engine: a
// condition on a message that hasn't arrived recently should not fire on a
// stale last-known value.
const STALE_MS = 5000;

const MESSAGE_COUNT = 20;
const SIGNALS_PER_MESSAGE = 8;

function messageNames(): string[] {
  return Array.from({ length: MESSAGE_COUNT }, (_, i) => `MSG_${i.toString().padStart(2, "0")}`);
}

function signalNames(): string[] {
  return Array.from({ length: SIGNALS_PER_MESSAGE }, (_, i) => `SIG_${i}`);
}

// Deterministic PRNG so bench runs are reproducible across machines/CI.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate rules referencing a spread of messages/signals, not one hot key. */
export function generateRules(ruleCount: number, seed = 1): BenchRule[] {
  const rng = mulberry32(seed);
  const messages = messageNames();
  const signals = signalNames();
  const ops: Op[] = [">", ">=", "<", "<=", "==", "!="];

  const rules: BenchRule[] = [];
  for (let i = 0; i < ruleCount; i++) {
    const conditionCount = 1 + Math.floor(rng() * 4); // 1..4, ANDed
    const conditions: Condition[] = [];
    for (let c = 0; c < conditionCount; c++) {
      conditions.push({
        message: messages[Math.floor(rng() * messages.length)],
        signal: signals[Math.floor(rng() * signals.length)],
        op: ops[Math.floor(rng() * ops.length)],
        value: rng() * 200 - 50,
      });
    }
    rules.push({
      id: `rule-${i}`,
      conditions,
      forMs: 500 + Math.floor(rng() * 3000), // 0.5-3.5s hold, like for_seconds
      rearmMs: 2000 + Math.floor(rng() * 10000), // 2-12s rearm
    });
  }
  return rules;
}

function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case "==":
      return a === b;
    case "!=":
      return a !== b;
  }
}

/** One decoded frame per call, cycling message identity and signal values so
 * per-condition map lookups hit a realistic spread of keys, not one hot key. */
function makeFrameGenerator() {
  const messages = messageNames();
  const signals = signalNames();
  const rng = mulberry32(42);
  let i = 0;
  return function nextFrame(tsMs: number): DecodedFrame {
    const message = messages[i % messages.length];
    i++;
    // New object per frame mirrors decodeCanMessage's real allocation shape.
    const values: Record<string, number> = {};
    for (const s of signals) values[s] = rng() * 300;
    return { message, signals: values, ts: tsMs };
  };
}

function readMemoryBytes(): number | null {
  const perf = globalThis.performance as unknown as { memory?: { usedJSHeapSize: number } };
  if (perf && perf.memory && typeof perf.memory.usedJSHeapSize === "number") {
    return perf.memory.usedJSHeapSize;
  }
  // Node has no performance.memory; process.memoryUsage().heapUsed is the
  // nearest analog and is what this spike falls back to outside a browser.
  const proc = (globalThis as unknown as { process?: { memoryUsage?: () => { heapUsed: number } } }).process;
  if (proc && typeof proc.memoryUsage === "function") {
    return proc.memoryUsage().heapUsed;
  }
  return null;
}

function forceGcIfAvailable(): void {
  const g = (globalThis as unknown as { gc?: () => void }).gc;
  if (typeof g === "function") g();
}

export interface BenchResult {
  frameCount: number;
  ruleCount: number;
  wallTimeMs: number;
  heapBeforeBytes: number | null;
  heapAfterBytes: number | null;
  heapDeltaBytes: number | null;
  ruleFireCount: number;
}

/** Run frameCount decoded frames through ruleCount rules and time it. Does
 * the same per-frame work as the real engine will: message match, map
 * lookup per condition, staleness compare, comparator call, hold/rearm
 * state update per rule. No parsing, no decode — this isolates the rule
 * evaluation cost on top of already-decoded frames. */
export function benchReplay(frameCount: number, ruleCount: number): BenchResult {
  const rules = generateRules(ruleCount);
  const nextFrame = makeFrameGenerator();

  // Latest known decoded frame per message name, the same structure a real
  // engine needs so a rule can AND conditions across messages that don't
  // arrive on the same CAN frame.
  const latestByMessage = new Map<string, { signals: Record<string, number>; ts: number }>();

  // Parallel arrays instead of one state object per rule to avoid extra
  // indirection that the real engine likely wouldn't have either.
  const trueSince = new Float64Array(ruleCount).fill(-1);
  const active = new Uint8Array(ruleCount);
  const rearmAt = new Float64Array(ruleCount).fill(-1);
  let ruleFireCount = 0;

  forceGcIfAvailable();
  const heapBeforeBytes = readMemoryBytes();
  const t0 = performance.now();

  for (let f = 0; f < frameCount; f++) {
    const ts = f; // 1 ms/frame cadence is a reasonable stand-in for a CAN bus
    const frame = nextFrame(ts);
    latestByMessage.set(frame.message, { signals: frame.signals, ts: frame.ts });

    for (let r = 0; r < ruleCount; r++) {
      const rule = rules[r];
      let allTrue = true;
      for (let c = 0; c < rule.conditions.length; c++) {
        const cond = rule.conditions[c];
        const entry = latestByMessage.get(cond.message);
        if (!entry) {
          allTrue = false;
          break;
        }
        if (ts - entry.ts > STALE_MS) {
          allTrue = false;
          break;
        }
        const value = entry.signals[cond.signal];
        if (value === undefined || !compare(value, cond.op, cond.value)) {
          allTrue = false;
          break;
        }
      }

      if (allTrue) {
        if (trueSince[r] < 0) trueSince[r] = ts;
        if (!active[r] && ts - trueSince[r] >= rule.forMs && (rearmAt[r] < 0 || ts >= rearmAt[r])) {
          active[r] = 1;
          rearmAt[r] = ts + rule.rearmMs;
          ruleFireCount++;
        }
      } else {
        trueSince[r] = -1;
        if (active[r]) active[r] = 0;
      }
    }
  }

  const wallTimeMs = performance.now() - t0;
  const heapAfterBytes = readMemoryBytes();
  const heapDeltaBytes =
    heapBeforeBytes !== null && heapAfterBytes !== null ? heapAfterBytes - heapBeforeBytes : null;

  return { frameCount, ruleCount, wallTimeMs, heapBeforeBytes, heapAfterBytes, heapDeltaBytes, ruleFireCount };
}

function formatMb(bytes: number | null): string {
  if (bytes === null) return "n/a";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const frameCounts = [100_000, 500_000, 1_000_000];
  const ruleCounts = [1, 10, 40];

  console.log("frameCount\truleCount\twallTimeMs\theapDelta\truleFireCount");
  for (const frameCount of frameCounts) {
    for (const ruleCount of ruleCounts) {
      const result = benchReplay(frameCount, ruleCount);
      console.log(
        `${result.frameCount}\t${result.ruleCount}\t${result.wallTimeMs.toFixed(1)}\t${formatMb(
          result.heapDeltaBytes
        )}\t${result.ruleFireCount}`
      );
    }
  }
}

// Guarded so importing this module (e.g. from a future test) never runs the
// full 9-cell sweep as a side effect. Cast through globalThis, not a bare
// `process` reference, so this stays type-clean under the browser tsconfig
// (no @types/node in scope) while still running standalone under tsx/node.
const nodeProcess = (globalThis as unknown as { process?: { argv?: string[] } }).process;
const isMain =
  typeof nodeProcess?.argv?.[1] === "string" && import.meta.url === `file://${nodeProcess.argv[1]}`;

if (isMain) {
  main();
}
