import { motion } from "framer-motion";
import {
  ChevronRight,
  AudioLines,
  Captions,
  Monitor,
  Gauge,
  Camera,
  Settings2,
  Repeat,
  Repeat1,
  Repeat2,
  ListVideo,
  PinIcon,
  PinOff,
  Info,
  Timer,
} from "lucide-react";
import type { SettingsPage, PerfProfileName, LoopMode } from "../../types";
import { pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  playbackSpeed: number;
  perfProfile: PerfProfileName;
  onNavigate: (page: SettingsPage) => void;
  showQuickActions: boolean;
  loopMode: LoopMode;
  onLoopCycle: () => void;
  playlistCount: number;
  onPlaylistToggle: () => void;
  onScreenshot: () => void;
  abLoopActive: boolean;
  onAbLoopCycle: () => void;
  alwaysOnTop: boolean;
  onAlwaysOnTopToggle: () => void;
  onJumpToTime: () => void;
  onMediaInfo: () => void;
  onOpenSettings: () => void;
}

const PERF_LABELS: Record<PerfProfileName, string> = {
  auto: "Auto",
  battery_saver: "Battery Saver",
  balanced: "Balanced",
  best_quality: "Best Quality",
  custom: "Custom",
};

function QuickActionButton({
  icon,
  title,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      className="relative w-9 h-9 flex items-center justify-center rounded-lg
                 hover:bg-[var(--np-hover)] cursor-pointer transition-colors duration-100"
      style={{ color: active ? "var(--np-accent)" : "rgba(255,255,255,0.7)" }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      title={title}
    >
      {icon}
      {badge !== undefined && badge > 1 && (
        <span
          className="absolute -top-0.5 -right-0.5 px-1 min-w-[14px] h-[14px]
                     text-[8px] leading-none flex items-center justify-center
                     rounded-full font-semibold tabular-nums select-none"
          style={{ background: "var(--np-accent)", color: "#000" }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </motion.button>
  );
}

export default function MainPage({
  direction,
  playbackSpeed,
  perfProfile,
  onNavigate,
  showQuickActions,
  loopMode,
  onLoopCycle,
  playlistCount,
  onPlaylistToggle,
  onScreenshot,
  abLoopActive,
  onAbLoopCycle,
  alwaysOnTop,
  onAlwaysOnTopToggle,
  onJumpToTime,
  onMediaInfo,
  onOpenSettings,
}: Props) {
  const LoopIcon = loopMode === "file" ? Repeat1 : Repeat;
  const loopActive = loopMode !== "off";

  return (
    <motion.div
      key="main"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <div className="px-1 py-1">
        {showQuickActions && (
          <div className="px-2 pt-1 pb-2 border-b border-[var(--np-divider)] mb-1">
            <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] px-1 pb-1.5">
              Quick Actions
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              <QuickActionButton
                icon={<LoopIcon className="w-4 h-4" />}
                title={
                  loopMode === "off"
                    ? "Loop off — click to loop file"
                    : loopMode === "file"
                    ? "Looping file — click for playlist loop"
                    : "Looping playlist — click to disable"
                }
                active={loopActive}
                onClick={onLoopCycle}
              />
              <QuickActionButton
                icon={<ListVideo className="w-4 h-4" />}
                title="Playlist"
                badge={playlistCount}
                onClick={onPlaylistToggle}
              />
              <QuickActionButton
                icon={<Camera className="w-4 h-4" />}
                title="Screenshot (S)"
                onClick={onScreenshot}
              />
              <QuickActionButton
                icon={<Repeat2 className="w-4 h-4" />}
                title="A-B loop ([ or ])"
                active={abLoopActive}
                onClick={onAbLoopCycle}
              />
              <QuickActionButton
                icon={
                  alwaysOnTop ? (
                    <PinIcon className="w-4 h-4" />
                  ) : (
                    <PinOff className="w-4 h-4" />
                  )
                }
                title={
                  alwaysOnTop
                    ? "Always on top — click to disable"
                    : "Always on top"
                }
                active={alwaysOnTop}
                onClick={onAlwaysOnTopToggle}
              />
              <QuickActionButton
                icon={<Timer className="w-4 h-4" />}
                title="Jump to time (G)"
                onClick={onJumpToTime}
              />
              <QuickActionButton
                icon={<Info className="w-4 h-4" />}
                title="Media info (I)"
                onClick={onMediaInfo}
              />
            </div>
          </div>
        )}

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("performance")}
        >
          <span className="flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Performance
          </span>
          <div className="flex items-center gap-1.5 text-[var(--np-text-tertiary)]">
            <span className="text-xs">{PERF_LABELS[perfProfile]}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("speed")}
        >
          <span>Playback Speed</span>
          <div className="flex items-center gap-1.5 text-[var(--np-text-tertiary)]">
            <span className="text-xs">{playbackSpeed}×</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("video_main")}
        >
          <span className="flex items-center gap-2">
            <Monitor className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Video
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--np-text-tertiary)]" />
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("audio_main")}
        >
          <span className="flex items-center gap-2">
            <AudioLines className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Audio
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--np-text-tertiary)]" />
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("subtitles")}
        >
          <span className="flex items-center gap-2">
            <Captions className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Subtitles
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--np-text-tertiary)]" />
        </button>


        <div className="h-px bg-[var(--np-divider)] mx-2 my-1" />

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={onOpenSettings}
        >
          <span className="flex items-center gap-2">
            <Settings2 className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Settings
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--np-text-tertiary)]" />
        </button>
      </div>
    </motion.div>
  );
}
