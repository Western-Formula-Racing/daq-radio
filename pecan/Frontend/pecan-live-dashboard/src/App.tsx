import { useState } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import Hamburger from "./components/HamburgerMenu";

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  return (
    <>
      <Hamburger trigger={() => setIsSidebarOpen(true)} />
      <Sidebar open={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
    </>
  );
}

export default App;
