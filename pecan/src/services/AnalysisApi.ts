import type {
  GroupedSensors,
  RunEntry,
  SeasonEntry,
  SeriesRequest,
  SeriesResponse,
} from "../types/analysis";

export const ANALYSIS_API_URL_KEY = "pecan:analysis-api-url";

// Existing data-downloader tunnel hostname (api.westernformularacing.org).
const PROD_API_URL = "https://api.westernformularacing.org";

export class AnalysisApiError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "AnalysisApiError";
    this.status = status;
  }
}

export function resolveApiBase(): string {
  const custom = localStorage.getItem(ANALYSIS_API_URL_KEY);
  if (custom) return custom.replace(/\/+$/, "");
  const env = import.meta.env.VITE_ANALYSIS_API_URL as string | undefined;
  if (env) return env.replace(/\/+$/, "");
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    // Local dev default; override via VITE_ANALYSIS_API_URL or the
    // localStorage key to point at the VPS over Tailscale
    // (http://100.72.11.60:8000) once /api/series is deployed there.
    return "http://localhost:8000";
  }
  return PROD_API_URL;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${resolveApiBase()}${path}`, init);
  } catch {
    throw new AnalysisApiError(
      "analysis API unreachable; check the API URL in Settings and your network",
      null,
    );
  }
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      // Read from a clone so the original body stays unlocked; callers (and
      // tests reusing a mocked Response) may read the same response again.
      const body = await resp.clone().json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new AnalysisApiError(detail, resp.status);
  }
  return (await resp.json()) as T;
}

export function fetchSeasons(): Promise<SeasonEntry[]> {
  return request("/api/seasons");
}

export async function fetchRuns(season: string): Promise<RunEntry[]> {
  const data = await request<{ runs?: RunEntry[] }>(
    `/api/runs?season=${encodeURIComponent(season)}`,
  );
  return data.runs ?? [];
}

export async function fetchSensorsGrouped(season: string): Promise<GroupedSensors> {
  // Backend returns messages/ungrouped at the top level (alongside
  // updated_at and dbc_source); normalise to a stable GroupedSensors.
  const data = await request<Partial<GroupedSensors>>(
    `/api/sensors/grouped?season=${encodeURIComponent(season)}`,
  );
  return { messages: data.messages ?? [], ungrouped: data.ungrouped ?? [] };
}

export function fetchSeries(req: SeriesRequest): Promise<SeriesResponse> {
  return request("/api/series", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
}
