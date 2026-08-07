import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearImportedRules, importRulesJson, loadRules } from "./ruleSource";

const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "Test rule",
  enabled: true,
  severity: "WARNING",
  message: "OVERTEMP",
  conditions: [{ message: "M", signal: "S", op: ">", value: 10 }],
  for_seconds: 0,
  rearm_seconds: 0,
  ...over,
});

beforeEach(() => {
  clearImportedRules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadRules", () => {
  it("reports no source when OMT is not configured and nothing was imported", async () => {
    vi.stubEnv("VITE_OMT_URL", "");
    const result = await loadRules();
    expect(result.source).toBe("none");
    expect(result.rules).toEqual([]);
  });

  it("returns the rules a reachable OMT instance serves", async () => {
    vi.stubEnv("VITE_OMT_URL", "http://omt.local:8099");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [rule()] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadRules();
    expect(fetchMock.mock.calls[0][0]).toBe("http://omt.local:8099/api/rules");
    expect(result.source).toBe("omt");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe("r1");
  });

  it("tolerates a trailing slash on the configured URL", async () => {
    vi.stubEnv("VITE_OMT_URL", "http://omt.local:8099/");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ rules: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await loadRules();
    expect(fetchMock.mock.calls[0][0]).toBe("http://omt.local:8099/api/rules");
  });

  it("falls back to no source rather than throwing when the fetch fails", async () => {
    vi.stubEnv("VITE_OMT_URL", "http://omt.local:8099");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await loadRules();
    expect(result.source).toBe("none");
    expect(result.rules).toEqual([]);
    expect(result.error).toMatch(/offline/);
  });

  it("falls back to no source when OMT answers with an error status", async () => {
    vi.stubEnv("VITE_OMT_URL", "http://omt.local:8099");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await loadRules();
    expect(result.source).toBe("none");
    expect(result.error).toMatch(/503/);
  });

  it("prefers imported rules so replay works at a track with no network", async () => {
    vi.stubEnv("VITE_OMT_URL", "");
    importRulesJson(JSON.stringify([rule({ id: "imported" })]));
    const result = await loadRules();
    expect(result.source).toBe("file");
    expect(result.rules[0].id).toBe("imported");
  });
});

describe("importRulesJson", () => {
  it("accepts a plain array of rule documents", () => {
    const rules = importRulesJson(JSON.stringify([rule()]));
    expect(rules).toHaveLength(1);
    expect(rules[0].conditions[0].signal).toBe("S");
  });

  it("accepts the {rules: [...]} envelope the OMT API serves", () => {
    expect(importRulesJson(JSON.stringify({ rules: [rule()] }))).toHaveLength(1);
  });

  it("rejects text that is not JSON", () => {
    expect(() => importRulesJson("not json")).toThrow(/not valid JSON/i);
  });

  it("rejects a non-array", () => {
    expect(() => importRulesJson(JSON.stringify({ id: "r1" })))
      .toThrow(/array of rule documents/i);
  });

  it("rejects a rule with no conditions", () => {
    const bad = rule();
    delete (bad as Record<string, unknown>).conditions;
    expect(() => importRulesJson(JSON.stringify([bad]))).toThrow(/conditions/i);
  });

  it("rejects an empty condition list", () => {
    expect(() => importRulesJson(JSON.stringify([rule({ conditions: [] })])))
      .toThrow(/at least one condition/i);
  });

  it("rejects more than four conditions with a readable message", () => {
    const cond = { message: "M", signal: "S", op: ">", value: 1 };
    const bad = rule({ conditions: [cond, cond, cond, cond, cond] });
    expect(() => importRulesJson(JSON.stringify([bad])))
      .toThrow(/5 conditions.*limit is 4/i);
  });

  it("names the offending rule so a long file can be fixed", () => {
    expect(() => importRulesJson(JSON.stringify([rule(), rule({
      id: "r2", name: "Second", conditions: [],
    })]))).toThrow(/Second/);
  });

  it("rejects an unknown severity", () => {
    expect(() => importRulesJson(JSON.stringify([rule({ severity: "URGENT" })])))
      .toThrow(/severity/i);
  });

  it("rejects an unknown operator", () => {
    const bad = rule({ conditions: [{ message: "M", signal: "S", op: "~=", value: 1 }] });
    expect(() => importRulesJson(JSON.stringify([bad]))).toThrow(/op/i);
  });

  it("rejects a negative hold time", () => {
    expect(() => importRulesJson(JSON.stringify([rule({ for_seconds: -1 })])))
      .toThrow(/for_seconds/);
  });

  it("defaults enabled, for_seconds and rearm_seconds when a file omits them", () => {
    const bare = rule();
    delete (bare as Record<string, unknown>).enabled;
    delete (bare as Record<string, unknown>).for_seconds;
    delete (bare as Record<string, unknown>).rearm_seconds;
    const [parsed] = importRulesJson(JSON.stringify([bare]));
    expect(parsed.enabled).toBe(true);
    expect(parsed.for_seconds).toBe(0);
    expect(parsed.rearm_seconds).toBe(0);
  });

  it("keeps enabled false when the file says so", () => {
    const [parsed] = importRulesJson(JSON.stringify([rule({ enabled: false })]));
    expect(parsed.enabled).toBe(false);
  });
});
