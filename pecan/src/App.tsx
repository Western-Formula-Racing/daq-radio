import { useState, useEffect } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import Hamburger from "./components/HamburgerMenu";
import { processTestMessages } from "./utils/canProcessor";
import { Outlet } from "react-router";
import { webSocketService } from "./services/WebSocketService";

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Initialize WebSocket service once when app loads
  useEffect(() => {
    webSocketService.initialize();
    
    // Cleanup on unmount
    return () => {
      webSocketService.disconnect();
    };
  }, []); // Empty dependency array = runs once on mount

  return (
    <div className="h-screen flex flex-row overflow-hidden">
      <div className={`h-screen transition-all duration-300 ease-in-out flex-shrink-0 ${isSidebarOpen ? 'lg:w-2/9 md:w-2/5 sm:w-3/5 w-full' : 'w-[60px]'}`}>
        {!isSidebarOpen && <Hamburger trigger={() => setIsSidebarOpen(true)} />}
        {isSidebarOpen && <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />}
      </div>

      {/* Main content area, Outlet element is needed to display the rendered child pages received from the routes */}
      <main id="main-content" className="flex-1 h-full min-w-0">
        <Outlet context={{ isSidebarOpen }} />
      </main>

      <div style={{ position: 'absolute', top: 0, right: 0, width: 200, height: 60, background: '#f0f0f0', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 0 }}>
      </div>

      <button onClick={processTestMessages} style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>Process Test Messages</button>
    </div>
  );
}

export default App;
