/** HTTP access to the OMT diagnostics service on the car.
 *
 * The base URL lives in localStorage rather than an environment variable
 * because the tablet that needs to reach the car cannot rebuild the app to
 * change an address. The build-time VITE_OMT_URL remains the default so
 * existing deployments keep working.
 */
import type { RuleDoc } from "../lib/wcars/engine/types";

export const OMT_URL_KEY = "pecan:omt:url";

export interface RawSignal {
  message: string;
  signal: string;
  unit: string | null;
  minimum: number | null;
  maximum: number | null;
  choices: Record<string, string> | null;
}

/** A failed OMT call, carrying enough for the page to say something useful.
 * status 0 means the request never reached the car. */
export class OmtError extends Error {
  status: number;
  messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages[0] ?? `OMT request failed with status ${status}`);
    this.name = "OmtError";
    this.status = status;
    this.messages = messages;
  }
}

function trim(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// localStorage is not a safe global to touch unconditionally: the replay worker
// (src/workers/replayWorker.ts) runs in a Web Worker where localStorage does not
// exist, and Safari in private browsing has historically thrown on access rather
// than returning null. Read and write both fall back to the build-time default
// and swallow storage errors so a car diagnostics call degrades instead of
// crashing the page that made it.
function readStoredUrl(): string | null {
  try {
    return localStorage.getItem(OMT_URL_KEY);
  } catch {
    return null;
  }
}

export function getOmtBaseUrl(): string {
  const stored = readStoredUrl();
  if (stored !== null) return trim(stored);
  const built = import.meta.env?.VITE_OMT_URL;
  return typeof built === "string" ? trim(built) : "";
}

export function setOmtBaseUrl(url: string): void {
  try {
    localStorage.setItem(OMT_URL_KEY, trim(url));
  } catch {
    // A rule builder that cannot remember an address is a degraded experience;
    // one that throws is a blank page. Nothing to do here but move on.
  }
}

/** FastAPI answers {"detail": ...} where detail is a string or a list. */
function messagesFrom(body: unknown, status: number): string[] {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (Array.isArray(detail)) return detail.map((d) => String(d));
  if (typeof detail === "string") return [detail];
  return [`OMT answered ${status}.`];
}

/** The base-URL check and try/catch around fetch, shared by every OMT call
 * regardless of how each one wants to read the response body. */
async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  const base = getOmtBaseUrl();
  if (!base) throw new OmtError(0, ["No OMT address is configured."]);
  try {
    return await fetch(`${base}${path}`, init);
  } catch (error) {
    // A car that is not on this network is the normal case at a track, so this
    // reports the situation rather than leaking a fetch error to the user.
    throw new OmtError(0, [
      `Could not reach OMT at ${base}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await rawRequest(path, init);
  if (response.status === 204) return null;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new OmtError(response.status, messagesFrom(body, response.status));
  return body;
}

function json(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export async function fetchSignals(): Promise<RawSignal[]> {
  const body = await request("/api/signals");
  const signals = (body as { signals?: unknown } | null)?.signals;
  return Array.isArray(signals) ? (signals as RawSignal[]) : [];
}

export async function fetchDbc(): Promise<{ text: string; sha256: string }> {
  const response = await rawRequest("/api/dbc");
  const text = await response.text();
  if (!response.ok) {
    // The body is still JSON on failure even though a success reads as plain DBC text.
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    throw new OmtError(response.status, messagesFrom(body, response.status));
  }
  return {
    text,
    sha256: response.headers.get("x-dbc-sha256") ?? "",
  };
}

export async function fetchRules(): Promise<RuleDoc[]> {
  const body = await request("/api/rules");
  const rules = (body as { rules?: unknown } | null)?.rules;
  return Array.isArray(rules) ? (rules as RuleDoc[]) : [];
}

export async function createRule(rule: RuleDoc, by: string): Promise<RuleDoc> {
  return await request("/api/rules", json({ rule, by })) as RuleDoc;
}

export async function updateRule(
  id: string, rule: RuleDoc, expectedRev: number, by: string,
): Promise<RuleDoc> {
  return await request(`/api/rules/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rule, expected_rev: expectedRev, by }),
  }) as RuleDoc;
}

export async function toggleRule(id: string): Promise<RuleDoc> {
  return await request(`/api/rules/${encodeURIComponent(id)}/toggle`, { method: "POST" }) as RuleDoc;
}

export async function deleteRule(id: string): Promise<void> {
  await request(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
}
