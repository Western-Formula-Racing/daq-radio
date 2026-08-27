import { useEffect } from "react";
import { useTheme } from "next-themes";
import { isAppTheme, THEME_REQUEST_EVENT } from "./theme";

export function ThemeRequestBridge() {
  const { setTheme } = useTheme();

  useEffect(() => {
    const onThemeRequest = (event: Event) => {
      const theme = (event as CustomEvent<{ theme?: unknown }>).detail?.theme;
      if (isAppTheme(theme)) {
        setTheme(theme);
      }
    };

    window.addEventListener(THEME_REQUEST_EVENT, onThemeRequest);
    return () => window.removeEventListener(THEME_REQUEST_EVENT, onThemeRequest);
  }, [setTheme]);

  return null;
}
