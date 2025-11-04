import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { WebSocketService } from '../WebSocketService';
import { dataStore } from '../../lib/DataStore';

const { mockCreateCanProcessor } = vi.hoisted(() => ({
  mockCreateCanProcessor: vi.fn(),
}));

vi.mock('../../utils/canProcessor', () => ({
  createCanProcessor: mockCreateCanProcessor,
}));

interface RecordedCanSample {
  time: number;
  canId: number;
  data: number[];
}

type DecodedMessage = {
  canId: number;
  messageName: string;
  time: number;
  rawData: string;
  signals: Record<string, { sensorReading: number; unit: string }>;
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  public readyState = MockWebSocket.CONNECTING;
  public onopen: ((event: { target: MockWebSocket }) => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((error: unknown) => void) | null = null;
  public onclose:
    | ((event: { code: number; reason?: string }) => void)
    | null = null;

  public closeEvents: Array<{ code: number; reason?: string }> = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({ target: this });
  }

  receive(payload: string) {
    this.onmessage?.({ data: payload });
  }

  triggerClose(event: { code: number; reason?: string }) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(event);
  }

  close(code = 1000, reason = '') {
    this.closeEvents.push({ code, reason });
    this.triggerClose({ code, reason });
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  send() {}
}

declare global {
  // eslint-disable-next-line no-var
  var WebSocket: typeof MockWebSocket;
}

globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

const projectRoot = path.resolve(process.cwd(), '../../..');
const csvPath = path.join(
  projectRoot,
  'car-simulate/2025-09-08-23-47-13.csv',
);

const recordedSamples: RecordedCanSample[] = readFileSync(csvPath, 'utf-8')
  .trim()
  .split(/\r?\n/)
  .slice(0, 5)
  .filter(Boolean)
  .map((line) => {
    const [timeStr, , canIdStr, ...byteStrs] = line.split(',');
    return {
      time: Number(timeStr),
      canId: Number(canIdStr),
      data: byteStrs.map((value) => Number(value)),
    };
  });

function createDecodedMessage(entry: RecordedCanSample): DecodedMessage {
  const signals = entry.data.reduce<Record<string, { sensorReading: number; unit: string }>>(
    (acc, value, index) => {
      acc[`byte${index}`] = {
        sensorReading: value,
        unit: 'raw',
      };
      return acc;
    },
    {},
  );

  return {
    canId: entry.canId,
    messageName: `CAN_${entry.canId}`,
    time: entry.time,
    rawData: entry.data.join(' '),
    signals,
  };
}

function createProcessorMock() {
  const processWebSocketMessage = vi.fn((payload: unknown) => {
    if (Array.isArray(payload)) {
      const decodedBatch = payload
        .map((item) => processWebSocketMessage(item) as DecodedMessage | null)
        .filter((item): item is DecodedMessage => item !== null);
      return decodedBatch.length > 0 ? decodedBatch : null;
    }

    if (payload && typeof payload === 'object') {
      const cast = payload as Partial<RecordedCanSample> & {
        id?: number;
        timestamp?: number;
      };
      const canId = cast.canId ?? cast.id;
      if (typeof canId !== 'number' || !Array.isArray(cast.data)) {
        return null;
      }

      const normalized: RecordedCanSample = {
        time: typeof cast.time === 'number' ? cast.time : cast.timestamp ?? Date.now(),
        canId,
        data: cast.data.map((value) => Number(value)),
      };

      return createDecodedMessage(normalized);
    }

    return null;
  });

  return { processWebSocketMessage };
}

function buildPayload(sample: RecordedCanSample) {
  return JSON.stringify({
    time: sample.time,
    canId: sample.canId,
    data: sample.data,
  });
}

beforeEach(() => {
  dataStore.clear();
  MockWebSocket.instances = [];
  mockCreateCanProcessor.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WebSocketService with recorded CAN samples', () => {
  it('ingests decoded messages derived from recorded CSV data', async () => {
    const processor = createProcessorMock();
    mockCreateCanProcessor.mockResolvedValueOnce(processor);

    const service = new WebSocketService();
    await service.initialize();

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];

    socket.triggerOpen();
    expect(service.isConnected()).toBe(true);

    const [firstSample, secondSample, thirdSample] = recordedSamples;

    socket.receive(buildPayload(firstSample));
    socket.receive(
      JSON.stringify([
        { time: secondSample.time, canId: secondSample.canId, data: secondSample.data },
        { time: thirdSample.time, id: thirdSample.canId, data: thirdSample.data },
      ]),
    );

    const latestFirst = dataStore.getLatest(String(firstSample.canId));
    expect(latestFirst?.data.byte0.sensorReading).toBe(firstSample.data[0]);
    expect(latestFirst?.rawData).toBe(firstSample.data.join(' '));

    const historySecond = dataStore.getHistory(String(secondSample.canId));
    expect(historySecond).toHaveLength(2);
    expect(historySecond[0].messageName).toBe(`CAN_${secondSample.canId}`);

    expect(processor.processWebSocketMessage).toHaveBeenCalledTimes(4);
  });

  it('retries connection with incremental backoff after unexpected closures', async () => {
    vi.useFakeTimers();

    const processor = createProcessorMock();
    mockCreateCanProcessor.mockResolvedValueOnce(processor);

    const service = new WebSocketService();
    await service.initialize();

    expect(MockWebSocket.instances).toHaveLength(1);
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.triggerOpen();

    firstSocket.triggerClose({ code: 4001 });
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.triggerOpen();
    expect(service.isConnected()).toBe(true);

    secondSocket.triggerClose({ code: 4002 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('closes the socket gracefully on disconnect requests', async () => {
    const processor = createProcessorMock();
    mockCreateCanProcessor.mockResolvedValueOnce(processor);

    const service = new WebSocketService();
    await service.initialize();

    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    service.disconnect();
    expect(socket.closeEvents).toContainEqual({ code: 1000, reason: 'Client disconnect' });
    expect(service.isConnected()).toBe(false);
  });
});
