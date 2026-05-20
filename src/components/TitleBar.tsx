import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  visible?: boolean;
}

export default function TitleBar({ visible = true }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-[80] h-[28px] flex items-center select-none
                  bg-[var(--np-bg)] transition-opacity duration-200
                  ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
    >
      <div
        className="flex-1 h-full flex items-center gap-1.5 px-2.5 cursor-default"
        data-tauri-drag-region
      >
        <img
          src="/logo.png"
          alt=""
          className="w-3.5 h-3.5 object-contain pointer-events-none"
          draggable={false}
          data-tauri-drag-region
        />
        <span
          className="text-[10px] text-[var(--np-text-tertiary)] font-medium tracking-wide pointer-events-none"
          data-tauri-drag-region
        >
          Trace Player
        </span>
      </div>

      <div className="flex items-center h-full shrink-0">
        <button
          onClick={() => getCurrentWindow().minimize()}
          className="w-[38px] h-full flex items-center justify-center
                     text-[var(--np-text-tertiary)] hover:text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]
                     transition-colors duration-100 cursor-pointer"
          aria-label="Minimize"
        >
          <svg width="9" height="1" viewBox="0 0 9 1" fill="currentColor">
            <rect width="9" height="1" />
          </svg>
        </button>

        <button
          onClick={() => getCurrentWindow().toggleMaximize()}
          className="w-[38px] h-full flex items-center justify-center
                     text-[var(--np-text-tertiary)] hover:text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]
                     transition-colors duration-100 cursor-pointer"
          aria-label={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="1.5" y="0" width="7.5" height="7.5" rx="0.5" />
              <rect x="0" y="1.5" width="7.5" height="7.5" rx="0.5" fill="var(--np-bg)" />
              <rect x="0" y="1.5" width="7.5" height="7.5" rx="0.5" />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="8" height="8" rx="0.5" />
            </svg>
          )}
        </button>

        <button
          onClick={() => getCurrentWindow().close()}
          className="w-[38px] h-full flex items-center justify-center
                     text-[var(--np-text-tertiary)] hover:bg-red-500 hover:text-white
                     transition-colors duration-100 cursor-pointer"
          aria-label="Close"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <line x1="1" y1="1" x2="8" y2="8" />
            <line x1="8" y1="1" x2="1" y2="8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
