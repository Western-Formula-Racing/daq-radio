/** Client-side mirror of validate_rule_doc in src/wcars/user_rules.py.
 *
 * This exists for immediate feedback while typing. The car stays authoritative:
 * on save, its 422 messages are shown verbatim and win over anything decided
 * here. Because that makes two implementations of one rule set, the verdicts are
 * pinned against each other by the corpus in
 * universal-telemetry-software/tests/rule_validation.
 */
import { MAX_CONDITIONS } from "../lib/wcars/engine/userRule";
import type { Op, Severity } from "../lib/wcars/engine/types";
import { findSignal } from "./signalIndex";
import type { SignalIndex } from "./signalIndex";

const MAX_NAME_LEN = 64;
const MAX_MESSAGE_LEN = 24;
const SEVERITIES: Severity[] = ["WARNING", "CAUTION", "MEMO"];
const OPS: Op[] = [">", ">=", "<", "<=", "==", "!="];
const EQUALITY_OPS: Op[] = ["==", "!="];

export interface RuleProblem {
  /** Dotted path to the offending field, for example conditions.0.value. */
  path: string;
  message: string;
}

export function validateRuleDoc(doc: unknown, index: SignalIndex | null): RuleProblem[] {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return [{ path: "", message: "A rule must be a JSON object." }];
  }
  const rule = doc as Record<string, unknown>;
  const problems: RuleProblem[] = [];

  const name = rule.name;
  if (typeof name !== "string" || !name.trim()) {
    problems.push({ path: "name", message: "Give this rule a name." });
  } else if (name.length > MAX_NAME_LEN) {
    problems.push({ path: "name", message: `The name must be ${MAX_NAME_LEN} characters or fewer.` });
  }

  const message = rule.message;
  if (typeof message !== "string" || !message.trim()) {
    problems.push({ path: "message", message: "Give this rule a display message." });
  } else if (message.length > MAX_MESSAGE_LEN) {
    problems.push({
      path: "message",
      message: `The message must be ${MAX_MESSAGE_LEN} characters or fewer so it fits the display line.`,
    });
  }

  if (!SEVERITIES.includes(rule.severity as Severity)) {
    problems.push({ path: "severity", message: `Severity must be ${SEVERITIES.join(", ")}.` });
  }
  if (typeof rule.enabled !== "boolean") {
    problems.push({ path: "enabled", message: "Enabled must be true or false." });
  }
  for (const field of ["for_seconds", "rearm_seconds"] as const) {
    const value = rule[field];
    // Known deliberate divergence: the car accepts NaN here because NaN < 0 is
    // false, while Number.isFinite rejects it. Being stricter is the safe
    // direction, since it can only warn about a rule the car would have taken,
    // never bless one the car would refuse.
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      problems.push({ path: field, message: "Must be a number of seconds, zero or more." });
    }
  }

  const conditions = rule.conditions;
  if (!Array.isArray(conditions) || conditions.length < 1 || conditions.length > MAX_CONDITIONS) {
    problems.push({
      path: "conditions",
      message: `A rule needs 1 to ${MAX_CONDITIONS} conditions.`,
    });
    return problems;
  }
  conditions.forEach((cond, i) => problems.push(...validateCondition(cond, i, index)));
  return problems;
}

function validateCondition(raw: unknown, i: number, index: SignalIndex | null): RuleProblem[] {
  const at = (field: string) => `conditions.${i}.${field}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [{ path: `conditions.${i}`, message: "This condition is not filled in." }];
  }
  const cond = raw as Record<string, unknown>;
  const problems: RuleProblem[] = [];

  const message = cond.message;
  const signal = cond.signal;
  if (typeof message !== "string" || !message || typeof signal !== "string" || !signal) {
    return [{ path: at("signal"), message: "Choose a signal for this condition." }];
  }
  if (!OPS.includes(cond.op as Op)) {
    problems.push({ path: at("op"), message: `The comparison must be one of ${OPS.join(" ")}.` });
  }

  // Offline the browser has a DBC but not necessarily the car's, so an
  // unconfirmable name is left to the car rather than blocking a valid rule.
  const info = index === null ? null : findSignal(index, message, signal);
  if (index !== null && info === null) {
    problems.push({
      path: at("signal"),
      message: `${message}.${signal} is not in the DBC this car is running.`,
    });
    return problems;
  }

  const value = cond.value;
  const choices = info?.choices ?? null;
  if (typeof value === "string") {
    if (!EQUALITY_OPS.includes(cond.op as Op)) {
      problems.push({
        path: at("op"),
        message: "A named value can only be compared with == or !=.",
      });
    }
    // With no index there is no VAL_ table to judge the text against, so the
    // car gets the last word here just as it does for the name above.
    if (info !== null && choices === null) {
      // The car rejects any text value on a signal with no VAL_ table, because
      // its choices set is empty and nothing can be in it. Accepting it here
      // would tell someone their rule is fine when the car will refuse it.
      problems.push({
        path: at("value"),
        message: `${signal} reports a number, so compare it with a number rather than text.`,
      });
    } else if (choices !== null && !choices.includes(value)) {
      problems.push({
        path: at("value"),
        message: `${signal} has no named value '${value}'. Choose one of: ${choices.join(", ")}.`,
      });
    }
  } else if (typeof value !== "number" || !Number.isFinite(value)) {
    problems.push({ path: at("value"), message: "Enter a number to compare against." });
  } else if (choices !== null) {
    problems.push({
      path: at("value"),
      message: `${signal} reports named values, so a number can never match. `
        + `Choose one of: ${choices.join(", ")}.`,
    });
  }
  return problems;
}
