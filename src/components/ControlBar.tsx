import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Settings,
  Maximize2,
  Minimize2,
  Camera,
  Repeat,
  Repeat1,
  Repeat2,
  ListVideo,
  PinIcon,
  PinOff,
  Info,
  Timer,
} from "lucide-react";

import Timeline from "./controls/Timeline";
import VolumeControl from "./controls/VolumeControl";
import PlaybackButtons from "./controls/PlaybackButtons";
import SettingsMenu from "./controls/settings/SettingsMenu";
import { fmtTime } from "./types";

// Re-exports so existing import paths in App.tsx keep working.
export type {
  Track,
  DynamicAudioState,
  ThumbnailSheet,
  ImageParams,
  VideoState,
  HdrMode,
  HdrInfo,
  UpscalingProfile,
  InterpolationMode,
  PerfProfileName,
  ResolvedPerf,
  AudioFxState,
  Chapter,
  AppearanceState,
  PlaylistItem,
  LoopMode,
} from "./types";
export {
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_VIDEO_STATE,
  DEFAULT_AUDIO_FX,
  DEFAULT_APPEARANCE,
} from "./types";
import type {
  Track,
  DynamicAudioState,
  ThumbnailSheet,
  ImageParams,
  VideoState,
  HdrMode,
  HdrInfo,
  UpscalingProfile,
  InterpolationMode,
  PerfProfileName,
  AudioFxState,
  AppearanceState,
  Chapter,
  LoopMode,
} from "./types";

interface ControlBarProps {
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  isFullscreen: boolean;
  audioTracks: Track[];
  subtitleTracks: Track[];
  selectedAudioId: string;
  selectedSubId: string;
  monoAudio: boolean;
  dynamicAudio: DynamicAudioState;
  thumbnails: ThumbnailSheet | null;
  denseThumbs: Map<number, string>;
  onHoverWindow: (t: number) => void;
  imageParams: ImageParams;
  videoState: VideoState;
  hdrMode: HdrMode;
  hdrInfo: HdrInfo | null;
  upscaling: UpscalingProfile;
  interpolation: InterpolationMode;
  vsync: boolean;
  exclusiveFullscreen: boolean;
  perfProfile: PerfProfileName;
  perfEffective: string;
  onBattery: boolean;
  screenshotDir: string | null;
  audioFx: AudioFxState;
  abLoopActive: boolean;
  appearance: AppearanceState;
  chapters: Chapter[];
  loopMode: LoopMode;
  playlistCount: number;
  onImageParamsChange: (p: ImageParams) => void;
  onVideoStateChange: (v: VideoState) => void;
  onHdrModeChange: (m: HdrMode) => void;
  onUpscalingChange: (p: UpscalingProfile) => void;
  onInterpolationChange: (m: InterpolationMode) => void;
  onVsyncChange: (b: boolean) => void;
  onExclusiveFullscreenChange: (b: boolean) => void;
  onPerfProfileChange: (p: PerfProfileName) => void;
  onAudioFxChange: (f: AudioFxState) => void;
  onAppearanceChange: (a: AppearanceState) => void;
  deinterlace: boolean;
  onDeinterlaceToggle: () => void;
  audioDevice: string;
  onAudioDeviceChange: (name: string) => void;
  onScreenshot: () => void;
  onPickScreenshotDir: () => void;
  onAbLoopCycle: () => void;
  alwaysOnTop: boolean;
  onAlwaysOnTopToggle: () => void;
  onMediaInfo: () => void;
  onJumpToTime: () => void;
  onFrameStep: (backward: boolean) => void;
  onLoopCycle: () => void;
  onPlaylistToggle: () => void;
  onPlayPause: () => void;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  onSeek: (progress: number) => void;
  onSeekCommit: (progress: number) => void;
  onSpeedChange: (speed: number) => void;
  onAudioTrackChange: (id: string) => void;
  onSubtitleTrackChange: (id: string) => void;
  onOpenSubtitlePanel: () => void;
  onMonoAudioToggle: () => void;
  onDynamicAudioChange: (state: DynamicAudioState) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onFullscreenToggle: () => void;
  onHoverChange: (hovering: boolean) => void;
  onOpenFile: () => void;
  onSourceLocal: () => void;
  onSourceNetwork: () => void;
  onSourceRecent: () => void;
  onLibraryOpen: () => void;
  showThumbnails?: boolean;
}

export default function ControlBar(props: ControlBarProps) {
  const {
    isPlaying,
    volume,
    isMuted,
    progress,
    currentTime,
    duration,
    playbackSpeed,
    isFullscreen,
    audioTracks,
    subtitleTracks,
    selectedAudioId,
    selectedSubId,
    monoAudio,
    dynamicAudio,
    thumbnails,
    denseThumbs,
    onHoverWindow,
    imageParams,
    videoState,
    hdrMode,
    hdrInfo,
    upscaling,
    interpolation,
    vsync,
    exclusiveFullscreen,
    perfProfile,
    perfEffective,
    onBattery,
    screenshotDir,
    audioFx,
    abLoopActive,
    appearance,
    chapters,
    loopMode,
    playlistCount,
    onImageParamsChange,
    onVideoStateChange,
    onHdrModeChange,
    onUpscalingChange,
    onInterpolationChange,
    onVsyncChange,
    onExclusiveFullscreenChange,
    onPerfProfileChange,
    onAudioFxChange,
    onAppearanceChange,
    deinterlace,
    onDeinterlaceToggle,
    audioDevice,
    onAudioDeviceChange,
    onScreenshot,
    onPickScreenshotDir,
    alwaysOnTop,
    onAlwaysOnTopToggle,
    onMediaInfo,
    onJumpToTime,
    onFrameStep,
    onAbLoopCycle,
    onLoopCycle,
    onPlaylistToggle,
    onPlayPause,
    onVolumeChange,
    onMuteToggle,
    onSeek,
    onSeekCommit,
    onSpeedChange,
    onAudioTrackChange,
    onSubtitleTrackChange,
    onOpenSubtitlePanel,
    onMonoAudioToggle,
    onDynamicAudioChange,
    onSkipBack,
    onSkipForward,
    onFullscreenToggle,
    onHoverChange,
    onSourceLocal,
    onSourceNetwork,
    onSourceRecent,
    onLibraryOpen,
    showThumbnails = true,
  } = props;

  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (settingsOpen) onHoverChange(true);
  }, [settingsOpen, onHoverChange]);

  const showHdrBadge = hdrInfo && hdrInfo.format !== "SDR";

  // Three width modes. `outerClass` controls the floating container's
  // horizontal extent; `showExtras` decides whether the secondary controls
  // (loop, playlist, screenshot, A-B loop, HDR badge) render at all;
  // `centeredPlayback` swaps the layout so play/pause sits between the two
  // secondary control groups instead of on the left.
  //
  // `showFullExtras` is the additional gate for the rarely-used extras
  // (screenshot, A-B loop, always-on-top, jump-to-time, media-info). They
  // only render in "full" — large mode keeps the bar focused on Loop +
  // Playlist (the two navigation controls) so the user gets the wider
  // layout without clutter; everything still lives in the Settings menu.
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

  const loopActive = loopMode !== "off";
  const LoopIcon = loopMode === "file" ? Repeat1 : Repeat;

  // Hoisted JSX: the three reusable pieces that shuffle around for the
  // small-vs-centered layouts. Declared once so the two return paths below
  // share identical buttons (no drift between layouts).
  const TimeBadges = (
    <div className="flex items-center gap-1 text-xs text-white/50 tabular-nums">
      <span className="text-white/80">{fmtTime(currentTime)}</span>
      <span>/</span>
      <span>{fmtTime(duration)}</span>
      {showHdrBadge && showExtras && (
        <span
          className="ml-2 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide
                     text-amber-200 bg-amber-500/10 border border-amber-400/30
                     rounded select-none"
          title={`${hdrInfo!.gamma} · ${hdrInfo!.primaries}`}
        >
          {hdrInfo!.format}
        </span>
      )}
    </div>
  );

  const ExtraControls = showExtras && (
    <>
      <motion.button
        className={`${btnSize} flex items-center justify-center rounded-lg
                   hover:bg-white/10 cursor-pointer transition-colors duration-100`}
        style={{
          color: loopActive ? "var(--np-accent)" : "rgba(255,255,255,0.6)",
        }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.88 }}
        onClick={onLoopCycle}
        title={
          loopMode === "off"
            ? "Loop off — click to loop file"
            : loopMode === "file"
            ? "Looping file — click for playlist loop"
            : "Looping playlist — click to disable"
        }
      >
        <LoopIcon className={iconSize} />
      </motion.button>

      <motion.button
        className={`${btnSize} relative flex items-center justify-center text-white/60
                   hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                   transition-colors duration-100`}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.88 }}
        onClick={onPlaylistToggle}
        title="Playlist"
      >
        <ListVideo className={iconSize} />
        {playlistCount > 1 && (
          <span
            className="absolute -top-0.5 -right-0.5 px-1 min-w-[14px] h-[14px]
                       text-[8px] leading-none flex items-center justify-center
                       rounded-full font-semibold tabular-nums select-none"
            style={{ background: "var(--np-accent)", color: "#000" }}
          >
            {playlistCount > 99 ? "99+" : playlistCount}
          </span>
        )}
      </motion.button>

      {showFullExtras && (
        <>
          <motion.button
            className={`${btnSize} flex items-center justify-center text-white/60
                       hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                       transition-colors duration-100`}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={onScreenshot}
            title="Screenshot (S)"
          >
            <Camera className={iconSize} />
          </motion.button>

          <motion.button
            className={`${btnSize} flex items-center justify-center rounded-lg
                       hover:bg-white/10 cursor-pointer transition-colors duration-100`}
            style={{
              color: abLoopActive ? "var(--np-accent)" : "rgba(255,255,255,0.6)",
            }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={onAbLoopCycle}
            title="A-B loop ([ or ])"
          >
            <Repeat2 className={iconSize} />
          </motion.button>

          <motion.button
            className={`${btnSize} flex items-center justify-center rounded-lg
                       hover:bg-white/10 cursor-pointer transition-colors duration-100`}
            style={{ color: alwaysOnTop ? "var(--np-accent)" : "rgba(255,255,255,0.6)" }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={onAlwaysOnTopToggle}
            title={alwaysOnTop ? "Always on top — click to disable" : "Always on top"}
          >
            {alwaysOnTop ? <PinIcon className={iconSize} /> : <PinOff className={iconSize} />}
          </motion.button>

          <motion.button
            className={`${btnSize} flex items-center justify-center text-white/60
                       hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                       transition-colors duration-100`}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={onJumpToTime}
            title="Jump to time (G)"
          >
            <Timer className={iconSize} />
          </motion.button>

          <motion.button
            className={`${btnSize} flex items-center justify-center text-white/60
                       hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                       transition-colors duration-100`}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            onClick={onMediaInfo}
            title="Media info (I)"
          >
            <Info className={iconSize} />
          </motion.button>
        </>
      )}
    </>
  );

  const VolumeAndFsAndSettings = (
    <>
      <VolumeControl
        volume={volume}
        muted={isMuted}
        onMuteToggle={onMuteToggle}
        onVolumeChange={onVolumeChange}
      />

      <div className="w-px h-4 bg-white/10 mx-1" />

      <motion.button
        className={`${btnSize} flex items-center justify-center text-white/60
                   hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                   transition-colors duration-100`}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.88 }}
        onClick={onFullscreenToggle}
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
          className={`${btnSize} flex items-center justify-center text-white/60
                     hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                     transition-colors duration-100`}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.88 }}
          onClick={() => setSettingsOpen((o) => !o)}
          title="Settings"
        >
          <motion.div
            animate={{ rotate: settingsOpen ? 60 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Settings className={iconSize} />
          </motion.div>
        </motion.button>

        <SettingsMenu
          open={settingsOpen}
          barSize={barSize}
          onClose={() => setSettingsOpen(false)}
          playbackSpeed={playbackSpeed}
          onSpeedChange={onSpeedChange}
          audioTracks={audioTracks}
          subtitleTracks={subtitleTracks}
          selectedAudioId={selectedAudioId}
          selectedSubId={selectedSubId}
          onAudioTrackChange={onAudioTrackChange}
          onSubtitleTrackChange={onSubtitleTrackChange}
          onOpenSubtitlePanel={onOpenSubtitlePanel}
          monoAudio={monoAudio}
          dynamicAudio={dynamicAudio}
          onMonoAudioToggle={onMonoAudioToggle}
          onDynamicAudioChange={onDynamicAudioChange}
          imageParams={imageParams}
          videoState={videoState}
          onImageParamsChange={onImageParamsChange}
          onVideoStateChange={onVideoStateChange}
          hdrMode={hdrMode}
          hdrInfo={hdrInfo}
          onHdrModeChange={onHdrModeChange}
          upscaling={upscaling}
          onUpscalingChange={onUpscalingChange}
          interpolation={interpolation}
          vsync={vsync}
          exclusiveFullscreen={exclusiveFullscreen}
          onInterpolationChange={onInterpolationChange}
          onVsyncChange={onVsyncChange}
          onExclusiveFullscreenChange={onExclusiveFullscreenChange}
          perfProfile={perfProfile}
          perfEffective={perfEffective}
          onBattery={onBattery}
          screenshotDir={screenshotDir}
          onPerfProfileChange={onPerfProfileChange}
          onPickScreenshotDir={onPickScreenshotDir}
          audioFx={audioFx}
          onAudioFxChange={onAudioFxChange}
          appearance={appearance}
          onAppearanceChange={onAppearanceChange}
          deinterlace={deinterlace}
          onDeinterlaceToggle={onDeinterlaceToggle}
          currentAudioDevice={audioDevice}
          onAudioDeviceChange={onAudioDeviceChange}
          loopMode={loopMode}
          onLoopCycle={onLoopCycle}
          playlistCount={playlistCount}
          onPlaylistToggle={onPlaylistToggle}
          onScreenshot={onScreenshot}
          abLoopActive={abLoopActive}
          onAbLoopCycle={onAbLoopCycle}
          alwaysOnTop={alwaysOnTop}
          onAlwaysOnTopToggle={onAlwaysOnTopToggle}
          onJumpToTime={onJumpToTime}
          onMediaInfo={onMediaInfo}
          onSourceLocal={onSourceLocal}
          onSourceNetwork={onSourceNetwork}
          onSourceRecent={onSourceRecent}
          onLibraryOpen={onLibraryOpen}
        />
      </div>
    </>
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
        if (!settingsOpen) onHoverChange(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full  ${outerClass} bg-[#111]/50 backdrop-blur-xl
                   rounded-2xl px-4 pt-3 pb-3`}
      >
        <Timeline
          progress={progress}
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
          // Large / Full: 3-section flex with centered transport. The two
          // flex-1 wings push the PlaybackButtons exactly to the visual
          // midpoint regardless of how wide each side gets.
          <div className="flex items-center gap-1 mt-2">
            <div className="flex-1 flex items-center gap-1 min-w-0">
              {TimeBadges}
              <div className="w-px h-4 bg-white/10 mx-1" />
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
              {VolumeAndFsAndSettings}
            </div>
          </div>
        ) : (
          // Small: original layout — playback at the left, secondary
          // controls in their existing slots are entirely omitted.
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
            {VolumeAndFsAndSettings}
          </div>
        )}
      </div>
    </motion.div>
  );
}
