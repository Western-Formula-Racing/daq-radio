// App tsconfig omits @types/node (it collides with DOM timer types). Vitest still
// runs on Node, so read the stylesheet source as text instead of the Tailwind-processed module.
// @ts-expect-error Node builtin is untyped under tsconfig.app.json.
import { readFileSync as readFileSyncUntyped } from "node:fs";
// @ts-expect-error Node builtin is untyped under tsconfig.app.json.
import { dirname as dirnameUntyped, resolve as resolveUntyped } from "node:path";
// @ts-expect-error Node builtin is untyped under tsconfig.app.json.
import { fileURLToPath as fileURLToPathUntyped } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_CLASS, USER_THEMES, type AppTheme } from "./theme";

const readFileSync = readFileSyncUntyped as (path: string, encoding: string) => string;
const dirname = dirnameUntyped as (path: string) => string;
const resolve = resolveUntyped as (...paths: string[]) => string;
const fileURLToPath = fileURLToPathUntyped as (url: string) => string;

const VISUALIZATION_TOKENS = [
  "--color-focus",
  "--color-chart-grid",
  "--color-chart-series-primary",
  "--color-chart-series-secondary",
  "--color-chart-series-success",
  "--color-chart-series-warning",
  "--color-chart-series-danger",
  "--color-chart-checkpoint",
  "--color-chart-checkpoint-bg",
  "--color-chart-state",
  "--color-chart-state-bg",
  "--color-flow-node-bg",
  "--color-flow-node-text",
  "--color-flow-edge",
  "--color-flow-grid",
] as const;

const PSL_CORE_VALUES: Record<string, string> = {
  "--color-background": "#160f0b",
  "--color-sidebar": "#21150f",
  "--color-option": "#2c1c13",
  "--color-option-select": "#4a2a18",
  "--color-data-module-bg": "#291a12",
  "--color-data-textbox-bg": "#3a2418",
  "--color-text-primary": "#fff4df",
  "--color-text-secondary": "#efd4ad",
  "--color-text-muted": "#c39a72",
  "--color-text-heading": "#fff8ea",
  "--color-focus": "#f59e0b",
  "--color-chart-series-primary": "#f59e0b",
  "--color-chart-series-secondary": "#fb923c",
};

const THEME_CLASS_NAMES = [
  "theme-dark",
  "theme-light",
  "theme-psl",
  "theme-internal",
  "theme-local-can",
] as const;

function normalizeCssValue(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

function parseHexColor(value: string): [number, number, number] {
  const hex = normalizeCssValue(value).replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`expected #rrggbb, got ${value}`);
  }
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function relativeLuminance(value: string): number {
  const channels = parseHexColor(value).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function overlayBlack(base: string, alpha: number): string {
  const mixed = parseHexColor(base).map((channel) => Math.round(channel * (1 - alpha)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const SHARED_MUTED_PALETTE_TOKENS = [
  "--color-slate-400",
  "--color-slate-500",
  "--color-gray-300",
  "--color-gray-400",
  "--color-gray-500",
  "--color-zinc-400",
  "--color-neutral-400",
  "--color-stone-400",
] as const;

const MUTED_TEXT_SHIMS = [
  "text-slate-400",
  "text-slate-500",
  "text-gray-300",
  "text-gray-400",
  "text-gray-500",
] as const;

function skipComment(css: string, i: number): number {
  if (css.startsWith("/*", i)) {
    const end = css.indexOf("*/", i + 2);
    return end === -1 ? css.length : end + 2;
  }
  return i;
}

function skipString(css: string, i: number): number {
  const quote = css[i];
  if (quote !== '"' && quote !== "'") return i;
  i += 1;
  while (i < css.length) {
    if (css[i] === "\\") {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i += 1;
  }
  return css.length;
}

function skipBalancedBlock(css: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < css.length) {
    i = skipComment(css, i);
    if (i >= css.length) break;
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return css.length;
}

function skipAtRule(css: string, atIndex: number): number {
  let i = atIndex + 1;
  while (i < css.length) {
    i = skipComment(css, i);
    if (i >= css.length) break;
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === "{") return skipBalancedBlock(css, i);
    if (ch === ";") return i + 1;
    i += 1;
  }
  return css.length;
}

function nextSignificant(css: string, start: number): number {
  let i = start;
  while (i < css.length) {
    i = skipComment(css, i);
    if (i >= css.length) break;
    if (!/\s/.test(css[i])) return i;
    i += 1;
  }
  return css.length;
}

function parseCustomProperties(body: string): Record<string, string> {
  const properties: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    i = skipComment(body, i);
    if (i >= body.length) break;
    const ch = body[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(body, i);
      continue;
    }
    if (ch === "{") {
      i = skipBalancedBlock(body, i);
      continue;
    }
    if (ch === "@") {
      i = skipAtRule(body, i);
      continue;
    }
    if (body.startsWith("--", i)) {
      const nameEnd = body.indexOf(":", i + 2);
      if (nameEnd === -1) break;
      const name = body.slice(i, nameEnd).trim();
      let j = nameEnd + 1;
      let value = "";
      while (j < body.length) {
        j = skipComment(body, j);
        if (j >= body.length) break;
        const current = body[j];
        if (current === '"' || current === "'") {
          const after = skipString(body, j);
          value += body.slice(j, after);
          j = after;
          continue;
        }
        if (current === "{") {
          const after = skipBalancedBlock(body, j);
          value += body.slice(j, after);
          j = after;
          continue;
        }
        if (current === ";") {
          j += 1;
          break;
        }
        value += current;
        j += 1;
      }
      properties[name] = normalizeCssValue(value);
      i = j;
      continue;
    }
    i += 1;
  }
  return properties;
}

function extractThemeClassProperties(css: string): Record<string, Record<string, string>> {
  const byClass: Record<string, Record<string, string>> = {};
  let i = 0;
  while (i < css.length) {
    i = nextSignificant(css, i);
    if (i >= css.length) break;
    if (css[i] === "@") {
      i = skipAtRule(css, i);
      continue;
    }
    const blockStart = css.indexOf("{", i);
    if (blockStart === -1) break;
    const selectorText = css.slice(i, blockStart);
    const blockEnd = skipBalancedBlock(css, blockStart);
    const body = css.slice(blockStart + 1, blockEnd - 1);
    const properties = parseCustomProperties(body);
    for (const rawSelector of selectorText.split(",")) {
      const selector = rawSelector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!/^\.theme-[a-z0-9-]+$/.test(selector)) continue;
      const className = selector.slice(1);
      byClass[className] = { ...byClass[className], ...properties };
    }
    i = blockEnd;
  }
  return byClass;
}

function extractAtThemeProperties(css: string): Record<string, string> {
  let i = 0;
  while (i < css.length) {
    i = nextSignificant(css, i);
    if (i >= css.length) break;
    if (css.startsWith("@theme", i)) {
      const blockStart = css.indexOf("{", i);
      const blockEnd = skipBalancedBlock(css, blockStart);
      return parseCustomProperties(css.slice(blockStart + 1, blockEnd - 1));
    }
    if (css[i] === "@") {
      i = skipAtRule(css, i);
      continue;
    }
    const blockStart = css.indexOf("{", i);
    if (blockStart === -1) break;
    i = skipBalancedBlock(css, blockStart);
  }
  return {};
}

function lightTextShimColor(css: string, utility: string): string {
  const escaped = utility.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(
    new RegExp(`\\.theme-light\\s+\\.${escaped}\\s*(?:,[^{]*)?\\{([^}]+)\\}`, "s")
  );
  if (!match) {
    throw new Error(`missing Light text shim for .${utility}`);
  }
  const color = match[1].match(/color:\s*([^;!]+)/);
  if (!color) {
    throw new Error(`missing color in Light text shim for .${utility}`);
  }
  return normalizeCssValue(color[1]);
}

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "../index.css");
const themeCss = readFileSync(cssPath, "utf8");
const themeClasses = extractThemeClassProperties(themeCss);
const atTheme = extractAtThemeProperties(themeCss);

describe("theme CSS contract", () => {
  it("declares every registered theme class block", () => {
    for (const className of THEME_CLASS_NAMES) {
      expect(themeClasses[className], `missing .${className} block`).toBeDefined();
    }
    for (const theme of Object.keys(THEME_CLASS) as AppTheme[]) {
      expect(themeClasses[THEME_CLASS[theme]]).toBeDefined();
    }
  });

  it("includes every visualization token in each user theme class", () => {
    for (const theme of USER_THEMES) {
      const className = THEME_CLASS[theme];
      const properties = themeClasses[className] ?? {};
      for (const token of VISUALIZATION_TOKENS) {
        expect(properties[token], `${className} missing ${token}`).toBeTruthy();
      }
    }
  });

  it("pins the PSL core palette values", () => {
    const psl = themeClasses["theme-psl"] ?? {};
    for (const [token, value] of Object.entries(PSL_CORE_VALUES)) {
      expect(normalizeCssValue(psl[token] ?? ""), token).toBe(value);
    }
  });

  it("keeps Light muted text AA on option and input surfaces", () => {
    const light = themeClasses["theme-light"] ?? {};
    const muted = normalizeCssValue(light["--color-text-muted"] ?? "");
    const option = normalizeCssValue(light["--color-option"] ?? "");
    const textbox = normalizeCssValue(light["--color-data-textbox-bg"] ?? "");

    expect(muted).toBe("#4b5d73");
    expect(option).toBe("#dfe2e8");
    expect(textbox).toBe("#edf0f5");
    expect(contrastRatio(muted, option)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, textbox)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps shared muted-tier palette tokens at their default values", () => {
    const light = themeClasses["theme-light"] ?? {};

    expect(normalizeCssValue(atTheme["--color-gray-300"] ?? "")).toBe("#d1d5db");
    expect(normalizeCssValue(atTheme["--color-gray-400"] ?? "")).toBe("#9ca3af");
    for (const token of SHARED_MUTED_PALETTE_TOKENS) {
      expect(light[token], `${token} must not be aliased in .theme-light`).toBeUndefined();
    }
  });

  it("points Light muted-tier text shims at --color-text-muted", () => {
    for (const utility of MUTED_TEXT_SHIMS) {
      expect(lightTextShimColor(themeCss, utility), utility).toBe("var(--color-text-muted)");
    }
  });

  it("restores muted copy to white inside Light dropdown menus", () => {
    const restoration = ["text-gray-400", "text-gray-500", "text-slate-400"];
    for (const utility of restoration) {
      expect(themeCss).toContain(`.theme-light .bg-dropdown-menu-bg .${utility}`);
      expect(themeCss).toContain(`.theme-light .bg-dropdown-menu-secondary .${utility}`);
    }
    expect(themeCss).toMatch(
      /\.theme-light \.bg-dropdown-menu-bg \.text-gray-400[\s\S]*?\{\s*color:\s*white/s
    );
  });

  it("keeps Light muted copy AA on page and cards", () => {
    const light = themeClasses["theme-light"] ?? {};
    const muted = normalizeCssValue(light["--color-text-muted"] ?? "");
    const page = normalizeCssValue(light["--color-background"] ?? "");
    const card = normalizeCssValue(light["--color-data-module-bg"] ?? "");

    expect(page).toBe("#dde1e8");
    expect(card).toBe("#ffffff");
    expect(contrastRatio(muted, page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, card)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps Light and PSL dropdown surfaces readable against white item text", () => {
    for (const className of ["theme-light", "theme-psl"] as const) {
      const theme = themeClasses[className] ?? {};
      const menuBg = normalizeCssValue(theme["--color-dropdown-menu-bg"] ?? "");
      const secondary = normalizeCssValue(theme["--color-dropdown-menu-secondary"] ?? "");

      expect(contrastRatio("#ffffff", menuBg), `${className} menu`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#ffffff", secondary), `${className} secondary`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps PSL dropdown menus readable against white item text", () => {
    const psl = themeClasses["theme-psl"] ?? {};
    const menuBg = normalizeCssValue(psl["--color-dropdown-menu-bg"] ?? "");

    expect(menuBg).toBe("#4a2a18");
    expect(contrastRatio("#ffffff", menuBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps PSL secondary dropdown surfaces readable against white item text", () => {
    const psl = themeClasses["theme-psl"] ?? {};
    const secondary = normalizeCssValue(psl["--color-dropdown-menu-secondary"] ?? "");

    expect(secondary).toBe("#6b3d22");
    expect(contrastRatio("#ffffff", secondary)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps Light muted labels AA on white cards under the black/30 overlay", () => {
    const light = themeClasses["theme-light"] ?? {};
    const muted = normalizeCssValue(light["--color-text-muted"] ?? "");
    const card = normalizeCssValue(light["--color-data-module-bg"] ?? "");
    const match = themeCss.match(
      /\.theme-light\s+\.bg-black\\\/30\s*\{[^}]*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/s
    );

    expect(card).toBe("#ffffff");
    expect(match?.[1]).toBeTruthy();
    const overlay = overlayBlack(card, Number(match?.[1]));
    expect(contrastRatio(muted, overlay)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps Light status series tokens AA on option", () => {
    const light = themeClasses["theme-light"] ?? {};
    const option = normalizeCssValue(light["--color-option"] ?? "");
    const tokens = [
      "--color-chart-series-success",
      "--color-chart-series-warning",
      "--color-chart-series-secondary",
    ] as const;

    expect(option).toBe("#dfe2e8");
    for (const token of tokens) {
      const fg = normalizeCssValue(light[token] ?? "");
      expect(contrastRatio(fg, option), `${token} on option`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the PSL warning series distinct from primary on espresso", () => {
    const psl = themeClasses["theme-psl"] ?? {};
    const primary = normalizeCssValue(psl["--color-chart-series-primary"] ?? "");
    const warning = normalizeCssValue(psl["--color-chart-series-warning"] ?? "");
    const pageBg = normalizeCssValue(psl["--color-background"] ?? "");

    expect(primary).toBe("#f59e0b");
    expect(warning).toBe("#fde047");
    expect(contrastRatio(warning, primary)).toBeGreaterThanOrEqual(1.4);
    expect(contrastRatio(warning, pageBg)).toBeGreaterThanOrEqual(4.5);
  });
});
