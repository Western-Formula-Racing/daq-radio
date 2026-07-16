import type { SeriesResponse } from "../../types/analysis";

export const CLIENT_POINT_BUDGET = 1_000_000;
const DEFAULT_TARGET_POINTS = 4000;
const MAX_ENTRIES = 32;

// Cap per-signal resolution so the combined response stays inside the
// client heap budget no matter how many signals are selected.
export function targetPointsFor(signalCount: number): number {
  if (signalCount <= 0) return DEFAULT_TARGET_POINTS;
  return Math.min(
    DEFAULT_TARGET_POINTS,
    Math.floor(CLIENT_POINT_BUDGET / signalCount),
  );
}

export function cacheKey(
  season: string,
  signals: string[],
  startMs: number,
  endMs: number,
): string {
  const sigs = [...signals].sort().join(",");
  // Truncate to whole seconds: zoom jitter below 1 s should hit the cache
  const s = Math.floor(startMs / 1000);
  const e = Math.floor(endMs / 1000);
  return `${season}|${sigs}|${s}|${e}`;
}

export class SeriesCache {
  private map = new Map<string, SeriesResponse>();

  get(key: string): SeriesResponse | undefined {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      // Map preserves insertion order; re-insert to mark as recently used
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: SeriesResponse): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
}
