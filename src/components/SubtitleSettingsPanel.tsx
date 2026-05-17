import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FolderOpen } from "lucide-react";
import PresetGrid from "./subtitle/PresetGrid";
import StyleControls from "./subtitle/StyleControls";
import DelaySection from "./subtitle/DelaySection";

// Re-exports keep App.tsx's existing imports working unchanged.
export { DEFAULT_SUBTITLE_STYLE } from "./subtitle/presets";
export type { SubtitleStyle } from "./subtitle/presets";

import type { SubtitleStyle } from "./subtitle/presets";

interface Props {
  open: boolean;
  onClose: () => void;
  style: SubtitleStyle;
  delayMs: number;
  onStyleChange: (style: SubtitleStyle) => void;
  onDelayChange: (delayMs: number) => void;
  onLoadSubtitle: () => void;
}

export default function SubtitleSettingsPanel({
  open,
  onClose,
  style,
  delayMs,
  onStyleChange,
  onDelayChange,
  onLoadSubtitle,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  // Close on outside click (mousedown — avoids racing with the panel's click handlers)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          key="sub-panel"
          className="absolute top-0 right-0 bottom-0 z-50
                     w-[340px] bg-[#0d0d0f]/95 backdrop-blur-xl
                     border-l border-white/10 shadow-2xl
                     flex flex-col"
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-white/10 shrink-0">
            <h2 className="text-sm font-medium text-white tracking-wide">Subtitles</h2>
            <motion.button
              className="w-7 h-7 flex items-center justify-center text-white/60
                         hover:text-white rounded-md hover:bg-white/10 cursor-pointer
                         transition-colors duration-100"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </motion.button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            <motion.button
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg
                          bg-white/5 hover:bg-white/10
                         text-sm text-white/70 hover:text-white cursor-pointer
                         transition-colors duration-100"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={onLoadSubtitle}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              Load subtitle file…
            </motion.button>

            <PresetGrid onPick={onStyleChange} />
            <StyleControls style={style} onChange={onStyleChange} />
            <DelaySection delayMs={delayMs} onChange={onDelayChange} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
