import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestMessage: vi.fn(),
  clear: vi.fn(),
  setSuppressIngestion: vi.fn(),
  decodeAndIngestCanFrame: vi.fn(),
  formatCanId: vi.fn((id: number) => `0x${id.toString(16).toUpperCase()}`),
}));

vi.mock("../lib/DataStore", () => ({
  dataStore: {
    ingestMessage: mocks.ingestMessage,
    clear: mocks.clear,
  },
}));

vi.mock("./WebSocketService", () => ({
  webSocketService: {
    setSuppressIngestion: mocks.setSuppressIngestion,
  },
}));

vi.mock("../utils/canProcessor", () => ({
  createCanProcessor: vi.fn(async () => ({ can: { mocked: true } })),
  decodeAndIngestCanFrame: mocks.decodeAndIngestCanFrame,
  formatCanId: mocks.formatCanId,
}));

import { SerialService } from "./SerialService";
import { THEME_REQUEST_EVENT } from "../theme/theme";

function collectThemeRequests() {
  const themes: string[] = [];
  const handler = (event: Event) => {
    themes.push((event as CustomEvent<{ theme: string }>).detail.theme);
  };
  window.addEventListener(THEME_REQUEST_EVENT, handler);
  return {
    themes,
    stop: () => window.removeEventListener(THEME_REQUEST_EVENT, handler),
  };
}

async function connectWithMockPort(overrides?: { failSetup?: boolean }) {
  const port = buildMockPort();
  if (overrides?.failSetup) {
    port.writable.getWriter = () => {
      throw new Error("setup failed");
    };
  }
  Object.defineProperty(globalThis.navigator, "serial", {
    value: {
      requestPort: vi.fn(async () => port),
      getPorts: vi.fn(async () => []),
    },
    configurable: true,
  });
  const service = new SerialService();
  const ok = await service.connect();
  return { service, port, ok };
}

function buildMockPort() {
  const write = vi.fn(async () => {});
  const releaseLock = vi.fn();
  return {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    readable: null,
    writable: {
      getWriter: () => ({
        write,
        releaseLock,
      }),
    },
    write,
  };
}

describe("SerialService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("alert", vi.fn());
    localStorage.clear();
  });

  it("returns false when Web Serial API is unavailable", async () => {
    Object.defineProperty(globalThis.navigator, "serial", {
      value: undefined,
      configurable: true,
    });

    const service = new SerialService();
    const ok = await service.connect();

    expect(ok).toBe(false);
  });

  it("connect initializes serial and suppresses websocket ingestion", async () => {
    const port = buildMockPort();
    Object.defineProperty(globalThis.navigator, "serial", {
      value: {
        requestPort: vi.fn(async () => port),
        getPorts: vi.fn(async () => []),
      },
      configurable: true,
    });

    const service = new SerialService();
    const ok = await service.connect();

    expect(ok).toBe(true);
    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(mocks.setSuppressIngestion).toHaveBeenCalledWith(true);
    expect(mocks.clear).toHaveBeenCalled();
    expect(port.write).toHaveBeenCalledTimes(3);
  });

  it("parses standard slcan frame and ingests decoded frame", async () => {
    const service = new SerialService() as any;
    await Promise.resolve();
    service.canInstance = { mocked: true };

    await service.parseSlcanMessage("t1232A1B2");
    await Promise.resolve();

    expect(mocks.decodeAndIngestCanFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        canId: 0x123,
        data: [0xa1, 0xb2],
      })
    );
  });

  it("falls back to raw ingest when decoder is unavailable", async () => {
    const service = new SerialService() as any;
    await Promise.resolve();
    service.canInstance = null;
    service.processorPromise = Promise.resolve(null);

    await service.ingestFrame(0x222, [0xaa, 0xbb]);

    expect(mocks.ingestMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgID: "0x222",
        rawData: "AA BB",
      })
    );
  });

  it("requests local-can after a successful connection", async () => {
    const requests = collectThemeRequests();
    const { ok } = await connectWithMockPort();
    requests.stop();

    expect(ok).toBe(true);
    expect(requests.themes).toEqual(["local-can"]);
  });

  it("requests psl on disconnect when that was the stored theme", async () => {
    localStorage.setItem("pecan:theme", "psl");
    const requests = collectThemeRequests();
    const { service, ok } = await connectWithMockPort();
    expect(ok).toBe(true);

    await service.disconnect();
    requests.stop();

    expect(requests.themes).toEqual(["local-can", "psl"]);
  });

  it("restores dark on disconnect when no theme is stored", async () => {
    const requests = collectThemeRequests();
    const { service, ok } = await connectWithMockPort();
    expect(ok).toBe(true);

    await service.disconnect();
    requests.stop();

    expect(requests.themes).toEqual(["local-can", "dark"]);
  });

  it("restores the previous theme and re-enables ingestion when setup fails after opening", async () => {
    localStorage.setItem("pecan:theme", "light");
    const requests = collectThemeRequests();
    const { ok, port } = await connectWithMockPort({ failSetup: true });
    requests.stop();

    expect(ok).toBe(false);
    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(requests.themes).toEqual(["local-can", "light"]);
    expect(mocks.setSuppressIngestion).toHaveBeenCalledWith(false);
  });
});
