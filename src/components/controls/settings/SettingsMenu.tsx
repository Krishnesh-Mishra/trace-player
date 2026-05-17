import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type {
  Track,
  DynamicAudioState,
  ImageParams,
  VideoState,
  SettingsPage,
  HdrMode,
  HdrInfo,
  UpscalingProfile,
  InterpolationMode,
  PerfProfileName,
  AudioFxState,
  PipelineInfo,
  AppearanceState,
  LoopMode,
} from "../../types";
import MainPage from "./MainPage";
import SpeedPage from "./SpeedPage";
import AudioMainPage from "./AudioMainPage";
import AudioTrackPage from "./AudioTrackPage";
import DynamicAudioPage from "./DynamicAudioPage";
import AudioFxPage from "./AudioFxPage";
import SubtitlesPage from "./SubtitlesPage";
import VideoMainPage from "./VideoMainPage";
import ImagePage from "./ImagePage";
import VideoAdjustPage from "./VideoAdjustPage";
import HdrPage from "./HdrPage";
import UpscalingPage from "./UpscalingPage";
import InterpolationPage from "./InterpolationPage";
import PerformancePage from "./PerformancePage";
import AppearancePage from "./AppearancePage";
import AudioDevicePage from "./AudioDevicePage";
import VideoSourcePage from "./VideoSourcePage";
import VideoAppearancePage from "./VideoAppearancePage";
import VideoQualityPage from "./VideoQualityPage";

interface Props {
  open: boolean;
  barSize: string;
  onClose: () => void;
  playbackSpeed: number;
  onSpeedChange: (s: number) => void;
  audioTracks: Track[];
  subtitleTracks: Track[];
  selectedAudioId: string;
  selectedSubId: string;
  onAudioTrackChange: (id: string) => void;
  onSubtitleTrackChange: (id: string) => void;
  onOpenSubtitlePanel: () => void;
  monoAudio: boolean;
  dynamicAudio: DynamicAudioState;
  onMonoAudioToggle: () => void;
  onDynamicAudioChange: (state: DynamicAudioState) => void;
  imageParams: ImageParams;
  onImageParamsChange: (p: ImageParams) => void;
  videoState: VideoState;
  onVideoStateChange: (v: VideoState) => void;
  hdrMode: HdrMode;
  hdrInfo: HdrInfo | null;
  onHdrModeChange: (m: HdrMode) => void;
  upscaling: UpscalingProfile;
  onUpscalingChange: (p: UpscalingProfile) => void;
  interpolation: InterpolationMode;
  vsync: boolean;
  exclusiveFullscreen: boolean;
  onInterpolationChange: (m: InterpolationMode) => void;
  onVsyncChange: (b: boolean) => void;
  onExclusiveFullscreenChange: (b: boolean) => void;
  perfProfile: PerfProfileName;
  perfEffective: string;
  onBattery: boolean;
  screenshotDir: string | null;
  onPerfProfileChange: (p: PerfProfileName) => void;
  onPickScreenshotDir: () => void;
  audioFx: AudioFxState;
  onAudioFxChange: (f: AudioFxState) => void;
  appearance: AppearanceState;
  onAppearanceChange: (a: AppearanceState) => void;
  deinterlace: boolean;
  onDeinterlaceToggle: () => void;
  currentAudioDevice: string;
  onAudioDeviceChange: (name: string) => void;
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
  onSourceLocal: () => void;
  onSourceNetwork: () => void;
  onSourceRecent: () => void;
  onLibraryOpen: () => void;
}

export default function SettingsMenu(props: Props) {
  const { open, onClose, barSize } = props;
  const [page, setPage] = useState<SettingsPage>("main");
  const [direction, setDirection] = useState(1);
  const [pipeline, setPipeline] = useState<PipelineInfo | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setPage("main"), 250);
    return () => clearTimeout(t);
  }, [open]);

  // Refresh pipeline info whenever the user opens the HDR/Upscaling pages —
  // these are the only places it's displayed, so no need to poll continuously.
  useEffect(() => {
    if (page !== "video_hdr" && page !== "video_upscaling") return;
    let active = true;
    invoke<PipelineInfo>("get_pipeline_info")
      .then((info) => { if (active) setPipeline(info); })
      .catch(() => { if (active) setPipeline(null); });
    return () => { active = false; };
  }, [page]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // Skip the toggle button — its onClick handles open/close itself.
      // Without this, clicking the cog while open fires close-on-outside
      // first, then the button onClick re-opens, so the menu never closes.
      if (
        target instanceof Element &&
        target.closest("[data-settings-toggle]")
      ) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  const goTo = (p: SettingsPage) => {
    setDirection(1);
    setPage(p);
  };
  const goBackTo = (p: SettingsPage) => {
    setDirection(-1);
    setPage(p);
  };
  const isFullBar = barSize == "small";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          className={"absolute z-50 w-60 bg-[#111]/85 backdrop-blur-xl rounded-xl  shadow-2xl overflow-hidden " + (!isFullBar ? " bottom-18 -right-4" : " -bottom-2 left-12")}
          initial={{ opacity: 0, scale: 0.88, y: 6, transformOrigin: !isFullBar ? "bottom right" : "bottom left" }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.88, y: 6 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
        >
          <AnimatePresence mode="wait" custom={direction}>
            {page === "main" && (
              <MainPage
                direction={direction}
                playbackSpeed={props.playbackSpeed}
                perfProfile={props.perfProfile}
                onNavigate={goTo}
                showQuickActions={barSize === "small"}
                loopMode={props.loopMode}
                onLoopCycle={props.onLoopCycle}
                playlistCount={props.playlistCount}
                onPlaylistToggle={props.onPlaylistToggle}
                onScreenshot={props.onScreenshot}
                abLoopActive={props.abLoopActive}
                onAbLoopCycle={props.onAbLoopCycle}
                alwaysOnTop={props.alwaysOnTop}
                onAlwaysOnTopToggle={props.onAlwaysOnTopToggle}
                onJumpToTime={props.onJumpToTime}
                onMediaInfo={props.onMediaInfo}
              />
            )}
            {page === "appearance" && (
              <AppearancePage
                direction={direction}
                appearance={props.appearance}
                onChange={props.onAppearanceChange}
                onBack={() => goBackTo("main")}
              />
            )}
            {page === "performance" && (
              <PerformancePage
                direction={direction}
                profile={props.perfProfile}
                effective={props.perfEffective}
                onBattery={props.onBattery}
                screenshotDir={props.screenshotDir}
                onChange={props.onPerfProfileChange}
                onPickScreenshotDir={props.onPickScreenshotDir}
                onBack={() => goBackTo("main")}
              />
            )}
            {page === "speed" && (
              <SpeedPage
                direction={direction}
                playbackSpeed={props.playbackSpeed}
                onSpeedChange={props.onSpeedChange}
                onClose={onClose}
                onBack={() => goBackTo("main")}
              />
            )}
            {page === "audio_main" && (
              <AudioMainPage
                direction={direction}
                audioTracks={props.audioTracks}
                monoAudio={props.monoAudio}
                dynamicAudio={props.dynamicAudio}
                currentAudioDevice={props.currentAudioDevice}
                onMonoAudioToggle={props.onMonoAudioToggle}
                onNavigate={goTo}
                onBack={() => goBackTo("main")}
              />
            )}
            {page === "audio_device" && (
              <AudioDevicePage
                direction={direction}
                currentDevice={props.currentAudioDevice}
                onDeviceChange={props.onAudioDeviceChange}
                onBack={() => goBackTo("audio_main")}
              />
            )}
            {page === "audio_track" && (
              <AudioTrackPage
                direction={direction}
                audioTracks={props.audioTracks}
                selectedAudioId={props.selectedAudioId}
                onAudioTrackChange={props.onAudioTrackChange}
                onClose={onClose}
                onBack={() => goBackTo("audio_main")}
              />
            )}
            {page === "dynamic" && (
              <DynamicAudioPage
                direction={direction}
                dynamicAudio={props.dynamicAudio}
                onDynamicAudioChange={props.onDynamicAudioChange}
                onBack={() => goBackTo("audio_main")}
              />
            )}
            {page === "audio_fx" && (
              <AudioFxPage
                direction={direction}
                fx={props.audioFx}
                onChange={props.onAudioFxChange}
                onBack={() => goBackTo("audio_main")}
              />
            )}
            {page === "subtitles" && (
              <SubtitlesPage
                direction={direction}
                subtitleTracks={props.subtitleTracks}
                selectedSubId={props.selectedSubId}
                onSubtitleTrackChange={props.onSubtitleTrackChange}
                onOpenSubtitlePanel={props.onOpenSubtitlePanel}
                onClose={onClose}
                onBack={() => goBackTo("main")}
              />
            )}
            {page === "video_main" && (
              <VideoMainPage
                direction={direction}
                deinterlace={props.deinterlace}
                onDeinterlaceToggle={props.onDeinterlaceToggle}
                onNavigate={goTo}
                onBack={() => goBackTo("main")}
              />
            )}
            {page === "video_appearance" && (
              <VideoAppearancePage
                direction={direction}
                onNavigate={goTo}
                onBack={() => goBackTo("video_main")}
              />
            )}
            {page === "video_image" && (
              <ImagePage
                direction={direction}
                imageParams={props.imageParams}
                onChange={props.onImageParamsChange}
                onBack={() => goBackTo("video_appearance")}
              />
            )}
            {page === "video_adjust" && (
              <VideoAdjustPage
                direction={direction}
                video={props.videoState}
                onChange={props.onVideoStateChange}
                onBack={() => goBackTo("video_appearance")}
              />
            )}
            {page === "video_quality" && (
              <VideoQualityPage
                direction={direction}
                onNavigate={goTo}
                onBack={() => goBackTo("video_main")}
              />
            )}
            {page === "video_hdr" && (
              <HdrPage
                direction={direction}
                mode={props.hdrMode}
                info={props.hdrInfo}
                pipeline={pipeline}
                onChange={props.onHdrModeChange}
                onBack={() => goBackTo("video_quality")}
              />
            )}
            {page === "video_upscaling" && (
              <UpscalingPage
                direction={direction}
                profile={props.upscaling}
                pipeline={pipeline}
                onChange={props.onUpscalingChange}
                onBack={() => goBackTo("video_quality")}
              />
            )}
            {page === "video_interp" && (
              <InterpolationPage
                direction={direction}
                mode={props.interpolation}
                vsync={props.vsync}
                exclusiveFullscreen={props.exclusiveFullscreen}
                onModeChange={props.onInterpolationChange}
                onVsyncChange={props.onVsyncChange}
                onExclusiveFullscreenChange={props.onExclusiveFullscreenChange}
                onBack={() => goBackTo("video_quality")}
              />
            )}
            {page === "video_source" && (
              <VideoSourcePage
                direction={direction}
                onLocal={() => { onClose(); props.onSourceLocal(); }}
                onNetwork={() => { onClose(); props.onSourceNetwork(); }}
                onRecent={() => { onClose(); props.onSourceRecent(); }}
                onLibrary={() => { onClose(); props.onLibraryOpen(); }}
                onBack={() => goBackTo("video_main")}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
