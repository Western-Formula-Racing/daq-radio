import { useState } from "react";
import "./index.css";
import Sidebar from "./components/Sidebar";
import Hamburger from "./components/HamburgerMenu";

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
