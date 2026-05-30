import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type {
  AppearanceState,
  SettingsPage,
  BarSize,
  SeekBarSize,
} from "../../types";
import {
  APPEARANCE_BARSIZE_OPTIONS,
  APPEARANCE_SEEKBAR_OPTIONS,
} from "../../types";
import { THEME_OPTIONS, type ThemeChoice } from "../../../hooks/useTheme";
import { BackHeader, ToggleRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  appearance: AppearanceState;
  theme: ThemeChoice;
  alwaysOnTop: boolean;
  onNavigate: (p: SettingsPage) => void;
  onAlwaysOnTopToggle: () => void;
  onBack: () => void;
}

function labelFor<T extends string>(
  value: T,
  options: readonly { value: T; label: string }[]
): string {
  return options.find((o) => o.value === value)?.label ?? String(value);
}

export default function AppearancePage({
  direction,
  appearance,
  theme,
  alwaysOnTop,
  onNavigate,
  onAlwaysOnTopToggle,
  onBack,
}: Props) {
  const themeLabel = labelFor<ThemeChoice>(theme, THEME_OPTIONS);
  const barLabel = labelFor<BarSize>(appearance.barSize, APPEARANCE_BARSIZE_OPTIONS);
  const seekLabel = labelFor<SeekBarSize>(
    appearance.seekBarSize,
    APPEARANCE_SEEKBAR_OPTIONS
  );

  return (
    <motion.div
      key="appearance"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Settings" onClick={onBack} />

      <div className="px-1 py-1">
        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("appearance_theme")}
        >
          <span>Theme</span>
          <div className="flex items-center gap-1.5 text-[var(--np-text-tertiary)]">
            <span className="text-xs">{themeLabel}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("appearance_bar_size")}
        >
          <span>Control bar size</span>
          <div className="flex items-center gap-1.5 text-[var(--np-text-tertiary)]">
            <span className="text-xs">{barLabel}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("appearance_seek_bar_size")}
        >
          <span>Seek bar thickness</span>
          <div className="flex items-center gap-1.5 text-[var(--np-text-tertiary)]">
            <span className="text-xs">{seekLabel}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <div className="h-px bg-[var(--np-divider)] mx-2 my-1" />

        <ToggleRow
          label="Always on top"
          description="Keep the player window above other apps"
          enabled={alwaysOnTop}
          onToggle={onAlwaysOnTopToggle}
        />
      </div>
    </motion.div>
  );
}
