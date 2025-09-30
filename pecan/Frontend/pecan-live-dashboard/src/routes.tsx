import { createBrowserRouter } from "react-router";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Accumulator from "./pages/Accumulator";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "dashboard", element: <Dashboard /> },
      { path: "accumulator", element: <Accumulator /> },
    ],
  },
]);
