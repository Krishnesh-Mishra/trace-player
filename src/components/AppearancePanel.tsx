import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pin } from "lucide-react";
import {
  type AppearanceState,
  type BarSize,
  type SeekBarSize,
  APPEARANCE_BARSIZE_OPTIONS,
  APPEARANCE_SEEKBAR_OPTIONS,
} from "./types";
import { THEME_OPTIONS, type ThemeChoice } from "../hooks/useTheme";

interface Props {
  open: boolean;
  onClose: () => void;
  appearance: AppearanceState;
  onAppearanceChange: (next: AppearanceState) => void;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
  alwaysOnTop: boolean;
  onAlwaysOnTopToggle: () => void;
}

function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)]">
        {label}
      </span>
      <div className="flex bg-[var(--np-hover)] rounded-lg p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 px-2.5 py-1.5 text-[11px] rounded-md cursor-pointer
                        transition-colors duration-100
                        ${o.value === value
                          ? "bg-[var(--np-active)] text-[var(--np-text)]"
                          : "text-[var(--np-text-secondary)] hover:text-[var(--np-text)]"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AppearancePanel({
  open,
  onClose,
  appearance,
  onAppearanceChange,
  theme,
  onThemeChange,
  alwaysOnTop,
  onAlwaysOnTopToggle,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!panelRef.current || !t) return;
      if (panelRef.current.contains(t)) return;
      if (t.closest("[data-settings-toggle]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          className="absolute bottom-full right-0 mb-2 w-72
                     bg-[var(--np-overlay-heavy)] backdrop-blur-xl
                     rounded-2xl p-4 flex flex-col gap-3.5 z-40"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--np-text)]">
              Appearance
            </span>
          </div>

          <SegRow<BarSize>
            label="Control bar size"
            value={appearance.barSize}
            options={APPEARANCE_BARSIZE_OPTIONS}
            onChange={(v) => onAppearanceChange({ ...appearance, barSize: v })}
          />

          <SegRow<SeekBarSize>
            label="Seek bar thickness"
            value={appearance.seekBarSize}
            options={APPEARANCE_SEEKBAR_OPTIONS}
            onChange={(v) =>
              onAppearanceChange({ ...appearance, seekBarSize: v })
            }
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)]">
              Theme
            </span>
            <select
              value={theme}
              onChange={(e) => onThemeChange(e.target.value as ThemeChoice)}
              className="w-full bg-[var(--np-hover)] rounded-lg px-3 py-2
                         text-[11px] text-[var(--np-text)] outline-none
                         focus:ring-1 focus:ring-[var(--np-active)] cursor-pointer"
            >
              {THEME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onAlwaysOnTopToggle}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg
                        text-[11px] cursor-pointer transition-colors duration-100
                        ${alwaysOnTop
                          ? "bg-[var(--np-active)] text-[var(--np-text)]"
                          : "bg-[var(--np-hover)] text-[var(--np-text-secondary)] hover:text-[var(--np-text)]"}`}
          >
            <Pin className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Always on top</span>
            <span className="text-[10px] text-[var(--np-text-tertiary)]">
              {alwaysOnTop ? "On" : "Off"}
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
