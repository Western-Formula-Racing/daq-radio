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
      <button onClick={processTestMessages} style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>Process Test Messages</button>
    </>
  );
}

export default App;
