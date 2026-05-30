import { useEffect, useState, useMemo, memo } from "react";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings,
  Maximize2,
  Minimize2,
  Camera,
  Info,
  Timer,
  Volume2,
  Subtitles,
  Gauge,
  Check,
  FileText,
} from "lucide-react";

import Timeline from "./controls/Timeline";
import VolumeControl from "./controls/VolumeControl";
import PlaybackButtons from "./controls/PlaybackButtons";
import AppearancePanel from "./AppearancePanel";
import {
  fmtTime,
  trackLabel,
  SPEEDS,
  type Track,
  type ThumbnailSheet,
  type Chapter,
  type AppearanceState,
} from "./types";
import type { ThemeChoice } from "../hooks/useTheme";

export type {
  Track,
  ThumbnailSheet,
  Chapter,
  AppearanceState,
} from "./types";
export { DEFAULT_APPEARANCE } from "./types";

interface ControlBarProps {
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  progressRef: React.RefObject<number>;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  isFullscreen: boolean;
  audioTracks: Track[];
  subtitleTracks: Track[];
  selectedAudioId: string;
  selectedSubId: string;
  thumbnails: ThumbnailSheet | null;
  denseThumbs: Map<number, string>;
  onHoverWindow: (t: number) => void;
  appearance: AppearanceState;
  chapters: Chapter[];
  alwaysOnTop: boolean;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
  onAlwaysOnTopToggle: () => void;
  onAppearanceChange: (a: AppearanceState) => void;
  onMediaInfo: () => void;
  onJumpToTime: () => void;
  onFrameStep: (backward: boolean) => void;
  onPlayPause: () => void;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  onSeek: (progress: number) => void;
  onSeekCommit: (progress: number) => void;
  onSpeedChange: (speed: number) => void;
  onAudioTrackChange: (id: string) => void;
  onSubtitleTrackChange: (id: string) => void;
  onOpenSubtitlePanel: () => void;
  onLoadSubtitle: () => void;
  onScreenshot: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onFullscreenToggle: () => void;
  onHoverChange: (hovering: boolean) => void;
  showThumbnails?: boolean;
}

type Popover = "none" | "speed" | "audio" | "subs" | "appearance";

const ControlBar = memo(function ControlBar(props: ControlBarProps) {
  const {
    isPlaying,
    volume,
    isMuted,
    progressRef,
    currentTime,
    duration,
    playbackSpeed,
    isFullscreen,
    audioTracks,
    subtitleTracks,
    selectedAudioId,
    selectedSubId,
    thumbnails,
    denseThumbs,
    onHoverWindow,
    appearance,
    chapters,
    alwaysOnTop,
    theme,
    onThemeChange,
    onAlwaysOnTopToggle,
    onAppearanceChange,
    onMediaInfo,
    onJumpToTime,
    onFrameStep,
    onPlayPause,
    onVolumeChange,
    onMuteToggle,
    onSeek,
    onSeekCommit,
    onSpeedChange,
    onAudioTrackChange,
    onSubtitleTrackChange,
    onOpenSubtitlePanel,
    onLoadSubtitle,
    onScreenshot,
    onSkipBack,
    onSkipForward,
    onFullscreenToggle,
    onHoverChange,
    showThumbnails = true,
  } = props;

  const [popover, setPopover] = useState<Popover>("none");

  useEffect(() => {
    if (popover !== "none") onHoverChange(true);
  }, [popover, onHoverChange]);

  const barSize = appearance.barSize;
  const showExtras = barSize !== "small";
  const showFullExtras = barSize === "full";
  const centeredPlayback = barSize !== "small";
  const outerClass =
    barSize === "small"
      ? "max-w-2xl"
      : barSize === "large"
      ? "w-[70vw] max-w-[1400px]"
      : "w-[calc(100vw-2rem)] max-w-none";

  const btnSize = "w-8 h-8";
  const iconSize = "w-4 h-4";

  const TimeBadges = useMemo(
    () => (
      <div className="flex items-center gap-1 text-xs text-[var(--np-text-tertiary)] tabular-nums">
        <span className="text-[var(--np-text)]">{fmtTime(currentTime)}</span>
        <span>/</span>
        <span>{fmtTime(duration)}</span>
      </div>
    ),
    [currentTime, duration]
  );

  const ExtraControls = useMemo(
    () =>
      showExtras && (
        <>
          {showFullExtras && (
            <>
              <motion.button
                className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                           hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                           transition-colors duration-100`}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.88 }}
                onClick={onScreenshot}
                aria-label="Screenshot"
                title="Screenshot (S)"
              >
                <Camera className={iconSize} />
              </motion.button>

              <motion.button
                className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                           hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                           transition-colors duration-100`}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.88 }}
                onClick={onJumpToTime}
                aria-label="Jump to time"
                title="Jump to time (G)"
              >
                <Timer className={iconSize} />
              </motion.button>

              <motion.button
                className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                           hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                           transition-colors duration-100`}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.88 }}
                onClick={onMediaInfo}
                aria-label="Media info"
                title="Media info (I)"
              >
                <Info className={iconSize} />
              </motion.button>
            </>
          )}
        </>
      ),
    [showExtras, showFullExtras, onScreenshot, onJumpToTime, onMediaInfo]
  );

  // ── Right side: speed / audio / subs / volume / fullscreen / appearance ──
  const RightControls = useMemo(
    () => (
      <>
        {/* Speed */}
        <div className="relative">
          <motion.button
            className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                       hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                       transition-colors duration-100`}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={() => setPopover((p) => (p === "speed" ? "none" : "speed"))}
            aria-label="Playback speed"
            title={`Speed (${playbackSpeed}x)`}
          >
            <Gauge className={iconSize} />
          </motion.button>
          <AnimatePresence>
            {popover === "speed" && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                className="absolute bottom-full right-0 mb-2 w-32 py-1
                           bg-[var(--np-overlay-heavy)] backdrop-blur-xl
                           rounded-xl z-40"
              >
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      onSpeedChange(s);
                      setPopover("none");
                    }}
                    className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer
                                transition-colors duration-75 flex items-center justify-between
                                ${s === playbackSpeed
                                  ? "text-[var(--np-text)] bg-[var(--np-hover)]"
                                  : "text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]"}`}
                  >
                    <span>{s}x</span>
                    {s === playbackSpeed && <Check className="w-3 h-3" />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Audio tracks */}
        {audioTracks.length > 0 && (
          <div className="relative">
            <motion.button
              className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                         hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                         transition-colors duration-100`}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.88 }}
              onClick={() => setPopover((p) => (p === "audio" ? "none" : "audio"))}
              aria-label="Audio track"
              title="Audio track"
            >
              <Volume2 className={iconSize} />
            </motion.button>
            <AnimatePresence>
              {popover === "audio" && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  className="absolute bottom-full right-0 mb-2 min-w-[180px] max-h-60 overflow-y-auto py-1
                             bg-[var(--np-overlay-heavy)] backdrop-blur-xl
                             rounded-xl z-40"
                >
                  {audioTracks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onAudioTrackChange(String(t.id));
                        setPopover("none");
                      }}
                      className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer truncate
                                  transition-colors duration-75
                                  ${String(t.id) === selectedAudioId
                                    ? "text-[var(--np-text)] bg-[var(--np-hover)]"
                                    : "text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]"}`}
                    >
                      {trackLabel(t)}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Subtitles */}
        <div className="relative">
          <motion.button
            className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                       hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                       transition-colors duration-100`}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={() => setPopover((p) => (p === "subs" ? "none" : "subs"))}
            aria-label="Subtitles"
            title="Subtitles"
          >
            <Subtitles className={iconSize} />
          </motion.button>
          <AnimatePresence>
            {popover === "subs" && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                className="absolute bottom-full right-0 mb-2 min-w-[180px] max-h-60 overflow-y-auto py-1
                           bg-[var(--np-overlay-heavy)] backdrop-blur-xl
                           rounded-xl z-40"
              >
                <button
                  onClick={() => {
                    onSubtitleTrackChange("no");
                    setPopover("none");
                  }}
                  className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer
                              transition-colors duration-75
                              ${selectedSubId === "no"
                                ? "text-[var(--np-text)] bg-[var(--np-hover)]"
                                : "text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]"}`}
                >
                  None
                </button>
                {subtitleTracks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      onSubtitleTrackChange(String(t.id));
                      setPopover("none");
                    }}
                    className={`w-full px-3 py-1.5 text-left text-[11px] cursor-pointer truncate
                                transition-colors duration-75
                                ${String(t.id) === selectedSubId
                                  ? "text-[var(--np-text)] bg-[var(--np-hover)]"
                                  : "text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]"}`}
                  >
                    {trackLabel(t)}
                  </button>
                ))}
                <div className="h-px bg-[var(--np-divider)] my-1 mx-2" />
                <button
                  onClick={() => {
                    onLoadSubtitle();
                    setPopover("none");
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px]
                             text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)] cursor-pointer
                             transition-colors duration-75"
                >
                  <FileText className="w-3 h-3 opacity-70" />
                  Load file…
                </button>
                <button
                  onClick={() => {
                    onOpenSubtitlePanel();
                    setPopover("none");
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px]
                             text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)] cursor-pointer
                             transition-colors duration-75"
                >
                  <Settings className="w-3 h-3 opacity-70" />
                  Style & delay…
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <VolumeControl
          volume={volume}
          muted={isMuted}
          onMuteToggle={onMuteToggle}
          onVolumeChange={onVolumeChange}
        />

        <div className="w-px h-4 bg-[var(--np-hover)] mx-1" />

        <motion.button
          className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                     hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100`}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.88 }}
          onClick={onFullscreenToggle}
          aria-label="Fullscreen"
          title="Fullscreen (F)"
        >
          {isFullscreen ? (
            <Minimize2 className={iconSize} />
          ) : (
            <Maximize2 className={iconSize} />
          )}
        </motion.button>

        <div className="relative">
          <motion.button
            data-settings-toggle
            className={`${btnSize} flex items-center justify-center text-[var(--np-text-secondary)]
                       hover:text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                       transition-colors duration-100`}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={() =>
              setPopover((p) => (p === "appearance" ? "none" : "appearance"))
            }
            aria-label="Appearance"
            title="Appearance"
          >
            <motion.div
              animate={{ rotate: popover === "appearance" ? 60 : 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <Settings className={iconSize} />
            </motion.div>
          </motion.button>

          <AppearancePanel
            open={popover === "appearance"}
            onClose={() => setPopover("none")}
            appearance={appearance}
            onAppearanceChange={onAppearanceChange}
            theme={theme}
            onThemeChange={onThemeChange}
            alwaysOnTop={alwaysOnTop}
            onAlwaysOnTopToggle={onAlwaysOnTopToggle}
          />
        </div>
      </>
    ),
    [
      popover,
      playbackSpeed,
      audioTracks,
      subtitleTracks,
      selectedAudioId,
      selectedSubId,
      volume,
      isMuted,
      isFullscreen,
      appearance,
      theme,
      alwaysOnTop,
      onSpeedChange,
      onAudioTrackChange,
      onSubtitleTrackChange,
      onOpenSubtitlePanel,
      onLoadSubtitle,
      onMuteToggle,
      onVolumeChange,
      onFullscreenToggle,
      onAppearanceChange,
      onThemeChange,
      onAlwaysOnTopToggle,
    ]
  );

  return (
    <motion.div
      key="controlbar"
      initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 20, filter: "blur(8px)" }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="absolute bottom-4 left-0 right-0 flex justify-center pb-4 px-4 z-30"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => {
        if (popover === "none") onHoverChange(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full ${outerClass} bg-[var(--np-overlay)] backdrop-blur-xl
                   rounded-2xl px-4 pt-3 pb-3`}
      >
        <Timeline
          progressRef={progressRef}
          duration={duration}
          onSeek={onSeek}
          onSeekCommit={onSeekCommit}
          thumbnails={thumbnails}
          denseThumbs={denseThumbs}
          onHoverWindow={onHoverWindow}
          chapters={chapters}
          size={appearance.seekBarSize}
          markerStyle={appearance.chapterMarkers}
          showThumbnails={showThumbnails}
        />

        {centeredPlayback ? (
          <div className="flex items-center gap-1 mt-2">
            <div className="flex-1 flex items-center gap-1 min-w-0">
              {TimeBadges}
              <div className="w-px h-4 bg-[var(--np-hover)] mx-1" />
              {ExtraControls}
            </div>

            <PlaybackButtons
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onSkipBack={onSkipBack}
              onSkipForward={onSkipForward}
              onFrameStep={onFrameStep}
            />

            <div className="flex-1 flex items-center gap-1 justify-end min-w-0">
              {RightControls}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1 mt-2">
            <PlaybackButtons
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onSkipBack={onSkipBack}
              onSkipForward={onSkipForward}
              onFrameStep={onFrameStep}
            />
            <div className="ml-2">{TimeBadges}</div>
            <div className="flex-1" />
            {RightControls}
          </div>
        )}
      </div>
    </motion.div>
  );
});

export default ControlBar;
