import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  hasFile: boolean;
  isFullscreen: boolean;
}

export default function TitleBar({ hasFile, isFullscreen }: Props) {
  const [maximized, setMaximized] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clearTimer();
    setHovered(true);
  }, [clearTimer]);

  const handleLeave = useCallback(() => {
    clearTimer();
    hideTimer.current = setTimeout(() => setHovered(false), 300);
  }, [clearTimer]);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const expanded = !hasFile || hovered || (!maximized && !isFullscreen);

  return (
    <div
      className="absolute top-0 left-0 right-0  z-[80] flex justify-center"
      style={{ minHeight: 8 }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div
        className={`flex items-center justify-between select-none w-[50vw] overflow-hidden
                    transition-all  duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                    ${expanded
                      ? "h-9 mt-1.5 px-1 opacity-100 bg-[var(--np-overlay-heavy)] [backdrop-filter:var(--np-backdrop-blur)] rounded-full"
                      : "h-0 mt-0 px-0 opacity-0 rounded-full"}`}
        data-tauri-drag-region
      >
        <div
          className="flex items-center gap-1.5 px-2.5 h-full"
          data-tauri-drag-region
        >
          <img
            src="/logo.png"
            alt=""
            className="w-3 h-3 object-contain pointer-events-none"
            draggable={false}
            data-tauri-drag-region
          />
          <span
            className="text-[10px] text-[var(--np-text-tertiary)] font-medium tracking-wide pointer-events-none whitespace-nowrap"
            data-tauri-drag-region
          >
            Trace Player
          </span>
        </div>

        <div className="w-px h-3.5 bg-[var(--np-divider)] shrink-0" />

        <div className="flex items-center shrink-0">
          {!isFullscreen && (
            <>
              <button
                onClick={() => getCurrentWindow().minimize()}
                className="w-7 h-7 flex items-center justify-center rounded-full
                           text-[var(--np-text-muted)] hover:text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]
                           transition-colors duration-100 cursor-pointer"
                aria-label="Minimize"
              >
                <svg
                  width="8"
                  height="1"
                  viewBox="0 0 8 1"
                  fill="currentColor"
                >
                  <rect width="8" height="1" />
                </svg>
              </button>

              <button
                onClick={() => getCurrentWindow().toggleMaximize()}
                className="w-7 h-7 flex items-center justify-center rounded-full
                           text-[var(--np-text-muted)] hover:text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]
                           transition-colors duration-100 cursor-pointer"
                aria-label={maximized ? "Restore" : "Maximize"}
              >
                {maximized ? (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 9 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                  >
                    <rect x="2" y="0.5" width="6.5" height="6.5" rx="0.5" />
                    <rect
                      x="0.5"
                      y="2"
                      width="6.5"
                      height="6.5"
                      rx="0.5"
                      className="fill-[var(--np-bg)]"
                    />
                    <rect x="0.5" y="2" width="6.5" height="6.5" rx="0.5" />
                  </svg>
                ) : (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                  >
                    <rect x="0.5" y="0.5" width="7" height="7" rx="0.5" />
                  </svg>
                )}
              </button>
            </>
          )}

          <button
            onClick={() => getCurrentWindow().close()}
            className="w-7 h-7 flex items-center justify-center rounded-full
                       text-[var(--np-text-muted)] hover:bg-red-500/80 hover:text-white
                       transition-colors duration-100 cursor-pointer"
            aria-label="Close"
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="7" y2="7" />
              <line x1="7" y1="1" x2="1" y2="7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
