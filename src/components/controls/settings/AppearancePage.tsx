import { motion } from "framer-motion";
import type {
  AppearanceState,
  BarSize,
  SeekBarSize,
  ChapterMarkerStyle,
  AccentColor,
} from "../../types";
import {
  ACCENT_PALETTE,
  APPEARANCE_BARSIZE_OPTIONS,
  APPEARANCE_SEEKBAR_OPTIONS,
  APPEARANCE_CHAPTER_OPTIONS,
} from "../../types";
import { BackHeader, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  appearance: AppearanceState;
  onChange: (a: AppearanceState) => void;
  onBack: () => void;
}

export default function AppearancePage({
  direction,
  appearance,
  onChange,
  onBack,
}: Props) {
  const set = <K extends keyof AppearanceState>(key: K, v: AppearanceState[K]) =>
    onChange({ ...appearance, [key]: v });

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
      <BackHeader label="Appearance" onClick={onBack} />

      <div className="px-3 py-3 space-y-4">
        <Section label="Bar Size">
          <PillRow<BarSize>
            value={appearance.barSize}
            options={APPEARANCE_BARSIZE_OPTIONS}
            onChange={(v) => set("barSize", v)}
          />
          <p className="text-[9px] text-white/40 mt-1.5 leading-snug">
            {appearance.barSize === "small"
              ? "Compact bar with the essentials. Play/pause stays on the left."
              : appearance.barSize === "large"
              ? "Wider bar (70%) with every control. Play/pause centered."
              : "Edge-to-edge bar with every control. Play/pause centered."}
          </p>
        </Section>

        <Section label="Seek Bar">
          <PillRow<SeekBarSize>
            value={appearance.seekBarSize}
            options={APPEARANCE_SEEKBAR_OPTIONS}
            onChange={(v) => set("seekBarSize", v)}
          />
        </Section>

        <Section label="Chapter Markers">
          <PillRow<ChapterMarkerStyle>
            value={appearance.chapterMarkers}
            options={APPEARANCE_CHAPTER_OPTIONS}
            onChange={(v) => set("chapterMarkers", v)}
          />
        </Section>

        <Section label="Accent Color">
          <div className="flex items-center gap-2 flex-wrap">
            {(Object.keys(ACCENT_PALETTE) as AccentColor[]).map((k) => {
              const palette = ACCENT_PALETTE[k];
              const selected = appearance.accent === k;
              return (
                <button
                  key={k}
                  className={`w-6 h-6 rounded-full cursor-pointer transition-all duration-100
                              ring-offset-1 ring-offset-[#111] ${
                                selected ? "ring-2 ring-white scale-110" : "hover:scale-105"
                              }`}
                  style={{ background: palette.hex }}
                  title={palette.label}
                  onClick={() => set("accent", k)}
                />
              );
            })}
          </div>
        </Section>
      </div>
    </motion.div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function PillRow<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map((opt) => {
        const sel = opt.value === value;
        return (
          <button
            key={opt.value}
            className={`px-2.5 py-1 text-[10px] rounded-md cursor-pointer
                        transition-colors duration-100 ${
                          sel
                            ? "bg-[var(--np-accent-soft)] text-[var(--np-accent)] border border-[var(--np-accent)]/40"
                            : "bg-white/5 text-white/70 hover:bg-white/10 border border-transparent"
                        }`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
