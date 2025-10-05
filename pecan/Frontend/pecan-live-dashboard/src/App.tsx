import { useState } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import Hamburger from "./components/HamburgerMenu";
import { processTestMessages } from "./utils/canProcessor";

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  return (
    <>
      <Hamburger trigger={() => setIsSidebarOpen(true)} />
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: 200, height: 60, background: '#f0f0f0', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 0 }}>
      </div>
      <button onClick={processTestMessages} style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>Process Test Messages</button>
    </>
  );
}

export default App;
