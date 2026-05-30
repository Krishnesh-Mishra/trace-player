import { motion } from "framer-motion";
import type {
  AppearanceState,
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
  onAppearanceChange: (next: AppearanceState) => void;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
  alwaysOnTop: boolean;
  onAlwaysOnTopToggle: () => void;
  onBack: () => void;
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
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)]">
        {label}
      </span>
      <div className="flex bg-[var(--np-hover)] rounded-lg p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 px-2 py-1.5 text-[11px] rounded-md cursor-pointer
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

export default function SettingsPage({
  direction,
  appearance,
  onAppearanceChange,
  theme,
  onThemeChange,
  alwaysOnTop,
  onAlwaysOnTopToggle,
  onBack,
}: Props) {
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

      <div className="pb-2">
        <div className="flex flex-col gap-1.5 px-3 py-2">
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

        <div className="px-1">
          <ToggleRow
            label="Always on top"
            description="Keep the player window above other apps"
            enabled={alwaysOnTop}
            onToggle={onAlwaysOnTopToggle}
          />
        </div>
      </div>
    </motion.div>
  );
}
