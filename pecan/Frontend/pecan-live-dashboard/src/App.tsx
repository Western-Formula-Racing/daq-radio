import { useState } from "react";
import "./index.css";
import Sidebar from "./components/Sidebar";
import Hamburger from "./components/HamburgerMenu";
import { processTestMessages } from "./utils/canProcessor";
import { Outlet } from "react-router";

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  return (
    <>
      <Hamburger trigger={() => setIsSidebarOpen(true)} />
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
    </>
  );
}

export default App;
