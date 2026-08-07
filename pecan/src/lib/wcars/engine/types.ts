/** Shapes shared by the browser rule engine.
 *
 * Deliberately free of PECAN imports so this directory can be lifted into a
 * shared package as a plain file move. Field names match the Python rule
 * document exactly, so the same JSON loads unmodified in either runtime.
 */

export type Op = ">" | ">=" | "<" | "<=" | "==" | "!=";

export type Severity = "WARNING" | "CAUTION" | "MEMO";

export interface Condition {
  message: string;
  signal: string;
  op: Op;
  value: number | string;
}

export interface RuleDoc {
  id: string;
  name: string;
  enabled: boolean;
  severity: Severity;
  message: string;
  conditions: Condition[];
  for_seconds: number;
  rearm_seconds: number;
}

/** One decoded CAN frame. Enum signals arrive already unwrapped to their name,
 * matching the car-side decoder, so a condition compares against a plain string.
 */
export interface DecodedFrame {
  message: string;
  signals: Record<string, number | string>;
}

export interface WcarsAlert {
  id: string;
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  value: number | null;
  ts: number;
  replay: boolean;
}
