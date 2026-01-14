import { createBrowserRouter } from "react-router";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Accumulator from "./pages/Accumulator";
import Account from "./pages/Account";
import Settings from "./pages/Settings";
import ChargeCart from "./pages/ChargeCart";
import MonitorBuilder from "./pages/MonitorBuilder";
import SystemLink from "./pages/SystemLink";

// Get base path for GitHub Pages deployment
const basename = import.meta.env.BASE_URL || '/';

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    //Pages are separate components, to add a route that is related to '/' just add a child, path is the relative path
    children: [
      { path: "dashboard", element: <Dashboard /> },
      { path: "accumulator", element: <Accumulator /> },
      { path: "account", element: <Account /> },
      { path: "settings", element: <Settings /> },
      { path: "chargecart", element: <ChargeCart /> },
      { path: "monitor-builder", element: <MonitorBuilder /> },
      { path: "system-link", element: <SystemLink /> },
    ],
  },
], { basename });
