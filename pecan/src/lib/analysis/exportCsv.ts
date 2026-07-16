import type { SignalSeries } from "../../types/analysis";

export function seriesToCsv(seriesBySignal: Record<string, SignalSeries>): string {
  const columns: { header: string; data: Map<number, number> }[] = [];
  for (const [sig, s] of Object.entries(seriesBySignal)) {
    if (s.mode === "raw") {
      columns.push({
        header: sig,
        data: new Map(s.t.map((ms, i) => [ms, (s.v ?? [])[i]])),
      });
    } else {
      columns.push({
        header: `${sig}_avg`,
        data: new Map(s.t.map((ms, i) => [ms, (s.avg ?? [])[i]])),
      });
      columns.push({
        header: `${sig}_min`,
        data: new Map(s.t.map((ms, i) => [ms, (s.min ?? [])[i]])),
      });
      columns.push({
        header: `${sig}_max`,
        data: new Map(s.t.map((ms, i) => [ms, (s.max ?? [])[i]])),
      });
    }
  }
  const allTimes = [...new Set(columns.flatMap((c) => [...c.data.keys()]))].sort(
    (a, b) => a - b,
  );
  const header = ["time_utc", ...columns.map((c) => c.header)].join(",");
  const rows = allTimes.map((ms) => {
    const cells = columns.map((c) => {
      const v = c.data.get(ms);
      return v === undefined ? "" : String(v);
    });
    return [new Date(ms).toISOString(), ...cells].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

export function exportCsv(
  seriesBySignal: Record<string, SignalSeries>,
  filename: string,
): void {
  const blob = new Blob([seriesToCsv(seriesBySignal)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
