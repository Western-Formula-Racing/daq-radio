export interface TelemetrySignal {
  sensorReading: number;
  unit: string;
  rawValue?: string;
}

export interface TelemetrySample {
  timestamp: number;
  data: Record<string, TelemetrySignal>;
  rawData: string;
  messageName?: string;
}

export interface IngestMessage {
  msgID: string;
  data: Record<string, { sensorReading: number; unit: string } | string> | Record<string, string>[];
  rawData: string;
  timestamp?: number;
  messageName?: string;
}

type Listener = () => void;

class DataStore {
  private buffers: Map<string, TelemetrySample[]> = new Map();
  private listeners: Set<Listener> = new Set();
  private retentionMs: number;

  constructor(retentionMs = 30000) {
    this.retentionMs = retentionMs;
  }

  public setRetentionMs(ms: number): void {
    if (ms <= 0 || !Number.isFinite(ms)) {
      throw new Error("Retention must be a positive finite number of milliseconds");
    }
    this.retentionMs = ms;
    this.pruneAll();
  }

  public ingestMessage({ msgID, data, rawData, timestamp, messageName }: IngestMessage): void {
    const normalizedData = this.normalizeData(data);
    const sampleTimestamp = typeof timestamp === "number" && Number.isFinite(timestamp)
      ? timestamp
      : Date.now();

    const sample: TelemetrySample = {
      timestamp: sampleTimestamp,
      data: normalizedData,
      rawData,
      messageName,
    };

    const buffer = this.buffers.get(msgID) ?? [];
    buffer.push(sample);
    this.buffers.set(msgID, buffer);

    this.pruneOldSamples(msgID);
    this.notify();
  }

  public getLatest(msgID: string): TelemetrySample | undefined {
    const buffer = this.buffers.get(msgID);
    if (!buffer || buffer.length === 0) return undefined;
    return buffer[buffer.length - 1];
  }

  public getHistory(msgID: string, windowMs: number): TelemetrySample[] {
    const buffer = this.buffers.get(msgID);
    if (!buffer || buffer.length === 0) return [];

    const now = Date.now();
    const cutoff = now - windowMs;

    let startIndex = 0;
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
      if (buffer[i].timestamp < cutoff) {
        startIndex = i + 1;
        break;
      }
    }

    return buffer.slice(startIndex);
  }

  public getSignal(msgID: string, signalName: string): (TelemetrySignal & { timestamp: number }) | undefined {
    const latest = this.getLatest(msgID);
    if (!latest) return undefined;
    const signal = latest.data[signalName];
    if (!signal) return undefined;
    return { ...signal, timestamp: latest.timestamp };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getMessageIds(): string[] {
    return Array.from(this.buffers.keys());
  }

  private normalizeData(
    data: Record<string, { sensorReading: number; unit: string } | string> | Record<string, string>[]
  ): Record<string, TelemetrySignal> {
    if (Array.isArray(data)) {
      return data.reduce<Record<string, TelemetrySignal>>((acc, entry) => {
        const [key, value] = Object.entries(entry)[0] ?? [];
        if (!key) return acc;
        if (typeof value !== "string") {
          return acc;
        }

        const parsed = this.parseSensorString(value);
        acc[key] = {
          sensorReading: parsed.sensorReading,
          unit: parsed.unit,
          rawValue: value,
        };
        return acc;
      }, {});
    }

    return Object.entries(data).reduce<Record<string, TelemetrySignal>>((acc, [key, value]) => {
      if (typeof value === "string") {
        const parsed = this.parseSensorString(value);
        acc[key] = {
          sensorReading: parsed.sensorReading,
          unit: parsed.unit,
          rawValue: value,
        };
      } else if (value && typeof value === "object") {
        const reading = Number(value.sensorReading);
        acc[key] = {
          sensorReading: Number.isFinite(reading) ? reading : NaN,
          unit: value.unit ?? "",
          rawValue: value.unit ? `${reading} ${value.unit}` : `${reading}`,
        };
      }
      return acc;
    }, {});
  }

  private parseSensorString(value: string): { sensorReading: number; unit: string } {
    const trimmed = value.trim();
    const match = trimmed.match(/^-?\d+(?:\.\d+)?/);
    if (!match) {
      return { sensorReading: NaN, unit: "" };
    }

    const sensorReading = Number(match[0]);
    const unit = trimmed.slice(match[0].length).trim();
    return { sensorReading, unit };
  }

  private pruneOldSamples(msgID: string): void {
    const buffer = this.buffers.get(msgID);
    if (!buffer || buffer.length === 0) return;

    const cutoff = Date.now() - this.retentionMs;
    let firstValidIndex = 0;
    while (firstValidIndex < buffer.length && buffer[firstValidIndex].timestamp < cutoff) {
      firstValidIndex += 1;
    }

    if (firstValidIndex > 0) {
      this.buffers.set(msgID, buffer.slice(firstValidIndex));
    }
  }

  private pruneAll(): void {
    Array.from(this.buffers.keys()).forEach((msgID) => this.pruneOldSamples(msgID));
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error("DataStore listener error", error);
      }
    });
  }
}

export const dataStore = new DataStore();

export type { DataStore };
