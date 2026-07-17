import { useCallback, useState } from "react";

import { PLOT_AREA_MARGIN } from "../analysis/plot-traces";
import {
  faultNamesAt,
  formatDuration,
  padRange,
  segmentBox,
  severityFor,
} from "../analysis/state-timeline";
import type { StatesResponse } from "../types";

// Lane labels live inside the plots' left axis gutter and tracks stop at the
// plots' right margin, so timeline segments line up with the plot time axis.
const LANE_LABEL_STYLE = { width: `${PLOT_AREA_MARGIN.left}px` } as const;
const TRACK_STYLE = { marginRight: `${PLOT_AREA_MARGIN.right}px` } as const;

const COLLAPSE_KEY = "analysis-timeline-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

export interface AnalysisStateTimelineProps {
  data: StatesResponse | null;
  loading: boolean;
  error: string | null;
  viewRange: [number, number];
  onSelectRange: (startMs: number, endMs: number) => void;
  onRetry: () => void;
}

export function AnalysisStateTimeline({
  data,
  loading,
  error,
  viewRange,
  onSelectRange,
  onRetry,
}: AnalysisStateTimelineProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Persistence is best-effort only.
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (startMs: number, endMs: number) => {
      const [paddedStart, paddedEnd] = padRange(startMs, endMs);
      onSelectRange(paddedStart, paddedEnd);
    },
    [onSelectRange],
  );

  const isEmpty =
    data != null && data.faults.length === 0 && data.lanes.every((l) => l.segments.length === 0);

  return (
    <section className="analysis-timeline card" data-testid="analysis-timeline">
      <button
        type="button"
        className="analysis-timeline-header"
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        <span className={`analysis-timeline-chevron${collapsed ? " collapsed" : ""}`}>▾</span>
        State timeline
      </button>
      {!collapsed && (
        <div className="analysis-timeline-body">
          {error && (
            <div className="analysis-timeline-error" role="alert">
              <span>Could not load state timeline: {error}</span>
              <button type="button" className="button secondary" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}
          {!error && loading && !data && (
            <div className="analysis-timeline-skeleton" role="status">
              Loading states…
            </div>
          )}
          {!error && isEmpty && (
            <div className="analysis-timeline-empty" role="status">
              No state data in this window.
            </div>
          )}
          {!error && data && !isEmpty && (
            <>
              {data.lanes.map((lane) => (
                <div className="analysis-timeline-lane" key={lane.id}>
                  <span className="analysis-timeline-label" style={LANE_LABEL_STYLE}>
                    {lane.label}
                  </span>
                  <div className="analysis-timeline-track" style={TRACK_STYLE}>
                    {lane.segments.map((seg) => {
                      const box = segmentBox(seg.start_ms, seg.end_ms, viewRange);
                      if (!box) return null;
                      const title = `${lane.label}: ${seg.label}\n${formatTime(seg.start_ms)} - ${formatTime(seg.end_ms)} (${formatDuration(seg.end_ms - seg.start_ms)})`;
                      return (
                        <button
                          key={`${seg.start_ms}-${seg.value}`}
                          type="button"
                          className={`analysis-timeline-segment severity-${severityFor(lane.id, seg.value)}`}
                          style={{ left: `${box.leftPct}%`, width: `${box.widthPct}%` }}
                          title={title}
                          aria-label={`${lane.label} ${seg.label}`}
                          onClick={() => handleSelect(seg.start_ms, seg.end_ms)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="analysis-timeline-lane">
                <span className="analysis-timeline-label" style={LANE_LABEL_STYLE}>
                  Faults
                </span>
                <div className="analysis-timeline-track" style={TRACK_STYLE}>
                  {data.faults.flatMap((fault) =>
                    fault.segments.map((seg) => {
                      const box = segmentBox(seg.start_ms, seg.end_ms, viewRange);
                      if (!box) return null;
                      const active = faultNamesAt(data, seg.start_ms, seg.end_ms).join(", ");
                      const title = `${active}\n${formatTime(seg.start_ms)} - ${formatTime(seg.end_ms)} (${formatDuration(seg.end_ms - seg.start_ms)})`;
                      return (
                        <button
                          key={`${fault.source}-${fault.name}-${seg.start_ms}`}
                          type="button"
                          className="analysis-timeline-segment severity-fault"
                          style={{ left: `${box.leftPct}%`, width: `${box.widthPct}%` }}
                          title={title}
                          aria-label={`Fault ${fault.name}`}
                          onClick={() => handleSelect(seg.start_ms, seg.end_ms)}
                        />
                      );
                    }),
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
