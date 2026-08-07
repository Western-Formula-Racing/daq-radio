/** Minimal ambient types for the Node built-ins conformance.test.ts needs at build time.
 *
 * tsconfig.app.json deliberately omits "node" from its `types` array (see the comment on
 * `nodeProcess` in bench.ts): pulling in the full @types/node package overrides browser
 * globals like `setTimeout`'s return type project-wide and breaks unrelated files such as
 * Transmitter.tsx. This file only shapes the two Node modules and one Node global this
 * corpus-loading test actually calls, so the rest of the app stays on browser lib types.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function resolve(...segments: string[]): string;
  export function join(...segments: string[]): string;
}

declare const __dirname: string;
