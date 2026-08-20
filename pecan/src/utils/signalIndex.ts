/** The catalog of signals a rule may reference.
 *
 * Two sources produce one shape: OMT's /api/signals when the car is reachable,
 * and PECAN's loaded DBC when it is not. Authoring offline must behave exactly
 * like authoring online, because offline is precisely when nobody can check.
 */
import { Dbc } from "candied";

import type { RawSignal } from "./omtClient";

export interface SignalInfo {
  message: string;
  signal: string;
  unit: string | null;
  minimum: number | null;
  maximum: number | null;
  /** Named values in DBC order, or null for a plain numeric signal. */
  choices: string[] | null;
}

export interface SignalIndex {
  all: SignalInfo[];
  byKey: Map<string, SignalInfo>;
}

// Message and signal names come from a DBC and cannot contain a NUL, so this
// joins them without collisions, matching userRule.ts's identical key helper.
const key = (message: string, signal: string) => `${message}\u0000${signal}`;

export function buildIndex(signals: RawSignal[]): SignalIndex {
  const all: SignalInfo[] = signals.map((raw) => ({
    message: raw.message,
    signal: raw.signal,
    unit: raw.unit ?? null,
    minimum: typeof raw.minimum === "number" ? raw.minimum : null,
    maximum: typeof raw.maximum === "number" ? raw.maximum : null,
    // ConditionSlots, ConditionEditor, and ruleValidate all read "choices ===
    // null" as the definition of "not an enum." An empty choices object would
    // survive Object.values as [], letting the three drift apart: conditionFor
    // would build a numeric condition, ruleValidate would reject it on the
    // spot, and the editor would render a <select> with no options. Folding
    // {} to null here keeps [] from ever existing, so all three agree.
    choices: raw.choices && Object.keys(raw.choices).length > 0
      ? Object.values(raw.choices).map(String)
      : null,
  }));
  const byKey = new Map<string, SignalInfo>();
  for (const info of all) byKey.set(key(info.message, info.signal), info);
  return { all, byKey };
}

export function findSignal(index: SignalIndex, message: string, signal: string): SignalInfo | null {
  return index.byKey.get(key(message, signal)) ?? null;
}

export function searchSignals(index: SignalIndex, query: string): SignalInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return index.all;
  return index.all.filter((s) => s.signal.toLowerCase().includes(needle)
    || s.message.toLowerCase().includes(needle));
}

export function groupByMessage(list: SignalInfo[]): { message: string; signals: SignalInfo[] }[] {
  const groups = new Map<string, SignalInfo[]>();
  for (const info of list) {
    let bucket = groups.get(info.message);
    if (bucket === undefined) groups.set(info.message, bucket = []);
    bucket.push(info);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([message, signals]) => ({ message, signals }));
}

export function signalsFromDbcText(dbcText: string): RawSignal[] {
  const db = new Dbc().load(dbcText);
  const out: RawSignal[] = [];
  db.messages.forEach((msg) => {
    msg.signals.forEach((sig) => {
      const table = sig.valueTable;
      const choices = table && table.size > 0
        ? Object.fromEntries([...table.entries()].map(([k, v]) => [String(k), String(v)]))
        : null;
      out.push({
        message: msg.name,
        signal: sig.name,
        unit: sig.unit || null,
        minimum: typeof sig.min === "number" ? sig.min : null,
        maximum: typeof sig.max === "number" ? sig.max : null,
        choices,
      });
    });
  });
  return out;
}
