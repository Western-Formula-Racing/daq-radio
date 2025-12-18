import React, { useEffect, useRef, useState } from "react";

type DropdownProps = {
  items: string[];                         // menu items, use "br" for a divider
  children: React.ReactNode;               // base trigger element (wrapped/enhanced)
  onSelect?: (value: string) => void;      // callback when an option is clicked, to be changed
  align?: "left" | "right" | "center";     // menu alignment under trigger
  widthClass?: string;                    
  closeOnSelect?: boolean;                 // close after choose item
};

const Dropdown: React.FC<DropdownProps> = ({
  items,
  children,
  onSelect,
  align = "left",
  widthClass = "w-fit",
  closeOnSelect = true,
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const alignClass =
    align === "left"
      ? "left-0"
      : align === "right"
      ? "right-0"
      : "left-1/2 -translate-x-1/2";

  return (
    <div ref={wrapperRef} className="relative inline-block">
      {/* Trigger: pointer + subtle hover lightening */}
      <span
        onClick={() => setOpen(v => !v)}
        className="cursor-pointer hover:brightness-110 transition"
      >
        {children}
      </span>

      {open && (
        <div className={`absolute ${alignClass} top-full mt-2 z-50 ${widthClass}`}>
          {/* ▼ Triangle */}
          <div className="absolute top-[-6px] left-4 w-3 h-3 bg-dropdown-menu-bg rotate-45"></div>

          {/* Dropdown box */}
          <div className="bg-dropdown-menu-bg rounded-md shadow-lg overflow-hidden relative">
            <div className="flex flex-col">
              {items.map((item, idx) =>
                item === "br" ? (
                  <div key={`div-${idx}`} className="h-[2px] w-full bg-gray-200" />
                ) : (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      onSelect?.(item);
                      if (closeOnSelect) setOpen(false);
                    }}
                    className="w-full h-fit p-[4px] flex items-center px-3 text-white font-semibold text-left cursor-pointer hover:brightness-110 transition"
                  >
                    {item}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dropdown;
