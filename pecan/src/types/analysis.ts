export interface SeriesRequest {
  season: string;
  signals: string[];
  start: string; // ISO 8601 UTC
  end: string;
  target_points?: number;
}

export interface SignalSeries {
  mode: "raw" | "envelope";
  resolution_ms: number | null;
  point_count: number;
  t: number[]; // epoch ms
  v?: number[];
  min?: number[];
  max?: number[];
  avg?: number[];
}

export interface SeriesResponse {
  season: string;
  start: string;
  end: string;
  series: Record<string, SignalSeries>;
}

export interface SeasonEntry {
  name: string;
  year: number;
  table: string;
  color: string | null;
}

export interface RunEntry {
  key: string;
  start_utc: string;
  end_utc: string;
  start_local: string;
  end_local: string;
  timezone: string;
  row_count?: number;
  note?: string;
}

// One DBC CAN message and the signals under it that have data in the DB.
export interface SensorMessageGroup {
  name: string;
  subsystem: string;
  can_id: number;
  can_id_hex: string;
  signals: string[];
}

// Shape served by /api/sensors/grouped: DBC-categorised messages plus the
// DB sensors that have no DBC entry.
export interface GroupedSensors {
  messages: SensorMessageGroup[];
  ungrouped: string[];
}
