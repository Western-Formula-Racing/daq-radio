import type { RunEntry } from "../../types/analysis";

export function findSeasonWithData(
  runsBySeason: Record<string, RunEntry[]>,
  startMs: number,
  endMs: number,
): string | null {
  for (const [season, runs] of Object.entries(runsBySeason)) {
    const overlaps = runs.some((r) => {
      const rs = Date.parse(r.start_utc);
      const re = Date.parse(r.end_utc);
      return rs < endMs && re > startMs;
    });
    if (overlaps) return season;
  }
  return null;
}
