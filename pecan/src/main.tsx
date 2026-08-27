import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "next-themes";
import "./index.css";
import { router } from "./routes";
import { TimelineProvider } from "./context/TimelineContext";
import { APP_THEMES, THEME_CLASS } from "./theme/theme";
import { ThemeRequestBridge } from "./theme/ThemeRequestBridge";

const defaultTheme = import.meta.env.VITE_INTERNAL ? "internal" : "dark";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    attribute="class"
    storageKey="pecan:theme"
    defaultTheme={defaultTheme}
    themes={[...APP_THEMES]}
    value={THEME_CLASS}
    enableSystem={false}
    disableTransitionOnChange
  >
    <ThemeRequestBridge />
    <TimelineProvider>
      <RouterProvider router={router} />
    </TimelineProvider>
  </ThemeProvider>
);
