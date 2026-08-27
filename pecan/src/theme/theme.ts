export const USER_THEMES = ["dark", "light", "psl"] as const;
export const OPERATIONAL_THEMES = ["internal", "local-can"] as const;
export const APP_THEMES = [...USER_THEMES, ...OPERATIONAL_THEMES] as const;
export type UserTheme = (typeof USER_THEMES)[number];
export type AppTheme = (typeof APP_THEMES)[number];

export const THEME_CLASS: Record<AppTheme, string> = {
  dark: "theme-dark",
  light: "theme-light",
  psl: "theme-psl",
  internal: "theme-internal",
  "local-can": "theme-local-can",
};

export const THEME_REQUEST_EVENT = "pecan:theme-request";

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && (APP_THEMES as readonly string[]).includes(value);
}

export function getStoredTheme(fallback: AppTheme = "dark"): AppTheme {
  const stored = localStorage.getItem("pecan:theme");
  return isAppTheme(stored) ? stored : fallback;
}

export function requestTheme(theme: AppTheme): void {
  window.dispatchEvent(new CustomEvent(THEME_REQUEST_EVENT, { detail: { theme } }));
}
