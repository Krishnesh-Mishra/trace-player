import { useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Maximize2, Minimize2, Pin } from "lucide-react";

interface Props {
  x: number;
  y: number;
  alwaysShow: boolean;
  widthMode: "full" | "small";
  onToggleAlwaysShow: () => void;
  onSetWidth: (w: "full" | "small") => void;
  onClose: () => void;
}

export default function TitleBarContextMenu({
  x,
  y,
  alwaysShow,
  widthMode,
  onToggleAlwaysShow,
  onSetWidth,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const act = useCallback(
    (fn: () => void) => {
      fn();
      onClose();
    },
    [onClose],
  );

  const menuWidth = 220;
  const menuHeight = 140;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        className="fixed z-[10000] origin-top-left min-w-[200px] py-1 bg-[var(--np-surface)]
                   rounded-lg shadow-xl shadow-black/50 backdrop-blur-sm"
        style={{ left: clampedX, top: clampedY }}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.1 }}
        data-no-app-ctx
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          onClick={() => act(onToggleAlwaysShow)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px]
                     text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)] transition-colors duration-75 cursor-pointer"
        >
          <Pin className="w-3.5 h-3.5 opacity-70" />
          <span className="flex-1">Always show titlebar</span>
          {alwaysShow && <Check className="w-3 h-3 text-[var(--np-text)]" />}
        </button>

        <div className="h-px bg-[var(--np-divider)] my-1 mx-2" />

        <div className="px-3 py-1 text-[9px] uppercase tracking-wide text-[var(--np-text-muted)]">
          Width
        </div>
        <button
          onClick={() => act(() => onSetWidth("small"))}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px]
                     text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)] transition-colors duration-75 cursor-pointer"
        >
          <Minimize2 className="w-3.5 h-3.5 opacity-70" />
          <span className="flex-1">Small</span>
          {widthMode === "small" && <Check className="w-3 h-3 text-[var(--np-text)]" />}
        </button>
        <button
          onClick={() => act(() => onSetWidth("full"))}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px]
                     text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)] transition-colors duration-75 cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5 opacity-70" />
          <span className="flex-1">Full</span>
          {widthMode === "full" && <Check className="w-3 h-3 text-[var(--np-text)]" />}
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
