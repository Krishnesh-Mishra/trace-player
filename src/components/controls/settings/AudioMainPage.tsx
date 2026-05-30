import { motion } from "framer-motion";
import { ChevronRight, Activity, Sliders, Speaker } from "lucide-react";
import type { Track, SettingsPage, DynamicAudioState } from "../../types";
import { BackHeader, ToggleRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  audioTracks: Track[];
  monoAudio: boolean;
  dynamicAudio: DynamicAudioState;
  currentAudioDevice: string;
  onMonoAudioToggle: () => void;
  onNavigate: (page: SettingsPage) => void;
  onBack: () => void;
}

export default function AudioMainPage({
  direction,
  audioTracks,
  monoAudio,
  dynamicAudio,
  currentAudioDevice,
  onMonoAudioToggle,
  onNavigate,
  onBack,
}: Props) {
  const showTrackRow = audioTracks.length > 1;

  return (
    <motion.div
      key="audio_main"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Audio" onClick={onBack} />
      <div className="px-1 py-1">
        {showTrackRow && (
          <button
            className="w-full flex items-center justify-between px-3 py-2.5
                       text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                       transition-colors duration-100"
            onClick={() => onNavigate("audio_track")}
          >
            <span>Audio Track</span>
            <ChevronRight className="w-3.5 h-3.5 text-[var(--np-text-tertiary)]" />
          </button>
        )}

        <ToggleRow
          label="Mono Audio"
          description="Collapse to a single channel"
          enabled={monoAudio}
          onToggle={onMonoAudioToggle}
        />

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("dynamic")}
        >
          <span className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Dynamic Audio
          </span>
          <div className="flex items-center gap-1.5 text-[var(--np-text-tertiary)]">
            <span className="text-[10px]">{dynamicAudio.enabled ? "On" : "Off"}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("audio_fx")}
        >
          <span className="flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Audio FX
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--np-text-tertiary)]" />
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("audio_device")}
        >
          <span className="flex items-center gap-2">
            <Speaker className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Output Device
          </span>
          <div className="flex items-center gap-1.5 text-[var(--np-text-tertiary)]">
            <span className="text-[10px] truncate max-w-20">
              {currentAudioDevice === "auto" ? "Auto" : currentAudioDevice.split("/").pop()}
            </span>
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          </div>
        </button>
      </div>
    </motion.div>
  );
}
