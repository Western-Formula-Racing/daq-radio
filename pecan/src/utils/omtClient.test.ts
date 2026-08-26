import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OMT_URL_KEY, OmtError, getOmtBaseUrl, setOmtBaseUrl, fetchSignals, fetchDbc, createRule, updateRule, toggleRule } from "./omtClient";

describe("the OMT base URL", () => {
  beforeEach(() => localStorage.clear());

  it("is empty when nothing is configured", () => {
    expect(getOmtBaseUrl()).toBe("");
  });

  it("remembers what the user set, so a track-side iPad needs no rebuild", () => {
    setOmtBaseUrl("http://10.71.1.10:9090");
    expect(getOmtBaseUrl()).toBe("http://10.71.1.10:9090");
    expect(localStorage.getItem(OMT_URL_KEY)).toBe("http://10.71.1.10:9090");
  });

  it("strips a trailing slash so paths do not double up", () => {
    setOmtBaseUrl("http://car.local:9090/");
    expect(getOmtBaseUrl()).toBe("http://car.local:9090");
  });

  it("clears back to unconfigured on an empty string", () => {
    setOmtBaseUrl("http://car.local:9090");
    setOmtBaseUrl("   ");
    expect(getOmtBaseUrl()).toBe("");
  });
});

describe("the OMT base URL without a usable localStorage", () => {
  // Undo the stub so later suites get the real (or polyfilled) localStorage back.
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to the build-time default instead of throwing, as in a Web Worker", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => getOmtBaseUrl()).not.toThrow();
  });

  it("does not throw on write when storage is unavailable, as in a Web Worker", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => setOmtBaseUrl("http://car.local:9090")).not.toThrow();
  });

  it("does not throw when localStorage.setItem itself throws, as in Safari private browsing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(() => setOmtBaseUrl("http://car.local:9090")).not.toThrow();
  });
});

describe("OMT requests", () => {
  beforeEach(() => {
    localStorage.clear();
    setOmtBaseUrl("http://car.local:9090");
  });

  it("unwraps the signals envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ signals: [{ message: "M", signal: "S", unit: "C", minimum: 0, maximum: 1, choices: null }] }),
      { status: 200 })));
    const signals = await fetchSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0].signal).toBe("S");
  });

  it("raises the server's own validation messages, not a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: ["condition 1: message 'NOPE' not in DBC"] }), { status: 422 })));
    await expect(createRule({ name: "x" } as never, "tester")).rejects.toMatchObject({
      status: 422,
      messages: ["condition 1: message 'NOPE' not in DBC"],
    });
  });

  it("sends the armed state it was asked for, since the car applies the body rather than flipping", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "r1", enabled: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await toggleRule("r1", true, "pecan");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ enabled: true, by: "pecan" });
  });

  it("reports a conflict distinctly so the page can offer a reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: "rule was edited by someone else" }), { status: 409 })));
    await expect(updateRule("r1", {} as never, 3, "tester")).rejects.toBeInstanceOf(OmtError);
    await expect(updateRule("r1", {} as never, 3, "tester")).rejects.toMatchObject({ status: 409 });
  });

  it("says the car is not reachable rather than surfacing a fetch stack trace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Load failed"); }));
    await expect(fetchSignals()).rejects.toMatchObject({ status: 0 });
  });

  it("carries the server's own explanation when the DBC fetch fails, same as every other endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: "no DBC has been loaded" }), { status: 503 })));
    await expect(fetchDbc()).rejects.toMatchObject({
      status: 503,
      messages: ["no DBC has been loaded"],
    });
  });
});
