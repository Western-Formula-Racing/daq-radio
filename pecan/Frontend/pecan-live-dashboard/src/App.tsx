import { useState } from "react";
import "./index.css";
import Sidebar from "./components/Sidebar";
import Hamburger from "./components/HamburgerMenu";
import { Outlet } from "react-router";

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  return (
    <div className="h-screen flex flex-row ">
      <div className="h-screen w-[60px]">
        <Hamburger trigger={() => setIsSidebarOpen(true)} />
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
      </div>

      {/* Main content area, Outlet element is needed to display the rendered child pages received from the routes */}
      <main id="main-content" className=" w-100 h-full p-4">
        <Outlet />
      </main>
    </div>
  );
}

export default App;
