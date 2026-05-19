import { useState } from "react";
import { Settings2, Palette, Monitor, AudioLines, Gauge, Download } from "lucide-react";
import GeneralSettings from "./settings/GeneralSettings";
import AppearanceSettings from "./settings/AppearanceSettings";
import VideoSettings from "./settings/VideoSettings";
import AudioSettings from "./settings/AudioSettings";
import PerformanceSettings from "./settings/PerformanceSettings";
import TorrentSettings from "./settings/TorrentSettings";
import type {
  AppearanceState,
  HdrMode,
  HdrInfo,
  UpscalingProfile,
  InterpolationMode,
  PerfProfileName,
  AudioFxState,
  DynamicAudioState,
  LoopMode,
} from "../types";
import type { ThemeChoice } from "../../hooks/useTheme";

export interface SettingsBundle {
  // Values
  appearance: AppearanceState;
  theme: ThemeChoice;
  hdrMode: HdrMode;
  hdrInfo: HdrInfo | null;
  upscaling: UpscalingProfile;
  interpolation: InterpolationMode;
  vsync: boolean;
  exclusiveFullscreen: boolean;
  perfProfile: PerfProfileName;
  perfEffective: string;
  onBattery: boolean;
  audioFx: AudioFxState;
  audioDevice: string;
  monoAudio: boolean;
  dynamicAudio: DynamicAudioState;
  deinterlace: boolean;
  screenshotDir: string | null;
  alwaysOnTop: boolean;
  loopMode: LoopMode;
  // Handlers
  onThemeChange: (t: ThemeChoice) => void;
  onAppearanceChange: (a: AppearanceState) => void;
  onHdrModeChange: (m: HdrMode) => void;
  onUpscalingChange: (p: UpscalingProfile) => void;
  onInterpolationChange: (m: InterpolationMode) => void;
  onVsyncChange: (b: boolean) => void;
  onExclusiveFullscreenChange: (b: boolean) => void;
  onPerfProfileChange: (p: PerfProfileName) => void;
  onAudioFxChange: (f: AudioFxState) => void;
  onAudioDeviceChange: (name: string) => void;
  onMonoAudioToggle: () => void;
  onDynamicAudioChange: (s: DynamicAudioState) => void;
  onDeinterlaceToggle: () => void;
  onPickScreenshotDir: () => void;
  onAlwaysOnTopToggle: () => void;
  onLoopCycle: () => void;
}

type CategoryKey = "general" | "appearance" | "video" | "audio" | "performance" | "torrent";

const CATEGORIES: { key: CategoryKey; label: string; icon: typeof Settings2 }[] = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "appearance", label: "Appearance", icon: Palette },
  { key: "video", label: "Video", icon: Monitor },
  { key: "audio", label: "Audio", icon: AudioLines },
  { key: "performance", label: "Performance", icon: Gauge },
  { key: "torrent", label: "Torrent", icon: Download },
];

interface Props {
  settings: SettingsBundle;
}

export default function SettingsPanel({ settings }: Props) {
  const [active, setActive] = useState<CategoryKey>("general");

  return (
    <div className="flex flex-1 min-w-0 h-full">
      {/* Category sidebar */}
      <div className="w-44 h-full bg-[var(--np-surface-alt)] flex flex-col shrink-0 py-4 px-2 space-y-0.5">
        {CATEGORIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px]
                       cursor-pointer transition-colors duration-100 ${
                         active === key
                           ? "bg-[var(--np-hover)] text-[var(--np-text)]"
                           : "text-[var(--np-text-tertiary)] hover:text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]"
                       }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 min-w-0 h-full bg-[var(--np-bg)] overflow-y-auto px-6 py-5 space-y-6">
        {active === "general" && (
          <GeneralSettings
            alwaysOnTop={settings.alwaysOnTop}
            onAlwaysOnTopToggle={settings.onAlwaysOnTopToggle}
            screenshotDir={settings.screenshotDir}
            onPickScreenshotDir={settings.onPickScreenshotDir}
            loopMode={settings.loopMode}
            onLoopCycle={settings.onLoopCycle}
          />
        )}
        {active === "appearance" && (
          <AppearanceSettings
            appearance={settings.appearance}
            onAppearanceChange={settings.onAppearanceChange}
            theme={settings.theme}
            onThemeChange={settings.onThemeChange}
          />
        )}
        {active === "video" && (
          <VideoSettings
            hdrMode={settings.hdrMode}
            hdrInfo={settings.hdrInfo}
            onHdrModeChange={settings.onHdrModeChange}
            vsync={settings.vsync}
            onVsyncChange={settings.onVsyncChange}
            exclusiveFullscreen={settings.exclusiveFullscreen}
            onExclusiveFullscreenChange={settings.onExclusiveFullscreenChange}
            deinterlace={settings.deinterlace}
            onDeinterlaceToggle={settings.onDeinterlaceToggle}
          />
        )}
        {active === "audio" && (
          <AudioSettings
            audioFx={settings.audioFx}
            onAudioFxChange={settings.onAudioFxChange}
            audioDevice={settings.audioDevice}
            onAudioDeviceChange={settings.onAudioDeviceChange}
            monoAudio={settings.monoAudio}
            onMonoAudioToggle={settings.onMonoAudioToggle}
            dynamicAudio={settings.dynamicAudio}
            onDynamicAudioChange={settings.onDynamicAudioChange}
          />
        )}
        {active === "performance" && (
          <PerformanceSettings
            perfProfile={settings.perfProfile}
            perfEffective={settings.perfEffective}
            onBattery={settings.onBattery}
            onPerfProfileChange={settings.onPerfProfileChange}
            upscaling={settings.upscaling}
            onUpscalingChange={settings.onUpscalingChange}
            interpolation={settings.interpolation}
            onInterpolationChange={settings.onInterpolationChange}
          />
        )}
        {active === "torrent" && <TorrentSettings />}
      </div>
    </div>
  );
}
