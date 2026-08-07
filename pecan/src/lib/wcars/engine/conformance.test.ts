/** Runs the corpus shared with universal-telemetry-software/tests/test_conformance.py.
 *
 * Both runtimes read the same directory, so a rule that fires on the car but not in
 * replay turns this suite red instead of shipping silently. The corpus already carries
 * the decoded signals recorded by the Python decoder (see the `decoded` array in each
 * vector); this test feeds those directly to UserRule and never decodes a frame itself,
 * so it stays about rule semantics rather than about two DBC decoders agreeing.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UserRule } from "./userRule";
import type { DecodedFrame, RuleDoc, Severity } from "./types";

const VECTOR_DIR = path.resolve(
  __dirname, "../../../../../universal-telemetry-software/tests/conformance");

interface ExpectedAlert {
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  value: number | null;
  ts: number;
}

interface Vector {
  name: string;
  description: string;
  targets: string[];
  dbc: string;
  rules: RuleDoc[];
  frames: [number, number, string][];
  decoded: (DecodedFrame | null)[];
  expected_alerts: ExpectedAlert[];
}

// A directory that fails to resolve or a filter that swallows everything would leave
// `vectors` empty and every it.each below would silently run zero cases, so this count
// is asserted on its own rather than trusted implicitly.
const vectorFiles = fs.existsSync(VECTOR_DIR)
  ? fs.readdirSync(VECTOR_DIR).filter((f) => f.endsWith(".json")).sort()
  : [];

function loadVector(file: string): Vector {
  return JSON.parse(fs.readFileSync(path.join(VECTOR_DIR, file), "utf-8"));
}

// Mirrors _run() in test_conformance.py: fresh UserRule per rule doc, frames fed in
// file order, decoded[i] paired with frames[i][0] as the timestamp.
function runVector(vector: Vector): ExpectedAlert[] {
  const rules = vector.rules.map((d) => new UserRule(d));
  const produced: ExpectedAlert[] = [];
  vector.decoded.forEach((decoded, i) => {
    if (decoded === null) return;
    const [tsMs] = vector.frames[i];
    for (const rule of rules) {
      const alert = rule.update(decoded, tsMs);
      if (alert) {
        produced.push({
          rule: alert.rule, severity: alert.severity, title: alert.title,
          detail: alert.detail, value: alert.value, ts: alert.ts,
        });
      }
    }
  });
  return produced;
}

describe("conformance corpus", () => {
  it("finds the shared vectors", () => {
    expect(vectorFiles.length).toBeGreaterThan(0);
  });

  // it.each below reads vectorFiles directly from the directory rather than a hardcoded
  // count, so a vector added on the Python side and left ungenerated for the browser
  // suite is caught here by name, not silently skipped.
  it.each(vectorFiles)("%s reproduces in the browser engine", (file) => {
    const vector = loadVector(file);
    expect(vector.decoded.length).toBe(vector.frames.length);
    expect(runVector(vector)).toEqual(vector.expected_alerts);
  });
});
