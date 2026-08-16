/** Where replay gets the team's rules from.
 *
 * Two sources, because a track has no network: a reachable OMT instance on the
 * car, or a JSON file the student exported earlier and imports by hand. An
 * imported file wins, since importing one is an explicit act and reaching OMT
 * is not.
 *
 * Validation mirrors validate_rule_doc in src/wcars/user_rules.py for the checks
 * that do not need a DBC. Message and signal names cannot be checked here: the
 * browser has a DBC but not necessarily the one the rule was written against,
 * and rejecting a rule on that basis would be worse than letting it never fire.
 */
import type { Condition, Op, RuleDoc, Severity } from "../lib/wcars/engine/types";
import { MAX_CONDITIONS } from "../lib/wcars/engine/userRule";
import { getOmtBaseUrl } from "./omtClient";

const MAX_MESSAGE_LEN = 24;
const MAX_NAME_LEN = 64;
const SEVERITIES: Severity[] = ["WARNING", "CAUTION", "MEMO"];
const OPS: Op[] = [">", ">=", "<", "<=", "==", "!="];

export type RuleSourceKind = "omt" | "file" | "none";

export interface LoadedRules {
  rules: RuleDoc[];
  source: RuleSourceKind;
  /** Plain-language reason the OMT fetch did not happen or did not work. */
  error?: string;
}

let imported: RuleDoc[] | null = null;

/** Forget the imported file, so a student can go back to the car's own rules. */
export function clearImportedRules(): void {
  imported = null;
}

export function getImportedRules(): RuleDoc[] | null {
  return imported;
}

function omtBaseUrl(): string {
  return getOmtBaseUrl();
}

export async function loadRules(): Promise<LoadedRules> {
  if (imported !== null) return { rules: imported, source: "file" };

  const base = omtBaseUrl();
  if (!base) {
    return {
      rules: [],
      source: "none",
      error: "No OMT instance is configured. Import a rules JSON file to run a replay.",
    };
  }

  try {
    const response = await fetch(`${base}/api/rules`);
    if (!response.ok) {
      return {
        rules: [],
        source: "none",
        error: `OMT at ${base} answered ${response.status}.`,
      };
    }
    const body = await response.json();
    return { rules: parseRuleList(body), source: "omt" };
  } catch (error) {
    // A car that is not on this network is the normal case at a track, not a
    // bug, so this reports rather than throws.
    return {
      rules: [],
      source: "none",
      error: `Could not reach OMT at ${base}: `
        + `${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Parse and validate a rules file, remembering it for later loadRules calls.
 *
 * Throws with a message meant for a student staring at a laptop on a grid, not
 * a stack trace.
 */
export function importRulesJson(text: string): RuleDoc[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const rules = parseRuleList(parsed);
  imported = rules;
  return rules;
}

function parseRuleList(parsed: unknown): RuleDoc[] {
  // The OMT API answers {"rules": [...]}, while an exported file is usually the
  // bare array, so both are accepted rather than making the student unwrap one.
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(list)) {
    throw new Error("A rules file must contain an array of rule documents.");
  }
  return list.map((doc, i) => parseRuleDoc(doc, i));
}

function label(doc: Record<string, unknown>, index: number): string {
  const name = doc.name;
  if (typeof name === "string" && name.trim()) return `rule '${name}'`;
  const id = doc.id;
  if (typeof id === "string" && id.trim()) return `rule '${id}'`;
  return `rule ${index + 1}`;
}

function parseRuleDoc(raw: unknown, index: number): RuleDoc {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Rule ${index + 1} is not a JSON object.`);
  }
  const doc = raw as Record<string, unknown>;
  const where = label(doc, index);

  const name = doc.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`Rule ${index + 1} has no name.`);
  }
  if (name.length > MAX_NAME_LEN) {
    throw new Error(`${where} has a name longer than ${MAX_NAME_LEN} characters.`);
  }

  const message = doc.message;
  if (typeof message !== "string" || !message.trim()) {
    throw new Error(`${where} has no message.`);
  }
  if (message.length > MAX_MESSAGE_LEN) {
    throw new Error(
      `${where} has a message longer than ${MAX_MESSAGE_LEN} characters, which `
      + "does not fit the display.");
  }

  const severity = doc.severity;
  if (typeof severity !== "string" || !SEVERITIES.includes(severity as Severity)) {
    throw new Error(`${where} has severity '${String(severity)}'; it must be `
      + `${SEVERITIES.join(", ")}.`);
  }

  const conditions = doc.conditions;
  if (!Array.isArray(conditions)) {
    throw new Error(`${where} has no conditions.`);
  }
  if (conditions.length === 0) {
    throw new Error(`${where} needs at least one condition.`);
  }
  if (conditions.length > MAX_CONDITIONS) {
    throw new Error(`${where} has ${conditions.length} conditions; the limit is `
      + `${MAX_CONDITIONS}.`);
  }

  return {
    id: typeof doc.id === "string" && doc.id ? doc.id : `imported-${index + 1}`,
    name,
    // A file that omits enabled means an armed rule, matching the OMT form's
    // default; only an explicit false keeps a rule out of the replay.
    enabled: doc.enabled !== false,
    severity: severity as Severity,
    message,
    conditions: conditions.map((c, i) => parseCondition(c, i, where)),
    for_seconds: parseSeconds(doc.for_seconds, "for_seconds", where),
    rearm_seconds: parseSeconds(doc.rearm_seconds, "rearm_seconds", where),
  };
}

function parseSeconds(value: unknown, field: string, where: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${where} has ${field} of '${String(value)}'; it must be a `
      + "number of seconds, zero or more.");
  }
  return value;
}

function parseCondition(raw: unknown, i: number, where: string): Condition {
  const at = `condition ${i + 1} of ${where}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${at} is not a JSON object.`);
  }
  const cond = raw as Record<string, unknown>;
  if (typeof cond.message !== "string" || !cond.message.trim()
      || typeof cond.signal !== "string" || !cond.signal.trim()) {
    throw new Error(`${at} must name a CAN message and a signal.`);
  }
  if (typeof cond.op !== "string" || !OPS.includes(cond.op as Op)) {
    throw new Error(`${at} has op '${String(cond.op)}'; it must be one of `
      + `${OPS.join(" ")}.`);
  }
  const value = cond.value;
  if (typeof value === "string") {
    if (cond.op !== "==" && cond.op !== "!=") {
      throw new Error(`${at} compares text with '${cond.op}'; text values only `
        + "work with == or !=.");
    }
  } else if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${at} has no numeric or named value to compare against.`);
  }
  return {
    message: cond.message,
    signal: cond.signal,
    op: cond.op as Op,
    value: value as number | string,
  };
}
