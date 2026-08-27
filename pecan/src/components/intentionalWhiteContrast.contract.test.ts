// App tsconfig omits @types/node. Vitest still runs on Node.
// @ts-expect-error Node builtin is untyped under tsconfig.app.json.
import { readFileSync as readFileSyncUntyped } from "node:fs";
// @ts-expect-error Node builtin is untyped under tsconfig.app.json.
import { dirname as dirnameUntyped, resolve as resolveUntyped } from "node:path";
// @ts-expect-error Node builtin is untyped under tsconfig.app.json.
import { fileURLToPath as fileURLToPathUntyped } from "node:url";
import { describe, expect, it } from "vitest";

const readFileSync = readFileSyncUntyped as (path: string, encoding: string) => string;
const dirname = dirnameUntyped as (path: string) => string;
const resolve = resolveUntyped as (...paths: string[]) => string;
const fileURLToPath = fileURLToPathUntyped as (url: string) => string;

const here = dirname(fileURLToPath(import.meta.url));

function readSrc(...parts: string[]) {
  return readFileSync(resolve(here, ...parts), "utf8");
}

const SHIMMED_WHITE = /\btext-white\b/;
const LOCKED_WHITE = /text-\[#fff\]/;

describe("Task 4 intentional white-on-dark contrast", () => {
  it("locks DataRow UNKNOWN badge to a non-shimmed white", () => {
    const src = readSrc("DataRow.tsx");
    expect(src).toMatch(/text-\[#fff\][^"'`]*bg-rose-600|bg-rose-600[^"'`]*text-\[#fff\]/);
    expect(src).not.toMatch(/text-white[^"'`]*bg-rose-600|bg-rose-600[^"'`]*text-white/);
  });

  it("locks SystemLink LIVE FEED and active PTT to a non-shimmed white", () => {
    const src = readSrc("..", "pages", "SystemLink.tsx");
    expect(src).toMatch(/bg-black\/70[\s\S]{0,80}text-\[#fff\]/);
    expect(src).toMatch(/isTalking \? <Mic[^>]*(?:className="[^"]*text-\[#fff\]|text-\[#fff\])/);
    expect(src).toMatch(/isTalking \? 'text-\[#fff\]'/);
    expect(src).not.toMatch(/bg-black\/70[\s\S]{0,80}\btext-white\b/);
  });

  it("locks saturated blue action labels to a non-shimmed white", () => {
    const sensor = readSrc("..", "pages", "SensorValidator.tsx");
    const throttle = readSrc("..", "pages", "ThrottleMapper.tsx");
    const tour = readSrc("TourGuide.tsx");

    expect(sensor).toMatch(/bg-blue-600[^"'`\n]*text-\[#fff\]/);
    expect(sensor).not.toMatch(/bg-blue-600[^"'`\n]*\btext-white\b/);

    expect(throttle).toMatch(/bg-blue-600[^"'`\n]*text-\[#fff\]/);
    expect(throttle).not.toMatch(/bg-blue-600[^"'`\n]*\btext-white\b/);

    expect(tour).toMatch(/bg-blue-600[^"'`\n]*text-\[#fff\]/);
    expect(tour).not.toMatch(/bg-blue-600[^"'`\n]*\btext-white\b/);
  });

  it("does not leave shim-matched text-white on those contrast surfaces", () => {
    const files = [
      readSrc("DataRow.tsx"),
      readSrc("TourGuide.tsx"),
      readSrc("..", "pages", "SensorValidator.tsx"),
      readSrc("..", "pages", "ThrottleMapper.tsx"),
      readSrc("..", "pages", "SystemLink.tsx"),
    ];

    for (const src of files) {
      expect(src).toMatch(LOCKED_WHITE);
      expect(src).not.toMatch(SHIMMED_WHITE);
    }
  });
});
