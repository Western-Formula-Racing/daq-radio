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

/** Prefetch run indexes for every season so wrong-season empty hints can cross-check. */
export async function prefetchRunsBySeason(
  seasonNames: string[],
  fetchRunsFn: (season: string) => Promise<RunEntry[]>,
): Promise<Record<string, RunEntry[]>> {
  const pairs = await Promise.all(
    seasonNames.map(async (name) => [name, await fetchRunsFn(name)] as const),
  );
  return Object.fromEntries(pairs);
}
