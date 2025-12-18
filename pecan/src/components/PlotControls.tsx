import { useState, useRef, useEffect, useLayoutEffect } from "react";

interface PlotControlsProps {
  signalInfo: {
    msgID: string;
    signalName: string;
    messageName: string;
    unit: string;
  };
  existingPlots: string[];
  position: { x: number; y: number };
  onNewPlot: (signalInfo: {
    msgID: string;
    signalName: string;
    messageName: string;
    unit: string;
  }) => void;
  onAddToPlot: (
    plotId: string,
    signalInfo: {
      msgID: string;
      signalName: string;
      messageName: string;
      unit: string;
    }
  ) => void;
  onClose: () => void;
}

function PlotControls({
  signalInfo,
  existingPlots,
  position,
  onNewPlot,
  onAddToPlot,
  onClose,
}: PlotControlsProps) {
  const [showAddToPlotMenu, setShowAddToPlotMenu] = useState(false);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to keep menu in viewport
  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = position.x;
      let newY = position.y;

      // Check right edge
      if (newX + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 10;
      }

      // Check bottom edge
      if (newY + rect.height > viewportHeight) {
        newY = newY - rect.height;
      }

      setAdjustedPosition({ x: newX, y: newY });
    }
  }, [position, showAddToPlotMenu]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-dropdown-menu-bg rounded-md shadow-lg border border-white/10"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        minWidth: "180px",
      }}
    >
      <div className="p-2 border-b border-white/10">
        <div className="text-xs text-gray-400">
          {signalInfo.messageName}
        </div>
        <div className="text-sm font-semibold text-white">
          {signalInfo.signalName}
        </div>
      </div>

      <div className="py-1">
        {/* New Plot option */}
        <button
          id="tour-new-plot-btn"
          onClick={() => {
            onNewPlot(signalInfo);
            onClose();
          }}
          className="w-full px-4 py-2 text-left text-white hover:bg-dropdown-menu-secondary transition-colors"
        >
          New Plot
        </button>

        {/* Add to existing plot */}
        {existingPlots.length > 0 && (
          <>
            <button
              onClick={() => setShowAddToPlotMenu(!showAddToPlotMenu)}
              className="w-full px-4 py-2 text-left text-white hover:bg-dropdown-menu-secondary transition-colors flex justify-between items-center"
            >
              <span>➕ Add to Plot</span>
              <span className="text-xs">▸</span>
            </button>

            {showAddToPlotMenu && (
              <div className="pl-4 bg-dropdown-menu-secondary">
                {existingPlots.map((plotId) => (
                  <button
                    key={plotId}
                    onClick={() => {
                      onAddToPlot(plotId, signalInfo);
                      onClose();
                    }}
                    className="w-full px-4 py-2 text-left text-white hover:bg-white/10 transition-colors text-sm"
                  >
                    Plot {plotId}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default PlotControls;
