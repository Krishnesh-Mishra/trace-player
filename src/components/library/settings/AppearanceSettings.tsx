import { Select, ListBox } from "@heroui/react";
import type { Key } from "react";
import type {
  AppearanceState,
  BarSize,
  SeekBarSize,
  ChapterMarkerStyle,
} from "../../types";
import {
  APPEARANCE_BARSIZE_OPTIONS,
  APPEARANCE_SEEKBAR_OPTIONS,
  APPEARANCE_CHAPTER_OPTIONS,
} from "../../types";
import type { ThemeChoice } from "../../../hooks/useTheme";
import { THEME_OPTIONS } from "../../../hooks/useTheme";

interface Props {
  appearance: AppearanceState;
  onAppearanceChange: (a: AppearanceState) => void;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
}

export default function AppearanceSettings({ appearance, onAppearanceChange, theme, onThemeChange }: Props) {
  const set = <K extends keyof AppearanceState>(key: K, v: AppearanceState[K]) =>
    onAppearanceChange({ ...appearance, [key]: v });

  return (
    <>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Theme</div>
        <Select
          aria-label="Theme"
          selectedKey={theme}
          onSelectionChange={(key: Key | null) => { if (key != null) onThemeChange(key as ThemeChoice); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {THEME_OPTIONS.map((opt) => (
                <ListBox.Item
                  key={opt.value}
                  id={opt.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {opt.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Bar Size</div>
        <Select
          aria-label="Bar Size"
          selectedKey={appearance.barSize}
          onSelectionChange={(key: Key | null) => { if (key != null) set("barSize", key as BarSize); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {APPEARANCE_BARSIZE_OPTIONS.map((opt) => (
                <ListBox.Item
                  key={opt.value}
                  id={opt.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {opt.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <p className="text-[9px] text-[var(--np-text-muted)] mt-1.5 leading-snug">
          {appearance.barSize === "small"
            ? "Compact bar with the essentials. Play/pause stays on the left."
            : appearance.barSize === "large"
            ? "Wider bar (70%) with every control. Play/pause centered."
            : "Edge-to-edge bar with every control. Play/pause centered."}
        </p>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Seek Bar</div>
        <Select
          aria-label="Seek Bar Size"
          selectedKey={appearance.seekBarSize}
          onSelectionChange={(key: Key | null) => { if (key != null) set("seekBarSize", key as SeekBarSize); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {APPEARANCE_SEEKBAR_OPTIONS.map((opt) => (
                <ListBox.Item
                  key={opt.value}
                  id={opt.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {opt.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Chapter Markers</div>
        <Select
          aria-label="Chapter Markers"
          selectedKey={appearance.chapterMarkers}
          onSelectionChange={(key: Key | null) => { if (key != null) set("chapterMarkers", key as ChapterMarkerStyle); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {APPEARANCE_CHAPTER_OPTIONS.map((opt) => (
                <ListBox.Item
                  key={opt.value}
                  id={opt.value}
                  className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                >
                  {opt.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </>
  );
}
