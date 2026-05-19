import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import ControlBar, {
  type Track,
  type DynamicAudioState,
  type ThumbnailSheet,
  type ImageParams,
  type VideoState,
  type HdrMode,
  type HdrInfo,
  type UpscalingProfile,
  type InterpolationMode,
  type PerfProfileName,
  type ResolvedPerf,
  type AudioFxState,
  type AppearanceState,
  type Chapter,
  type PlaylistItem,
  type LoopMode,
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_VIDEO_STATE,
  DEFAULT_AUDIO_FX,
  DEFAULT_APPEARANCE,
} from "./components/ControlBar";
import JumpToTimeDialog from "./components/JumpToTimeDialog";
import MediaInfoDialog from "./components/MediaInfoDialog";
import OpenSourceDialog from "./components/OpenSourceDialog";
import LoadingSourceOverlay from "./components/LoadingSourceOverlay";
import BufferingBanner from "./components/BufferingBanner";
import RecentSourcesPanel from "./components/RecentSourcesPanel";
import { DENSE_LRU_MAX, denseBucket } from "./components/types";
import { useTheme } from "./hooks/useTheme";
import { log } from "./lib/log";

import SubtitleSettingsPanel, {
  type SubtitleStyle,
  DEFAULT_SUBTITLE_STYLE,
} from "./components/SubtitleSettingsPanel";
import DevTester from "./components/DevTester";
import LibraryModal from "./components/library/LibraryModal";
import GestureLayer from "./components/GestureLayer";
import PipBar from "./components/PipBar";
import AppContextMenu from "./components/AppContextMenu";

/** Lightweight error logger for .catch() handlers on user-facing operations. */
const logErr = (ctx: string) => (e: unknown) => console.warn(`[TracePlayer] ${ctx}:`, e);

type TrackList = { audio: Track[]; subtitle: Track[] };

/** True when the loaded path is a URL (rqbit stream endpoint, direct http/rtsp/rtmp/mms).
 * Network sources get a larger demuxer cache and skip local thumbnail extraction. */
function isNetworkPath(path: string): boolean {
  if (!path) return false;
  const l = path.toLowerCase();
  return ["http://", "https://", "rtsp://", "rtmp://", "rtmps://", "mms://"].some(
    (p) => l.startsWith(p)
  );
}

const DEFAULT_DYNAMIC_AUDIO: DynamicAudioState = {
  enabled: false,
  minDb: -30,
  maxDb: -6,
};

const HIDE_DELAY_MS = 2000;
// Time after controls auto-hide before we tell Rust to hide the WebView2
// host window entirely. While dormant: WebView stops compositing, JS rAF
// throttles to ~1 Hz under Page Visibility, mpv keeps painting. Wake-up
// arrives via the `ui:wake` event from Rust when mpv detects mouse input.
const DORMANCY_DELAY_MS = 4000;

export default function App() {
  const { theme, setTheme } = useTheme();
  const [hasFile, setHasFile] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // Loading splash: covers the transparent window between when the user
  // opens a file and when mpv has actually loaded + started rendering it.
  // Set true at the start of loadPath, cleared when mpv:file-loaded fires
  // (or on a 10 s safety timeout if that event never arrives).
  const [isLoading, setIsLoading] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLoadingState = useCallback(() => {
    setIsLoading(false);
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  }, []);

  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);

  // progress and currentTime are ref-primary: updated at 10Hz by mpv:time-pos
  // but only trigger a React re-render at ~1Hz via displayTime for the time badge.
  // Timeline reads from progressRef directly and updates its own DOM.
  const progressRef = useRef(0);
  const [displayTime, setDisplayTime] = useState(0);
  const displayTimeCounter = useRef(0);
  const [duration, setDuration] = useState(0);

  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<Track[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<string>("auto");
  const [selectedSub, setSelectedSub] = useState<string>("auto");

  const [monoAudio, setMonoAudio] = useState(false);
  const [dynamicAudio, setDynamicAudio] = useState<DynamicAudioState>(DEFAULT_DYNAMIC_AUDIO);

  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [subtitleDelay, setSubtitleDelay] = useState(0); // ms
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState(false);

  const [thumbnails, setThumbnails] = useState<ThumbnailSheet | null>(null);
  // Dense, on-hover thumbnails. Stored in a ref + force-rerender counter so
  // we don't allocate a new Map on every event (300 entries × insert/evict
  // would churn React reconciler hard). Map preserves insertion order, so
  // LRU eviction is just `keys().next().value`.
  const denseThumbsRef = useRef<Map<number, string>>(new Map());
  const [, setDenseTick] = useState(0);

  const [imageParams, setImageParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS);
  const [videoState, setVideoState] = useState<VideoState>(DEFAULT_VIDEO_STATE);
  // A-B loop: null when disabled, set on '[' / ']' keys.
  const [abLoopA, setAbLoopA] = useState<number | null>(null);
  const [abLoopB, setAbLoopB] = useState<number | null>(null);

  // Phase 5b/5d/5f
  const [hdrMode, setHdrMode] = useState<HdrMode>("auto");
  const [hdrInfo, setHdrInfo] = useState<HdrInfo | null>(null);
  const [upscaling, setUpscaling] = useState<UpscalingProfile>("low");
  const [interpolation, setInterpolation] = useState<InterpolationMode>("off");
  const [vsync, setVsync] = useState(true);
  // Windows: exclusive-fullscreen bypasses DWM so VSync isn't gated by the
  // compositor (otherwise V-Sync looks "applied" but stutters anyway).
  // Default on — users on multi-monitor / HDR-mixed setups who hit issues
  // can flip it off in Settings → Video → Frame Smoothing.
  const [exclusiveFullscreen, setExclusiveFullscreen] = useState(true);
  const [perfProfile, setPerfProfile] = useState<PerfProfileName>("auto");
  const [perfEffective, setPerfEffective] = useState<string>("balanced");
  const [onBattery, setOnBattery] = useState(false);
  const [audioFx, setAudioFx] = useState<AudioFxState>(DEFAULT_AUDIO_FX);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [screenshotDir, setScreenshotDir] = useState<string | null>(null);

  // Phase 6: loop + playlist + appearance
  const [loopMode, setLoopMode] = useState<LoopMode>("off");
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [appearance, setAppearance] = useState<AppearanceState>(DEFAULT_APPEARANCE);

  const [pipMode, setPipMode] = useState(false);

  const [deinterlace, setDeinterlace] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [audioDevice, setAudioDevice] = useState("auto");
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [jumpToTimeOpen, setJumpToTimeOpen] = useState(false);
  const [mediaInfoOpen, setMediaInfoOpen] = useState(false);
  const [openSourceOpen, setOpenSourceOpen] = useState(false);
  const [recentPanelOpen, setRecentPanelOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryInitialTab, setLibraryInitialTab] = useState<"settings" | null>(null);
  // Buffering visibility is owned by BufferingBanner (it listens to
  // mpv:paused-for-cache + mpv:torrent-stats itself), so App.tsx no longer
  // needs the bufferingForCache state — kept as a no-op here only because
  // some places still call setBufferingForCache(false) on file-load reset
  // and removing those would leak into unrelated diffs.
  const [, setBufferingForCache] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLocalFile, setIsLocalFile] = useState(false);
  const isLocalFileRef = useRef(false);
  const [hoverPreview, setHoverPreview] = useState(false);
  const hoverPreviewRef = useRef(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const isSeekingRef = useRef(false);
  const isLoadingRef = useRef(false);
  const anyOverlayOpenRef = useRef(false);
  const seekIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const storeRef = useRef<Store | null>(null);
  // True once persistent settings have been loaded — prevents the initial
  // default state from clobbering the saved values via the auto-save effects.
  const storeLoadedRef = useRef(false);
  const [storeLoaded, setStoreLoaded] = useState(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dormancyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDormantRef = useRef(false);
  const seekTargetRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const hasFileRef = useRef(false);
  const barHoveredRef = useRef(false);
  const volumeRef = useRef(80);
  const isMutedRef = useRef(false);
  // loadPath needs a ref because the cli-file listener captures it once at mount;
  // a direct closure would freeze on the first render's loadPath identity.
  const loadPathRef = useRef<((path: string) => Promise<void>) | null>(null);
  // Same trick for the per-file re-apply: the file-loaded listener captures
  // it once at mount but it depends on every "current settings" piece.
  const reapplyForCurrentFileRef = useRef<(() => void) | null>(null);

  const currentTimeRef = useRef(0);
  const abLoopARef = useRef<number | null>(null);
  const abLoopBRef = useRef<number | null>(null);

  // Keep refs in sync with state so event/keyboard handlers don't need to be re-bound.
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { hasFileRef.current = hasFile; }, [hasFile]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  // currentTimeRef is now primary (written by mpv:time-pos directly), no sync needed.
  useEffect(() => { abLoopARef.current = abLoopA; }, [abLoopA]);
  useEffect(() => { abLoopBRef.current = abLoopB; }, [abLoopB]);
  useEffect(() => { isSeekingRef.current = isSeeking; }, [isSeeking]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => {
    anyOverlayOpenRef.current = jumpToTimeOpen || mediaInfoOpen || openSourceOpen || recentPanelOpen || subtitlePanelOpen || libraryOpen;
  }, [jumpToTimeOpen, mediaInfoOpen, openSourceOpen, recentPanelOpen, subtitlePanelOpen, libraryOpen]);
  useEffect(() => { isLocalFileRef.current = isLocalFile; }, [isLocalFile]);
  useEffect(() => { hoverPreviewRef.current = hoverPreview; }, [hoverPreview]);

  // ── mpv event subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    log.info("events", "subscribing to mpv:* events");
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<number>("mpv:time-pos", (e) => {
        const t = e.payload;
        const target = seekTargetRef.current;
        if (target !== null) {
          if (Math.abs(t - target) < 0.5) {
            // Local files only: time-pos at target means the frame is decoded.
            // Non-local seeks use mpv:frame-changed (actual VO frame) instead
            // because time-pos follows the audio clock and can advance while
            // the video output is still frozen during torrent/HTTP seeks.
            if (isLocalFileRef.current) {
              seekTargetRef.current = null;
              if (seekIndicatorTimerRef.current) {
                clearTimeout(seekIndicatorTimerRef.current);
                seekIndicatorTimerRef.current = null;
              }
              setIsSeeking(false);
            }
          } else {
            return;
          }
        }
        // Update refs at full 10Hz rate (Timeline reads these directly)
        currentTimeRef.current = t;
        const d = durationRef.current;
        if (d > 0) progressRef.current = (t / d) * 100;
        // Throttle React re-renders to ~1Hz for the time display badge
        displayTimeCounter.current++;
        if (displayTimeCounter.current % 10 === 0) {
          setDisplayTime(t);
        }
      })
    );

    // Local-file seeks: PLAYBACK_RESTART is reliable (fires once, data is
    // already on disk). Non-local seeks skip this — PLAYBACK_RESTART fires
    // multiple spurious times right after the seek command before any data
    // arrives, so using it for non-local dismissed the spinner in <100 ms.
    // Guard on isSeekingRef: drag seeks (fireDragSeek, isSeeking=false) also
    // trigger PLAYBACK_RESTART. Without this guard, the keyframe-mode seek
    // landing clears seekTargetRef before handleSeekCommit fires, opening a
    // window where time-pos events at the keyframe position bleed through and
    // cause a visible 10-20s position jump before the exact seek resolves.
    unlisteners.push(
      listen<unknown>("mpv:playback-restart", () => {
        if (!isLocalFileRef.current) return;
        if (!isSeekingRef.current) return;
        if (seekIndicatorTimerRef.current) {
          clearTimeout(seekIndicatorTimerRef.current);
          seekIndicatorTimerRef.current = null;
        }
        seekTargetRef.current = null;
        setIsSeeking(false);
      })
    );

    // Non-local seeks (stream / torrent): dismiss the seek spinner only when
    // Rust confirms 5 consecutive rendered video frames after a seek/buffering
    // cycle — not on PLAYBACK_RESTART which fires too early, and not on
    // time-pos which advances with the audio clock even while video is frozen.
    unlisteners.push(
      listen<unknown>("mpv:frame-changed", () => {
        if (isLocalFileRef.current) return; // local uses PLAYBACK_RESTART above
        if (!isSeekingRef.current) return;
        if (seekIndicatorTimerRef.current) {
          clearTimeout(seekIndicatorTimerRef.current);
          seekIndicatorTimerRef.current = null;
        }
        seekTargetRef.current = null;
        setIsSeeking(false);
      })
    );

    unlisteners.push(
      listen<number>("mpv:duration", (e) => {
        log.info("events", `mpv:duration ${e.payload.toFixed(3)}s`);
        setDuration(e.payload);
        // Duration > 0 means mpv has demuxed enough to know the file's
        // length — that's our "playback is real" signal. Drop the
        // loading splash here instead of on file-loaded, because
        // file-loaded for a torrent stream fires while pieces are still
        // being fetched and the controls are functionally dead until
        // the demuxer catches up.
        if (e.payload > 0) clearLoadingState();
      })
    );
    unlisteners.push(
      listen<boolean>("mpv:pause", (e) => {
        log.info("events", `mpv:pause paused=${e.payload}`);
        setIsPlaying(!e.payload);
      })
    );
    unlisteners.push(listen<number>("mpv:volume", (e) => setVolume(Math.round(e.payload))));
    unlisteners.push(
      listen<number>("mpv:speed", (e) => {
        log.debug("events", `mpv:speed ${e.payload}x`);
        setPlaybackSpeed(e.payload);
      })
    );

    unlisteners.push(
      listen<TrackList>("mpv:tracks", (e) => {
        const { audio, subtitle } = e.payload;
        setAudioTracks(audio);
        setSubtitleTracks(subtitle);
        const selA = audio.find((t) => t.selected);
        setSelectedAudio(selA ? String(selA.id) : "auto");
        const selS = subtitle.find((t) => t.selected);
        setSelectedSub(selS ? String(selS.id) : "no");
      })
    );

    unlisteners.push(
      listen<{
        reason: number;
        error: number;
        is_error: boolean;
      }>("mpv:eof", (e) => {
        const { reason, error, is_error } = e.payload;
        log.info("events", `mpv:eof reason=${reason} error=${error}`);
        setIsPlaying(false);
        if (!is_error) return;

        clearLoadingState();
        setBufferingForCache(false);

        setError(
          error === -13 || error === -14
            ? "Network error: couldn't connect to the source"
            : error === -16
            ? "Unsupported format or codec from this URL"
            : `Playback failed (mpv error ${error})`
        );
      })
    );

    // Native "Open with" / 2nd-instance forward — load the file Windows handed us.
    unlisteners.push(
      listen<string>("mpv:cli-file", (e) => {
        log.info("events", `mpv:cli-file ${e.payload}`);
        if (e.payload) loadPathRef.current?.(e.payload);
      })
    );

    // Progressive thumbnail sprite from the headless thumbnailer mpv. The
    // `filled` count grows as tiles are extracted — Timeline gates frame
    // rendering on tileIdx < filled.
    unlisteners.push(
      listen<{
        b64: string;
        count: number;
        filled: number;
        cols: number;
        rows: number;
        tile_width: number;
        tile_height: number;
      }>("mpv:thumbnails-ready", (e) => {
        const p = e.payload;
        log.info(
          "thumb",
          `mpv:thumbnails-ready count=${p.count} filled=${p.filled} cols=${p.cols} rows=${p.rows}`
        );
        setThumbnails({
          src: `data:image/jpeg;base64,${p.b64}`,
          count: p.count,
          filled: p.filled,
          cols: p.cols,
          rows: p.rows,
          tileWidth: p.tile_width,
          tileHeight: p.tile_height,
        });
      })
    );

    // Dense per-tile previews (hover layer). Quantized to 250ms buckets so
    // adjacent pixel-level cursor positions reuse the same dense frame.
    unlisteners.push(
      listen<{ t: number; b64: string; tile_width: number; tile_height: number }>(
        "mpv:thumbnail-tile",
        (e) => {
          const p = e.payload;
          const map = denseThumbsRef.current;
          const key = denseBucket(p.t);
          // Refresh LRU position by deleting then re-inserting.
          if (map.has(key)) map.delete(key);
          map.set(key, `data:image/jpeg;base64,${p.b64}`);
          while (map.size > DENSE_LRU_MAX) {
            const oldest = map.keys().next().value;
            if (oldest === undefined) break;
            map.delete(oldest);
          }
          log.debug("thumb", `dense tile t=${p.t.toFixed(3)} cache_size=${map.size}`);
          setDenseTick((n) => (n + 1) | 0);
        }
      )
    );

    unlisteners.push(
      listen<HdrInfo>("mpv:hdr-info", (e) => setHdrInfo(e.payload))
    );

    unlisteners.push(
      listen<{ title: string | null; time: number }[]>(
        "mpv:chapters",
        (e) => setChapters(e.payload)
      )
    );

    unlisteners.push(
      listen<PlaylistItem[]>("mpv:playlist", (e) => {
        const items = e.payload;
        log.info("events", `mpv:playlist len=${items.length}`);
        setPlaylist(items);
        // Removing the last (currently-playing) entry empties the playlist
        // and unloads the file in mpv. Without this reset the ControlBar
        // keeps rendering with stale duration/progress, the GestureLayer
        // and keyboard handlers still fire seeks at a now-detached file
        // (which is the source of the seek-error spam), and the playlist
        // panel sits over a dead transport.
        if (items.length === 0) {
          log.info("events", "playlist empty, resetting per-file state");
          clearLoadingState();
          setHasFile(false);
          setIsPlaying(false);
          progressRef.current = 0;
          currentTimeRef.current = 0;
          setDisplayTime(0);
          setDuration(0);
          seekTargetRef.current = null;
          setChapters([]);
          setThumbnails(null);
          denseThumbsRef.current.clear();
          setDenseTick((n) => (n + 1) | 0);
          setAbLoopA(null);
          setAbLoopB(null);
          setAudioTracks([]);
          setSubtitleTracks([]);
          setHdrInfo(null);
        }
      })
    );

    // Re-apply per-file state whenever mpv loads a new file. The mpv
    // af chain in particular resets on every loadfile, so playlist
    // auto-advance would otherwise lose AGC / mono / normalize / etc.
    unlisteners.push(
      listen<string>("mpv:file-loaded", (e) => {
        log.info("events", `mpv:file-loaded path=${e.payload}`);
        // mpv has accepted the URL. For local files this is also the
        // moment first-frame is imminent so the splash COULD drop here,
        // but for network sources (torrents in particular) demux often
        // takes 10-30 s more for pieces to land. The mpv:duration > 0
        // listener does the actual splash-clear once playback is real.
        setHasFile(true);
        progressRef.current = 0;
        currentTimeRef.current = 0;
        setDisplayTime(0);
        seekTargetRef.current = null;
        // Reset all seek state: a previous seek (committed or drag) may still
        // be in-flight when the file changes. Without this, isSeeking stays
        // true and blocks all keyboard/UI controls on the new file. Also
        // cancel any pending drag-seek timer so it can't fire a seek against
        // the new file at the old video's position.
        setIsSeeking(false);
        if (seekIndicatorTimerRef.current) {
          clearTimeout(seekIndicatorTimerRef.current);
          seekIndicatorTimerRef.current = null;
        }
        if (dragSeekTimerRef.current !== null) {
          clearTimeout(dragSeekTimerRef.current);
          dragSeekTimerRef.current = null;
        }
        dragSeekPendingRef.current = null;
        setThumbnails(null);
        denseThumbsRef.current.clear();
        setDenseTick((n) => (n + 1) | 0);
        setAbLoopA(null);
        setAbLoopB(null);
        setBufferingForCache(false);
        // Re-apply af chain + subtitle + image params + video state.
        reapplyForCurrentFileRef.current?.();
        // Kick thumbnailer on the freshly loaded path. The auto-advance
        // path needs this — direct loadPath does it itself. Skip when
        // streaming over the network — local thumbnails on a torrent
        // stream would just hammer rqbit's range endpoints.
        const path = e.payload;
        const isNetwork = isNetworkPath(path);
        // mpv's cache resets to the init defaults on every loadfile, so
        // streaming sources need their bigger window re-applied per file.
        invoke("set_stream_cache", { enabled: isNetwork }).catch(() => {});
        // Hover-preview thumbnails: local disk files only. Network sources
        // (http/https CDN, rqbit's 127.0.0.1 stream) skip thumbnailing —
        // range-spamming a torrent sidecar tanks playback and CDN URLs
        // don't need local seek previews.
        const isLocal = path.length > 0 && !isNetwork;
        setIsLocalFile(isLocal);
        if (isLocal && hoverPreviewRef.current) {
          invoke("start_thumbnailing", { path }).catch(() => {});
        }
      })
    );

    unlisteners.push(
      listen<boolean>("mpv:power-state", (e) => setOnBattery(e.payload))
    );

    unlisteners.push(
      listen<boolean>("mpv:hover-preview-enabled", (e) => setHoverPreview(e.payload))
    );

    unlisteners.push(
      listen<boolean>("mpv:paused-for-cache", (e) => {
        setBufferingForCache(e.payload);
      })
    );

    // Backend re-applied a profile (Auto switched as battery flipped).
    // Mirror the resolved settings into our local state so the drill-down
    // pages stay in sync with what mpv is actually doing.
    unlisteners.push(
      listen<ResolvedPerf>("mpv:perf-applied", (e) => {
        const p = e.payload;
        setPerfEffective(p.effective);
        setUpscaling(p.upscaling);
        setInterpolation(p.interpolation);
        setHdrMode(p.hdrMode);
        setVsync(p.vsync);
      })
    );

    return () => {
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
    };
  }, []);

  // Rehydrate React state from mpv on mount. Without this, a Ctrl+R or
  // refresh-button reload leaves mpv playing while React thinks no file
  // is loaded — buffering overlay stops gating, seek can no-op against
  // hasFile=false guards, etc. Listeners are already set up by the
  // previous useEffect; this just seeds the initial state once.
  useEffect(() => {
    type PlayerStateSnapshot = {
      path: string;
      paused: boolean;
      timePos: number;
      duration: number;
      volume: number;
      speed: number;
      playlistPos: number;
      playlist: PlaylistItem[];
      tracks: { audio: Track[]; subtitle: Track[] };
    };
    invoke<PlayerStateSnapshot>("get_player_state")
      .then((s) => {
        if (!s.path) return; // Nothing loaded — fresh boot, normal path.
        log.info("rehydrate", `path=${s.path} timePos=${s.timePos.toFixed(1)} dur=${s.duration.toFixed(1)}`);
        setHasFile(true);
        setIsPlaying(!s.paused);
        currentTimeRef.current = s.timePos;
        setDisplayTime(s.timePos);
        setDuration(s.duration);
        if (s.duration > 0) progressRef.current = (s.timePos / s.duration) * 100;
        setVolume(Math.round(s.volume));
        setPlaybackSpeed(s.speed);
        setPlaylist(s.playlist);
        setAudioTracks(s.tracks.audio);
        setSubtitleTracks(s.tracks.subtitle);
        const selA = s.tracks.audio.find((t) => t.selected);
        setSelectedAudio(selA ? String(selA.id) : "auto");
        const selS = s.tracks.subtitle.find((t) => t.selected);
        setSelectedSub(selS ? String(selS.id) : "no");
      })
      .catch((e) => log.warn("rehydrate", `get_player_state failed: ${e}`));
  }, []);

  // Drag & drop — load first file, append the rest to the playlist.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        const type = event.payload.type;
        if (type === "enter") {
          setIsDragOver(true);
        } else if (type === "leave") {
          setIsDragOver(false);
        } else if (type === "drop") {
          setIsDragOver(false);
          const paths = (event.payload as { paths?: string[] }).paths ?? [];
          if (paths.length === 0) return;
          loadPathRef.current?.(paths[0]);
          if (paths.length > 1) {
            invoke("playlist_add_many", { paths: paths.slice(1) }).catch(() => {});
          }
        }
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // ── persistent settings ─────────────────────────────────────────────────────
  // Load saved subtitle style + delay on mount. The save effects below are
  // gated on `storeLoadedRef` so they don't fire with default values before
  // the initial load completes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await Store.load("trace-player-settings.json");
        if (cancelled) return;
        storeRef.current = s;
        const savedStyle = await s.get<SubtitleStyle>("subtitleStyle");
        if (savedStyle && !cancelled) setSubtitleStyle(savedStyle);
        const savedDelay = await s.get<number>("subtitleDelay");
        if (typeof savedDelay === "number" && !cancelled) setSubtitleDelay(savedDelay);
        const savedImage = await s.get<ImageParams>("imageParams");
        if (savedImage && !cancelled) setImageParams(savedImage);
        const savedVideo = await s.get<VideoState>("videoState");
        if (savedVideo && !cancelled) setVideoState(savedVideo);
        const savedPerf = await s.get<PerfProfileName>("perfProfile");
        if (savedPerf && !cancelled) setPerfProfile(savedPerf);
        const savedHdr = await s.get<HdrMode>("hdrMode");
        if (savedHdr && !cancelled) setHdrMode(savedHdr);
        const savedUp = await s.get<UpscalingProfile>("upscaling");
        if (savedUp && !cancelled) setUpscaling(savedUp);
        const savedInterp = await s.get<InterpolationMode>("interpolation");
        if (savedInterp && !cancelled) setInterpolation(savedInterp);
        const savedVsync = await s.get<boolean>("vsync");
        if (typeof savedVsync === "boolean" && !cancelled) setVsync(savedVsync);
        const savedExFs = await s.get<boolean>("exclusiveFullscreen");
        if (typeof savedExFs === "boolean" && !cancelled) setExclusiveFullscreen(savedExFs);
        const savedFx = await s.get<Partial<AudioFxState>>("audioFx");
        if (savedFx && !cancelled) {
          // Merge with defaults so older stores (no `eq`) don't render as undefined.
          setAudioFx({ ...DEFAULT_AUDIO_FX, ...savedFx, eq: { ...DEFAULT_AUDIO_FX.eq, ...(savedFx.eq ?? {}) } });
        }
        const savedAppearance = await s.get<AppearanceState>("appearance");
        if (savedAppearance && !cancelled) setAppearance(savedAppearance);
        const savedLoop = await s.get<LoopMode>("loopMode");
        if (savedLoop && !cancelled) setLoopMode(savedLoop);
        const savedDir = await s.get<string>("screenshotDir");
        if (savedDir && !cancelled) {
          setScreenshotDir(savedDir);
          invoke("set_screenshot_dir", { path: savedDir }).catch(() => {});
        }
        const savedDeinterlace = await s.get<boolean>("deinterlace");
        if (typeof savedDeinterlace === "boolean" && !cancelled) setDeinterlace(savedDeinterlace);
        const savedAlwaysOnTop = await s.get<boolean>("alwaysOnTop");
        if (savedAlwaysOnTop && !cancelled) {
          setAlwaysOnTop(true);
          getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
        }
        const savedAudioDevice = await s.get<string>("audioDevice");
        if (savedAudioDevice && !cancelled) {
          setAudioDevice(savedAudioDevice);
          invoke("set_audio_device", { name: savedAudioDevice }).catch(() => {});
        }
        const savedRecent = await s.get<string[]>("recentFiles");
        if (savedRecent && !cancelled) setRecentFiles(savedRecent);
        const savedPip = await s.get<boolean>("pipMode");
        if (savedPip && !cancelled) {
          setPipMode(true);
          invoke("enter_pip").catch(() => {});
        }
        const savedCacheLimit = await s.get<number>("torrentCacheLimitBytes");
        if (typeof savedCacheLimit === "number" && savedCacheLimit > 0 && !cancelled) {
          invoke("set_torrent_cache_limit", { bytes: savedCacheLimit }).catch(() => {});
        }
        // (cookies/quality settings removed — yt-dlp support dropped)
      } catch (e) {
        console.warn("[TracePlayer] settings store failed to load:", e);
      } finally {
        storeLoadedRef.current = true;
        setStoreLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced store.save() — individual useEffects call store.set() immediately
  // but the disk write is coalesced so rapid changes don't serialize 20x/sec.
  const debouncedSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveStore = useCallback(() => {
    clearTimeout(debouncedSave.current);
    debouncedSave.current = setTimeout(() => {
      storeRef.current?.save().catch(() => {});
    }, 500);
  }, []);

  useEffect(() => {
    if (!storeLoaded || hasFile) return;
    const timer = setTimeout(() => {
      if (!hasFileRef.current) setLibraryOpen(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [storeLoaded, hasFile]);

  // Save on change (only after the initial load completes — otherwise the
  // first-render defaults would overwrite saved values).
  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("subtitleStyle", subtitleStyle).then(() => saveStore()).catch(() => {});
  }, [subtitleStyle]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("subtitleDelay", subtitleDelay).then(() => saveStore()).catch(() => {});
  }, [subtitleDelay]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("imageParams", imageParams).then(() => saveStore()).catch(() => {});
  }, [imageParams]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("videoState", videoState).then(() => saveStore()).catch(() => {});
  }, [videoState]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("perfProfile", perfProfile).then(() => saveStore()).catch(() => {});
  }, [perfProfile]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("hdrMode", hdrMode).then(() => saveStore()).catch(() => {});
  }, [hdrMode]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("upscaling", upscaling).then(() => saveStore()).catch(() => {});
  }, [upscaling]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("interpolation", interpolation).then(() => saveStore()).catch(() => {});
  }, [interpolation]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("vsync", vsync).then(() => saveStore()).catch(() => {});
  }, [vsync]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("exclusiveFullscreen", exclusiveFullscreen).then(() => saveStore()).catch(() => {});
  }, [exclusiveFullscreen]);

  // Push the exclusive-fs preference into mpv whenever it changes — mpv
  // reads this on the next fullscreen transition, so it takes effect the
  // next time the user goes fullscreen (no restart needed).
  useEffect(() => {
    if (!storeLoadedRef.current) return;
    invoke("set_exclusive_fullscreen", { enabled: exclusiveFullscreen }).catch(() => {});
  }, [exclusiveFullscreen]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("audioFx", audioFx).then(() => saveStore()).catch(() => {});
  }, [audioFx]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("appearance", appearance).then(() => saveStore()).catch(() => {});
  }, [appearance]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("loopMode", loopMode).then(() => saveStore()).catch(() => {});
  }, [loopMode]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("deinterlace", deinterlace).then(() => saveStore()).catch(() => {});
  }, [deinterlace]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("alwaysOnTop", alwaysOnTop).then(() => saveStore()).catch(() => {});
  }, [alwaysOnTop]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("audioDevice", audioDevice).then(() => saveStore()).catch(() => {});
  }, [audioDevice]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("pipMode", pipMode).then(() => saveStore()).catch(() => {});
  }, [pipMode]);


  // Whenever loop mode changes (incl. initial load), push to mpv. Two
  // independent properties — file and playlist — both off when "off".
  useEffect(() => {
    if (!storeLoadedRef.current) return;
    invoke("set_loop_file", { enabled: loopMode === "file" }).catch(() => {});
    invoke("set_loop_playlist", { enabled: loopMode === "playlist" }).catch(() => {});
  }, [loopMode]);

  // After settings are loaded from disk, push them into mpv once. Subsequent
  // changes go through the per-handler invokes; this initial sync handles
  // the cold-start case where the file may load before any handler fires.
  useEffect(() => {
    if (!storeLoaded) return;
    invoke("set_perf_profile", { profile: perfProfile })
      .then((resolved) => {
        const r = resolved as ResolvedPerf | null;
        if (r) {
          setPerfEffective(r.effective);
          setUpscaling(r.upscaling);
          setInterpolation(r.interpolation);
          setHdrMode(r.hdrMode);
          setVsync(r.vsync);
        }
      })
      .catch(() => {});
    // Custom path: manually push per-knob values since perf wasn't applied.
    if (perfProfile === "custom") {
      invoke("set_hdr_mode", { mode: hdrMode }).catch(() => {});
      invoke("set_upscaling", { profile: upscaling }).catch(() => {});
      invoke("set_interpolation", { mode: interpolation }).catch(() => {});
      invoke("set_vsync", { enabled: vsync }).catch(() => {});
    }
    // Audio FX is independent of perf profile.
    pushAudioFx(audioFx, monoAudio, dynamicAudio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeLoaded]);

  // ── auto-hide controls ──────────────────────────────────────────────────────
  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!isPlayingRef.current) return; // never hide while paused
    if (barHoveredRef.current) return; // never hide while hovering controls
    hideTimer.current = setTimeout(() => setShowControls(false), HIDE_DELAY_MS);
  }, [clearHideTimer]);

  // Whenever play state changes, re-evaluate visibility.
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      clearHideTimer();
    } else {
      scheduleHide();
    }
  }, [isPlaying, scheduleHide, clearHideTimer]);

  // Keep controls visible while the subtitle panel is open.
  useEffect(() => {
    if (subtitlePanelOpen) {
      setShowControls(true);
      clearHideTimer();
    } else if (isPlayingRef.current) {
      scheduleHide();
    }
  }, [subtitlePanelOpen, scheduleHide, clearHideTimer]);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  const handleMouseLeave = useCallback(() => {
    if (isPlayingRef.current && !barHoveredRef.current) {
      clearHideTimer();
      setShowControls(false);
    }
  }, [clearHideTimer]);

  const handleBarHoverChange = useCallback(
    (hovering: boolean) => {
      barHoveredRef.current = hovering;
      if (hovering) {
        clearHideTimer();
        setShowControls(true);
      } else {
        scheduleHide();
      }
    },
    [clearHideTimer, scheduleHide]
  );

  // ── WebView dormancy ────────────────────────────────────────────────────────
  // After controls auto-hide, schedule a deeper sleep where the WebView host
  // window is removed entirely (mpv keeps rendering). Any panel open, dialog
  // open, or pause cancels the scheduled dormancy. Wake-up arrives via the
  // `ui:wake` event when Rust sees a MOUSE_MOVE / click / wheel from mpv.
  const clearDormancyTimer = useCallback(() => {
    if (dormancyTimerRef.current) {
      clearTimeout(dormancyTimerRef.current);
      dormancyTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearDormancyTimer();
    if (showControls) return;
    if (!isPlayingRef.current) return;
    if (subtitlePanelOpen || jumpToTimeOpen || mediaInfoOpen) return;
    if (pipMode) return;
    dormancyTimerRef.current = setTimeout(() => {
      isDormantRef.current = true;
      invoke("ui_dormant").catch(() => {});
    }, DORMANCY_DELAY_MS);
    return clearDormancyTimer;
  }, [
    showControls,
    subtitlePanelOpen,
    jumpToTimeOpen,
    mediaInfoOpen,
    pipMode,
    clearDormancyTimer,
  ]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen("ui:wake", () => {
      if (!isDormantRef.current) return;
      isDormantRef.current = false;
      setShowControls(true);
      scheduleHide();
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn(); // effect already cleaned up, immediately unlisten
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [scheduleHide]);

  // ── fullscreen ──────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const fs = await win.isFullscreen();
      log.info("ui", `fullscreen toggle ${fs} -> ${!fs}`);
      await win.setFullscreen(!fs);
      setIsFullscreen(!fs);
    } catch (e) {
      log.err("ui", `fullscreen failed: ${String(e)}`);
      setError(String(e));
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const fs = await win.isFullscreen();
      if (fs) {
        await win.setFullscreen(false);
        setIsFullscreen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  // ── command helpers (callable from keyboard + UI) ───────────────────────────
  const playPause = useCallback(async () => {
    if (!hasFileRef.current) return;
    try {
      if (isPlayingRef.current) {
        log.info("ui", "playPause -> pause");
        await invoke("pause");
      } else {
        log.info("ui", "playPause -> play");
        await invoke("play");
      }
    } catch (e) {
      log.err("ui", `playPause failed: ${String(e)}`);
      setError(String(e));
    }
  }, []);

  const seekRelative = useCallback((delta: number) => {
    if (!hasFileRef.current) return;
    log.info("seek", `relative delta=${delta}s`);
    invoke("seek", { seconds: delta, mode: "relative" }).catch(logErr("seek_relative"));
  }, []);

  // Hover-driven dense thumbnail request. Timeline debounces, so this is
  // only called when the cursor stops moving. Errors are swallowed —
  // cancellations on the backend surface here too and shouldn't toast.
  // Issues both a dense window (radius=30s, ±30 tiles) AND an exact-frame
  // request at the cursor's precise time. The exact frame arrives a beat
  // later but pins the preview to the user's hover position pixel-precise.
  const requestThumbWindow = useCallback((t: number) => {
    if (!hasFileRef.current || !hoverPreviewRef.current) return;
    const d = durationRef.current;
    if (d <= 0 || !isFinite(t)) return;
    log.debug("thumb", `hover settle t=${t.toFixed(3)}s — request window+exact`);
    invoke("request_thumb_window", { t, radius: 30, density: 30 }).catch(() => {});
    invoke("request_thumb_exact", { t }).catch(() => {});
  }, []);

  const seekAbsolutePct = useCallback((pct: number) => {
    if (!hasFileRef.current) return;
    const d = durationRef.current;
    if (d <= 0) return;
    const seconds = (pct / 100) * d;
    seekTargetRef.current = seconds;
    currentTimeRef.current = seconds;
    progressRef.current = pct;
    setDisplayTime(seconds);
    log.info("seek", `absolute pct=${pct.toFixed(2)}% t=${seconds.toFixed(3)}s`);
    invoke("seek", { seconds, mode: "absolute" }).catch(logErr("seek"));
  }, []);

  const stepVolume = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(100, volumeRef.current + delta));
    setVolume(next);
    if (next > 0 && isMutedRef.current) {
      setIsMuted(false);
      invoke("set_mute", { muted: false }).catch(() => {});
    }
    invoke("set_volume", { volume: next }).catch((e) => setError(String(e)));
  }, []);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    setIsMuted(next);
    invoke("set_mute", { muted: next }).catch((e) => setError(String(e)));
  }, []);

  const takeScreenshot = useCallback(() => {
    if (!hasFileRef.current) return;
    invoke("take_screenshot").catch((e) => setError(String(e)));
  }, []);

  const pickScreenshotDir = useCallback(async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      setScreenshotDir(picked);
      await invoke("set_screenshot_dir", { path: picked });
      if (storeRef.current) {
        await storeRef.current.set("screenshotDir", picked);
        saveStore();
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // A-B loop cycle delegates to mpv's built-in `ab-loop` command — it owns
  // the state machine (1st sets A, 2nd sets B, 3rd clears). We read the
  // resulting properties back so the UI button can highlight correctly.
  const cycleAbLoop = useCallback(() => {
    if (!hasFileRef.current) return;
    invoke<{ a: number | null; b: number | null }>("ab_loop_cycle")
      .then((s) => {
        setAbLoopA(s.a);
        setAbLoopB(s.b);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Three-state cycle: off → file → playlist → off. The persistence and
  // mpv-push effects above hook off `loopMode` so we don't have to re-invoke
  // here.
  const cycleLoop = useCallback(() => {
    setLoopMode((cur) => (cur === "off" ? "file" : cur === "file" ? "playlist" : "off"));
  }, []);

  const togglePip = useCallback(() => {
    setPipMode((cur) => {
      const next = !cur;
      invoke(next ? "enter_pip" : "exit_pip").catch((e) => setError(String(e)));
      return next;
    });
  }, []);

  const handleAlwaysOnTopToggle = useCallback(async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    await getCurrentWindow().setAlwaysOnTop(next).catch(() => {});
  }, [alwaysOnTop]);

  const handleDeinterlaceToggle = useCallback(() => {
    const next = !deinterlace;
    setDeinterlace(next);
    invoke("set_deinterlace", { enabled: next }).catch(() => {});
  }, [deinterlace]);

  const handleFrameStep = useCallback((backward: boolean) => {
    if (!hasFileRef.current) return;
    invoke("frame_step", { backward }).catch(() => {});
  }, []);

  const handleAudioDeviceChange = useCallback((name: string) => {
    setAudioDevice(name);
    invoke("set_audio_device", { name }).catch(() => {});
  }, []);

  const addToRecentFiles = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 15);
      storeRef.current?.set("recentFiles", next).then(() => saveStore()).catch(() => {});
      return next;
    });
  }, []);

  const removeFromRecentFiles = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      storeRef.current?.set("recentFiles", next).then(() => saveStore()).catch(() => {});
      return next;
    });
  }, []);

  const handleLoadSubtitle = useCallback(async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [
          { name: "Subtitle", extensions: ["srt", "ass", "vtt", "sub", "ssa", "smi"] },
        ],
      });
      if (typeof path === "string") {
        await invoke("load_subtitle", { path });
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const togglePlaylistPanel = useCallback(() => {
    setLibraryOpen(true);
  }, []);

  // Open file dialog and append everything chosen onto the playlist. If
  // nothing is currently loaded, the first file replaces; the rest queue.
  const handleAddPlaylistFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Video",
            extensions: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "flv", "wmv"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;
      if (!hasFileRef.current) {
        // Cold-start: load the first, queue the rest.
        await loadPathRef.current?.(paths[0]);
        if (paths.length > 1) {
          await invoke("playlist_add_many", { paths: paths.slice(1) });
        }
      } else {
        await invoke("playlist_add_many", { paths });
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handlePlaylistRemove = useCallback((idx: number) => {
    invoke("playlist_remove", { idx }).catch((e) => setError(String(e)));
  }, []);

  const handlePlaylistPlayIndex = useCallback((idx: number) => {
    log.info("load", `playlist_play_index ${idx}`);
    // Return focus to the document body so subsequent Space/k keypresses reach
    // the window handler instead of re-triggering the clicked playlist button.
    (document.activeElement as HTMLElement)?.blur();
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    setIsLoading(true);
    loadingTimerRef.current = setTimeout(() => {
      setIsLoading(false);
      loadingTimerRef.current = null;
    }, 1_000);
    invoke("playlist_play_index", { idx }).catch((e) => {
      clearLoadingState();
      setError(String(e));
    });
  }, [clearLoadingState]);

  const handlePlaylistClear = useCallback(() => {
    invoke("playlist_clear").catch((e) => setError(String(e)));
  }, []);

  const handlePlaylistMove = useCallback((from: number, to: number) => {
    // mpv playlist-move semantics: move element at `from` to before index `to`.
    // If the user is dragging a row downward past its current position, we
    // need to bump the destination because removing `from` shifts everything
    // after it up by one.
    const target = to > from ? to + 1 : to;
    invoke("playlist_move", { from, to: target }).catch((e) => setError(String(e)));
  }, []);

  // ── keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing into an input/textarea/contenteditable.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setLibraryOpen((o) => !o);
        return;
      }

      // Block all playback keys while a spinner is shown (seeking frame not
      // yet decoded, or source still loading). Letting space/arrows through
      // during this window causes mpv to toggle pause or seek on stale state.
      // Also block when any overlay/dialog is open (download, torrent, settings).
      if (isSeekingRef.current || isLoadingRef.current || anyOverlayOpenRef.current) return;

      log.debug("keys", `key=${e.key}`);

      // Show controls on any key press while a file is loaded.
      if (hasFileRef.current) {
        setShowControls(true);
        scheduleHide();
      }

      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          playPause();
          return;
        case "ArrowLeft":
        case "j":
        case "J":
          e.preventDefault();
          seekRelative(-10);
          return;
        case "ArrowRight":
        case "l":
        case "L":
          e.preventDefault();
          seekRelative(10);
          return;
        case "ArrowUp":
          e.preventDefault();
          stepVolume(5);
          return;
        case "ArrowDown":
          e.preventDefault();
          stepVolume(-5);
          return;
        case "m":
        case "M":
          toggleMute();
          return;
        case "f":
        case "F":
          toggleFullscreen();
          return;
        case "Escape":
          exitFullscreen();
          return;
        case "s":
        case "S":
          e.preventDefault();
          takeScreenshot();
          return;
        case "[":
        case "]":
          // Both keys cycle — consistent with users who think of "set A then B".
          e.preventDefault();
          cycleAbLoop();
          return;
        case "\\":
          e.preventDefault();
          if (abLoopARef.current !== null || abLoopBRef.current !== null) {
            setAbLoopA(null);
            setAbLoopB(null);
            invoke("ab_loop_clear").catch(() => {});
          }
          return;
        case ",":
          e.preventDefault();
          invoke("chapter_seek", { delta: -1 }).catch(() => {});
          return;
        case ".":
          e.preventDefault();
          invoke("chapter_seek", { delta: 1 }).catch(() => {});
          return;
        case "n":
        case "N":
          e.preventDefault();
          invoke("playlist_next").catch(() => {});
          return;
        case "p":
        case "P":
          e.preventDefault();
          invoke("playlist_prev").catch(() => {});
          return;
        case "r":
        case "R":
          e.preventDefault();
          cycleLoop();
          return;
        case "g":
        case "G":
          e.preventDefault();
          setJumpToTimeOpen(true);
          return;
        case "i":
        case "I":
          e.preventDefault();
          setMediaInfoOpen(true);
          return;
        case "F8":
          e.preventDefault();
          togglePip();
          return;
        case "v":
        case "V":
          // Recovery: forces a fresh decode + present. Fixes the rare state
          // where audio plays but the video pane is blank after lots of
          // seeking / pause-play / control changes.
          e.preventDefault();
          invoke("force_redraw").catch(() => {});
          return;
        case "<":
          e.preventDefault();
          handleFrameStep(true);
          return;
        case ">":
          e.preventDefault();
          handleFrameStep(false);
          return;
      }

      // Number keys: 0..9 → 0%..90%
      if (e.key >= "0" && e.key <= "9") {
        seekAbsolutePct(parseInt(e.key, 10) * 10);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    playPause,
    seekRelative,
    seekAbsolutePct,
    stepVolume,
    toggleMute,
    toggleFullscreen,
    exitFullscreen,
    scheduleHide,
    takeScreenshot,
    cycleAbLoop,
    cycleLoop,
    handleFrameStep,
    togglePip,
  ]);

  // ── file open + UI handlers ─────────────────────────────────────────────────
  // loadPath only kicks the load — the mpv:file-loaded listener owns
  // resetting per-file UI state, re-applying mpv settings (af/subs/image
  // params/perf), and starting the thumbnailer. Same path runs whether
  // the user picked a file or a playlist auto-advanced into one.
  const loadPath = async (path: string) => {
    log.info("load", `loadPath ${path}`);
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    setIsLoading(true);
    // Archives must route through open_archive — handing a .zip/.7z/.rar
    // straight to mpv crashes the demuxer.
    const lower = path.toLowerCase();
    const isArchive =
      lower.endsWith(".zip") ||
      lower.endsWith(".7z") ||
      lower.endsWith(".rar");
    // Safety timer — if mpv:file-loaded never fires (corrupt/missing
    // codec), drop the splash anyway so the UI isn't stuck. Archives need
    // a longer window because central-directory read + first-entry extract
    // can take a few seconds on a big multi-GB zip.
    loadingTimerRef.current = setTimeout(() => {
      log.warn("load", "splash timeout — clearing");
      setIsLoading(false);
      loadingTimerRef.current = null;
    }, isArchive ? 30_000 : 10_000);
    try {
      if (isArchive) {
        await invoke("open_archive", { url: path, append: false });
      } else {
        await invoke("load_file", { path });
      }
      // React 18 batches these. isPlaying is driven by mpv:pause events
      // from the backend so we don't set it optimistically here.
      setHasFile(true);
      setError(null);
      addToRecentFiles(path);

      // Auto-populate playlist with sibling video files from the same folder.
      if (!isArchive && !isNetworkPath(path)) {
        const sep = path.lastIndexOf("\\") >= 0 ? path.lastIndexOf("\\") : path.lastIndexOf("/");
        if (sep >= 0) {
          const parentDir = path.slice(0, sep);
          try {
            const siblings = await invoke<{ name: string; path: string; size: number }[]>(
              "read_directory_videos",
              { path: parentDir },
            );
            const sorted = siblings
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
              .filter((v) => v.path !== path);
            if (sorted.length > 0) {
              await invoke("playlist_add_many", { paths: sorted.map((v) => v.path) });
            }
          } catch (dirErr) {
            log.warn("load", `auto-populate playlist failed: ${String(dirErr)}`);
          }
        }
      }
    } catch (e) {
      log.err("load", `${isArchive ? "open_archive" : "load_file"} failed: ${String(e)}`);
      setError(String(e));
      clearLoadingState();
    }
  };

  // Keep the ref pointed at the latest closure so external listeners pick up current state.
  loadPathRef.current = loadPath;

  // Reapply every per-file mpv setting that resets on loadfile. Used by both
  // the explicit user-driven loadPath and the playlist auto-advance listener.
  const reapplyForCurrentFile = () => {
    pushAudioFx(audioFx, monoAudio, dynamicAudio);
    invoke("set_subtitle_style", { style: subtitleStyle }).catch(() => {});
    invoke("set_subtitle_delay", { delayMs: subtitleDelay }).catch(() => {});
    invoke("set_image_params", { params: imageParams }).catch(() => {});
    invoke("set_aspect", { ratio: videoState.aspect }).catch(() => {});
    invoke("set_zoom", { zoom: videoState.zoom }).catch(() => {});
    invoke("set_rotate", { degrees: videoState.rotate }).catch(() => {});
    invoke("set_deinterlace", { enabled: deinterlace }).catch(() => {});
    if (perfProfile === "custom") {
      invoke("set_hdr_mode", { mode: hdrMode }).catch(() => {});
      invoke("set_upscaling", { profile: upscaling }).catch(() => {});
      invoke("set_interpolation", { mode: interpolation }).catch(() => {});
      invoke("set_vsync", { enabled: vsync }).catch(() => {});
    } else {
      invoke("set_perf_profile", { profile: perfProfile }).catch(() => {});
    }
  };
  reapplyForCurrentFileRef.current = reapplyForCurrentFile;

  const handleOpenFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Video / Archive",
            extensions: [
              // Video / audio containers
              "mp4",
              "mkv",
              "avi",
              "mov",
              "webm",
              "m4v",
              "ts",
              "flv",
              "wmv",
              "mpg",
              "mpeg",
              "ogv",
              "3gp",
              "m2ts",
              "mts",
              // Archives — routed through open_archive (lazy extract).
              "zip",
              "7z",
              "rar",
            ],
          },
        ],
      });
      if (!selected || typeof selected !== "string") return;
      const lower = selected.toLowerCase();
      const isArchive =
        lower.endsWith(".zip") ||
        lower.endsWith(".7z") ||
        lower.endsWith(".rar");
      if (isArchive) {
        // Same code path as OpenSourceDialog's archive submit, minus the
        // dialog UI. open_archive does extract + playlist_add_many.
        try {
          await invoke("open_archive", { url: selected, append: false });
          setHasFile(true);
          setError(null);
          addToRecentFiles(selected);
        } catch (e) {
          setError(String(e));
        }
      } else {
        await loadPath(selected);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  // Submit handler for the OpenSourceDialog. `append=true` queues into the
  // playlist; `false` replaces the current file. Mirrors loadPath's loading-
  // splash + recents bookkeeping so the user gets the same UX whether they
  // opened a local file or a URL. Errors propagate so the dialog can
  // display them inline instead of swallowing.
  const handleOpenSource = useCallback(
    async (url: string, append: boolean, fileIndex?: number) => {
      log.info("load", `open_source append=${append} url=${url} fileIndex=${fileIndex}`);
      const wasEmpty = !hasFileRef.current;
      const effectiveAppend = append && !wasEmpty;

      // Mid-playback switch: pause immediately so the backend state is
      // correct during the gap before the new file's demuxer-ready signal.
      if (!effectiveAppend && hasFileRef.current && isPlayingRef.current) {
        invoke("pause").catch(() => {});
      }

      if (!append || wasEmpty) {
        if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
        setIsLoading(true);
        loadingTimerRef.current = setTimeout(() => {
          setIsLoading(false);
          loadingTimerRef.current = null;
        }, 30_000);
      }
      try {
        const lower = url.toLowerCase();
        const isArchive =
          lower.endsWith(".zip") ||
          lower.endsWith(".7z") ||
          lower.endsWith(".rar");
        const cmd = isArchive ? "open_archive" : "open_source";
        await invoke(cmd, { url, append: effectiveAppend, fileIndex: fileIndex ?? null });
        if (!append || wasEmpty) {
          setHasFile(true);
          setError(null);
          addToRecentFiles(url);
        }
      } catch (e) {
        clearLoadingState();
        throw e;
      }
    },
    [clearLoadingState]
  );

  const handleVolumeChange = useCallback((v: number) => {
    const prev = volumeRef.current;
    setVolume(v);
    setIsMuted(v === 0);
    invoke("set_volume", { volume: v }).catch((e) => { setVolume(prev); logErr("set_volume")(e); });
    invoke("set_mute", { muted: v === 0 }).catch(logErr("set_mute"));
  }, []);

  const handleMuteToggle = useCallback(() => toggleMute(), [toggleMute]);

  // Live scrubbing: while the user drags the timeline thumb, we want video
  // to follow the cursor instead of waiting until pointer-up. mpv handles
  // rapid seeks fine but each one decodes — so we throttle to ~33 ms (~30
  // Hz) and use `absolute+keyframes` mode (cheap; lands on the nearest
  // keyframe). On pointer-up `handleSeekCommit` fires the precise
  // `absolute` seek so the final landing is exact.
  const dragSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragSeekPendingRef = useRef<number | null>(null);

  const fireDragSeek = useCallback(() => {
    const seconds = dragSeekPendingRef.current;
    dragSeekPendingRef.current = null;
    dragSeekTimerRef.current = null;
    if (seconds === null) return;
    log.debug("seek", `drag fire t=${seconds.toFixed(3)}s (keyframes)`);
    seekTargetRef.current = seconds;
    invoke("seek", { seconds, mode: "absolute+keyframes" }).catch(logErr("seek_keyframes"));
  }, []);

  const handleSeek = useCallback((p: number) => {
    progressRef.current = p;
    const d = durationRef.current;
    if (d <= 0 || !hasFileRef.current) return;
    const seconds = (p / 100) * d;
    currentTimeRef.current = seconds;
    dragSeekPendingRef.current = seconds;
    if (dragSeekTimerRef.current !== null) return;
    dragSeekTimerRef.current = setTimeout(fireDragSeek, 33);
  }, [fireDragSeek]);

  const handleSeekCommit = useCallback((p: number) => {
    // Cancel any pending throttled drag-seek so the exact commit isn't
    // overwritten by a stale keyframes-mode seek that fires after.
    if (dragSeekTimerRef.current !== null) {
      clearTimeout(dragSeekTimerRef.current);
      dragSeekTimerRef.current = null;
    }
    dragSeekPendingRef.current = null;
    log.info("seek", `commit pct=${p.toFixed(2)}%`);
    setIsSeeking(true);
    // Safety fallback — cleared early by mpv:playback-restart (primary) or
    // mpv:time-pos landing at the seek target (paused-seek backup).
    if (seekIndicatorTimerRef.current) clearTimeout(seekIndicatorTimerRef.current);
    seekIndicatorTimerRef.current = setTimeout(() => setIsSeeking(false), 100000);
    seekAbsolutePct(p);
  }, [seekAbsolutePct]);

  useEffect(() => {
    return () => {
      if (dragSeekTimerRef.current !== null) clearTimeout(dragSeekTimerRef.current);
      if (seekIndicatorTimerRef.current !== null) clearTimeout(seekIndicatorTimerRef.current);
    };
  }, []);

  const handleSkipBack = useCallback(() => seekRelative(-10), [seekRelative]);
  const handleSkipForward = useCallback(() => seekRelative(10), [seekRelative]);

  const handleSpeedChange = useCallback((speed: number) => {
    const prev = playbackSpeed;
    setPlaybackSpeed(speed);
    invoke("set_speed", { speed }).catch((e) => { setPlaybackSpeed(prev); logErr("set_speed")(e); });
  }, [playbackSpeed]);

  const handleAudioTrackChange = useCallback((id: string) => {
    const prev = selectedAudio;
    setSelectedAudio(id);
    invoke("set_audio_track", { trackId: id }).catch((e) => { setSelectedAudio(prev); logErr("set_audio_track")(e); });
  }, [selectedAudio]);

  const handleSubtitleTrackChange = useCallback((id: string) => {
    const prev = selectedSub;
    setSelectedSub(id);
    invoke("set_subtitle_track", { trackId: id }).catch((e) => { setSelectedSub(prev); logErr("set_subtitle_track")(e); });
  }, [selectedSub]);

  // Single audio-FX push: unifies mono + dynamic + normalize + night-mode +
  // pitch + audio delay through one backend call so the af chain is
  // rebuilt atomically.
  //
  // Debounced ~60ms so EQ slider drags don't fire 60 mpv `af` rebuilds per
  // second — each rebuild tears down + recreates the lavfi graph, which
  // produces audible/visible stutter. Only the latest (fx, mono, dyn) tuple
  // is committed when the timer fires.
  const audioFxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioFxLatestRef = useRef<{
    fx: AudioFxState;
    mono: boolean;
    dyn: DynamicAudioState;
  } | null>(null);
  const pushAudioFx = useCallback(
    (fx: AudioFxState, mono: boolean, dyn: DynamicAudioState) => {
      audioFxLatestRef.current = { fx, mono, dyn };
      if (audioFxTimerRef.current) clearTimeout(audioFxTimerRef.current);
      audioFxTimerRef.current = setTimeout(() => {
        const latest = audioFxLatestRef.current;
        if (!latest) return;
        if (!latest.fx?.eq) return;
        log.info(
          "audio-fx",
          `push mono=${latest.mono} dyn=${latest.dyn.enabled} normalize=${latest.fx.normalize} night=${latest.fx.nightMode} eq=${latest.fx?.eq?.enabled} eqBands=[${latest.fx?.eq?.bands?.join(",")}] delayMs=${latest.fx.audioDelayMs}`
        );
        invoke("set_audio_fx", {
          mono: latest.mono,
          dynamicEnabled: latest.dyn.enabled,
          minDb: latest.dyn.minDb,
          maxDb: latest.dyn.maxDb,
          normalize: latest.fx.normalize,
          nightMode: latest.fx.nightMode,
          pitchCorrection: latest.fx.pitchCorrection,
          audioDelayMs: latest.fx.audioDelayMs,
          eqEnabled: latest.fx.eq.enabled,
          eqBands: latest.fx.eq.bands,
        }).catch((e) => {
          log.err("audio-fx", `set_audio_fx failed: ${String(e)}`);
          setError(String(e));
        });
      }, 60);
    },
    []
  );
  useEffect(() => {
    return () => {
      if (audioFxTimerRef.current) clearTimeout(audioFxTimerRef.current);
    };
  }, []);

  const handleMonoAudioToggle = useCallback(() => {
    const next = !monoAudio;
    setMonoAudio(next);
    pushAudioFx(audioFx, next, dynamicAudio);
  }, [monoAudio, audioFx, dynamicAudio, pushAudioFx]);

  const handleDynamicAudioChange = useCallback((next: DynamicAudioState) => {
    setDynamicAudio(next);
    pushAudioFx(audioFx, monoAudio, next);
  }, [audioFx, monoAudio, pushAudioFx]);

  const handleAudioFxChange = useCallback((next: AudioFxState) => {
    setAudioFx(next);
    pushAudioFx(next, monoAudio, dynamicAudio);
  }, [monoAudio, dynamicAudio, pushAudioFx]);

  const handleSubtitleStyleChange = (style: SubtitleStyle) => {
    setSubtitleStyle(style);
    invoke("set_subtitle_style", { style }).catch(logErr("set_subtitle_style"));
  };

  const handleSubtitleDelayChange = (delayMs: number) => {
    setSubtitleDelay(delayMs);
    invoke("set_subtitle_delay", { delayMs }).catch(logErr("set_subtitle_delay"));
  };

  const handleOpenSubtitlePanel = useCallback(() => {
    setSubtitlePanelOpen(true);
  }, []);

  const handleImageParamsChange = useCallback((p: ImageParams) => {
    setImageParams(p);
    invoke("set_image_params", { params: p }).catch(logErr("set_image_params"));
  }, []);

  const handleVideoStateChange = useCallback((next: VideoState) => {
    if (next.aspect !== videoState.aspect) {
      invoke("set_aspect", { ratio: next.aspect }).catch(logErr("set_aspect"));
    }
    if (next.zoom !== videoState.zoom) {
      invoke("set_zoom", { zoom: next.zoom }).catch(logErr("set_zoom"));
    }
    if (next.rotate !== videoState.rotate) {
      invoke("set_rotate", { degrees: next.rotate }).catch(logErr("set_rotate"));
    }
    setVideoState(next);
  }, [videoState]);

  // Manual fine-grain knobs. When the user touches any of these directly,
  // the Performance profile flips to "custom" so the umbrella stops
  // overriding their choices on the next power-state change.
  const markCustomIfManaged = () => {
    if (perfProfile !== "custom") setPerfProfile("custom");
  };

  const handleHdrModeChange = useCallback((m: HdrMode) => {
    setHdrMode(m);
    markCustomIfManaged();
    invoke("set_hdr_mode", { mode: m }).catch(logErr("set_hdr_mode"));
  }, [perfProfile]);

  const handleUpscalingChange = useCallback((p: UpscalingProfile) => {
    setUpscaling(p);
    markCustomIfManaged();
    invoke("set_upscaling", { profile: p }).catch(logErr("set_upscaling"));
  }, [perfProfile]);

  const handleInterpolationChange = useCallback((m: InterpolationMode) => {
    setInterpolation(m);
    markCustomIfManaged();
    invoke("set_interpolation", { mode: m }).catch(logErr("set_interpolation"));
  }, [perfProfile]);

  const handleVsyncChange = useCallback((b: boolean) => {
    setVsync(b);
    markCustomIfManaged();
    invoke("set_vsync", { enabled: b }).catch(logErr("set_vsync"));
  }, [perfProfile]);

  // Not gated on perf profile — exclusive fullscreen is a presentation-mode
  // choice, orthogonal to the perf profile umbrella's quality/power knobs.
  const handleExclusiveFullscreenChange = useCallback((b: boolean) => {
    setExclusiveFullscreen(b);
  }, []);

  const handlePerfProfileChange = useCallback((p: PerfProfileName) => {
    setPerfProfile(p);
    invoke<ResolvedPerf | null>("set_perf_profile", { profile: p })
      .then((resolved) => {
        if (resolved) {
          setPerfEffective(resolved.effective);
          setUpscaling(resolved.upscaling);
          setInterpolation(resolved.interpolation);
          setHdrMode(resolved.hdrMode);
          setVsync(resolved.vsync);
        }
      })
      .catch(logErr("set_perf_profile"));
  }, []);

  // Stable callbacks for ControlBar props that were previously inline arrows.
  const openMediaInfo = useCallback(() => setMediaInfoOpen(true), []);
  const openJumpToTime = useCallback(() => setJumpToTimeOpen(true), []);
  const openSourceNetwork = useCallback(() => setOpenSourceOpen(true), []);
  const openSourceRecent = useCallback(() => setRecentPanelOpen(true), []);
  const openLibrary = useCallback(() => {
    setLibraryInitialTab(null);
    setLibraryOpen(true);
  }, []);
  const openSettings = useCallback(() => {
    setLibraryInitialTab("settings");
    setLibraryOpen(true);
  }, []);

  const settingsBundle = useMemo(() => ({
    appearance,
    theme,
    onThemeChange: setTheme,
    hdrMode,
    hdrInfo,
    upscaling,
    interpolation,
    vsync,
    exclusiveFullscreen,
    perfProfile,
    perfEffective,
    onBattery,
    audioFx,
    audioDevice,
    monoAudio,
    dynamicAudio,
    deinterlace,
    screenshotDir,
    alwaysOnTop,
    loopMode,
    onAppearanceChange: setAppearance,
    onHdrModeChange: handleHdrModeChange,
    onUpscalingChange: handleUpscalingChange,
    onInterpolationChange: handleInterpolationChange,
    onVsyncChange: handleVsyncChange,
    onExclusiveFullscreenChange: handleExclusiveFullscreenChange,
    onPerfProfileChange: handlePerfProfileChange,
    onAudioFxChange: handleAudioFxChange,
    onAudioDeviceChange: handleAudioDeviceChange,
    onMonoAudioToggle: handleMonoAudioToggle,
    onDynamicAudioChange: handleDynamicAudioChange,
    onDeinterlaceToggle: handleDeinterlaceToggle,
    onPickScreenshotDir: pickScreenshotDir,
    onAlwaysOnTopToggle: handleAlwaysOnTopToggle,
    onLoopCycle: cycleLoop,
  }), [appearance, theme, setTheme, hdrMode, hdrInfo, upscaling, interpolation, vsync,
       exclusiveFullscreen, perfProfile, perfEffective, onBattery, audioFx,
       audioDevice, monoAudio, dynamicAudio, deinterlace, screenshotDir,
       alwaysOnTop, loopMode,
       setAppearance, handleHdrModeChange, handleUpscalingChange,
       handleInterpolationChange, handleVsyncChange, handleExclusiveFullscreenChange,
       handlePerfProfileChange, handleAudioFxChange, handleAudioDeviceChange,
       handleMonoAudioToggle, handleDynamicAudioChange, handleDeinterlaceToggle,
       pickScreenshotDir, handleAlwaysOnTopToggle, cycleLoop]);

  return (
    <div
      className="w-screen h-screen bg-transparent relative overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: showControls || !hasFile ? "default" : "none" }}
    >
      {/* Pointer-event overlay (touch + mouse). Replaces the simple click-to-play div. */}
      <GestureLayer
        enabled={hasFile && !subtitlePanelOpen && !jumpToTimeOpen && !mediaInfoOpen}
        duration={duration}
        brightness={imageParams.brightness}
        zoom={videoState.zoom}
        volume={volume}
        onPlayPause={playPause}
        onSeekRelative={seekRelative}
        onVolumeChange={handleVolumeChange}
        onBrightnessChange={(b) =>
          handleImageParamsChange({ ...imageParams, brightness: b })
        }
        onSeekAbsolutePct={seekAbsolutePct}
        onZoomChange={(z) =>
          handleVideoStateChange({ ...videoState, zoom: z })
        }
        onDoubleClickFullscreen={toggleFullscreen}
      />

      {/* Empty / no-file state */}
      <AnimatePresence>
        {!hasFile && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950"
          >
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06, duration: 0.3 }}
              className="flex flex-col items-center gap-5"
            >
              <div className="w-20 h-20 flex items-center justify-center">
                <img
                  src="/logo.png"
                  alt="Trace Player"
                  className="w-20 h-20 object-contain drop-shadow-[0_0_18px_rgba(255,255,255,0.08)]"
                  draggable={false}
                />
              </div>
              <div className="text-center">
                <p className="text-white text-sm font-medium tracking-wide">Trace Player</p>
                <p className="text-neutral-500 text-xs mt-1">Open a video file to begin</p>
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={handleOpenFile}
                  className="px-5 py-2 bg-white text-black text-sm font-medium rounded-lg
                             hover:bg-neutral-200 active:scale-95 transition-all duration-100"
                >
                  Open File
                </button>
                <button
                  onClick={() => setOpenSourceOpen(true)}
                  className="px-4 py-2 bg-[var(--np-hover)] text-[var(--np-text)] text-sm font-medium rounded-lg
                              hover:bg-[var(--np-active)] active:scale-95
                             transition-all duration-100"
                >
                  Open URL or Torrent
                </button>
              </div>

              {recentFiles.length > 0 && (
                <div className="mt-2 w-64 max-h-48 overflow-y-auto">
                  <p className="text-neutral-500 text-[10px] uppercase tracking-wider mb-1.5">
                    Recent
                  </p>
                  {recentFiles.slice(0, 10).map((p) => {
                    const isUrl =
                      p.startsWith("http://") ||
                      p.startsWith("https://") ||
                      p.startsWith("magnet:") ||
                      p.startsWith("rtsp://") ||
                      p.startsWith("rtmp://");
                    const display = isUrl ? p : (p.split(/[\\/]/).pop() ?? p);
                    return (
                      <div
                        key={p}
                        className="group flex items-center gap-1 rounded-md
                                   hover:bg-[var(--np-hover)] transition-colors duration-100"
                      >
                        <button
                          onClick={() =>
                            isUrl ? handleOpenSource(p, false) : loadPath(p)
                          }
                          className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-md text-xs
                                     text-neutral-400 hover:text-white truncate cursor-pointer"
                          title={p}
                        >
                          {display}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromRecentFiles(p);
                          }}
                          className="w-5 h-5 mr-1 flex items-center justify-center shrink-0
                                     text-neutral-600 hover:text-red-400
                                     opacity-0 group-hover:opacity-100
                                     transition-opacity duration-100 cursor-pointer"
                          title="Remove from recent"
                          aria-label="Remove from recent"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3 h-3"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Source-loading overlay: torrent first-byte fetches, archive
          first-entry extracts, on-demand cache misses on playlist skip. */}
      <LoadingSourceOverlay />

      {/* Loading splash — covers the transparent gap between loadPath() and
          mpv:file-loaded so the user doesn't stare through the window for
          1-2s while mpv decodes. */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40 flex items-center justify-center
                       bg-neutral-950/85 backdrop-blur-md pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.05, duration: 0.25 }}
              className="flex flex-col items-center gap-3"
            >
              <Loader2 className="w-9 h-9 text-[var(--np-text)] animate-spin" />
              <p className="text-[var(--np-text-secondary)] text-xs tracking-wide select-none">
                Loading…
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buffering banner — shown while mpv is paused-for-cache, OR while
          the user is seeking on a non-local source (stream/torrent). The
          banner owns its own paused-for-cache listener; forcedVisible drives
          it during seeks where paused-for-cache may never fire. */}
      <BufferingBanner
        hasFile={hasFile}
        forcedVisible={isSeeking && !isLocalFile}
      />

      {/* Seek indicator — small top pill for local-file seeks only.
          Non-local seeks use the full centered BufferingBanner above. */}
      <AnimatePresence>
        {hasFile && isSeeking && isLocalFile && (
          <motion.div
            key="seeking"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-40
                       flex items-center gap-2 px-3.5 py-1.5 rounded-full
                       bg-black/75 backdrop-blur-md 
                       text-[var(--np-text)] select-none pointer-events-none"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="text-[12px] font-medium">Seeking…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50
                       bg-red-950/90 text-red-300 text-xs px-4 py-2.5 rounded-lg
                       border border-red-800/50 backdrop-blur-sm cursor-pointer select-none"
            onClick={() => setError(null)}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* PiP minimal control strip — only in PiP mode */}
      <AnimatePresence>
        {hasFile && pipMode && (
          <PipBar
            isPlaying={isPlaying}
            progressRef={progressRef}
            onPlayPause={playPause}
            onExitPip={togglePip}
            onSeekCommit={seekAbsolutePct}
          />
        )}
      </AnimatePresence>

      {/* Control bar — slides up on mouse activity (hidden in PiP mode) */}
      <AnimatePresence>
        {hasFile && showControls && !pipMode && (
          <ControlBar
            isPlaying={isPlaying}
            volume={volume}
            isMuted={isMuted}
            progressRef={progressRef}
            currentTime={displayTime}
            duration={duration}
            playbackSpeed={playbackSpeed}
            isFullscreen={isFullscreen}
            audioTracks={audioTracks}
            subtitleTracks={subtitleTracks}
            selectedAudioId={selectedAudio}
            selectedSubId={selectedSub}
            monoAudio={monoAudio}
            dynamicAudio={dynamicAudio}
            thumbnails={thumbnails}
            denseThumbs={denseThumbsRef.current}
            onHoverWindow={requestThumbWindow}
            imageParams={imageParams}
            videoState={videoState}
            hdrMode={hdrMode}
            hdrInfo={hdrInfo}
            upscaling={upscaling}
            interpolation={interpolation}
            vsync={vsync}
            exclusiveFullscreen={exclusiveFullscreen}
            perfProfile={perfProfile}
            perfEffective={perfEffective}
            onBattery={onBattery}
            audioFx={audioFx}
            abLoopActive={abLoopA !== null || abLoopB !== null}
            appearance={appearance}
            chapters={chapters}
            loopMode={loopMode}
            playlistCount={playlist.length}
            alwaysOnTop={alwaysOnTop}
            onAlwaysOnTopToggle={handleAlwaysOnTopToggle}
            onMediaInfo={openMediaInfo}
            onJumpToTime={openJumpToTime}
            onFrameStep={handleFrameStep}
            onLoopCycle={cycleLoop}
            onPlaylistToggle={togglePlaylistPanel}
            onImageParamsChange={handleImageParamsChange}
            onVideoStateChange={handleVideoStateChange}
            onHdrModeChange={handleHdrModeChange}
            onUpscalingChange={handleUpscalingChange}
            onInterpolationChange={handleInterpolationChange}
            onVsyncChange={handleVsyncChange}
            onExclusiveFullscreenChange={handleExclusiveFullscreenChange}
            onPerfProfileChange={handlePerfProfileChange}
            onAudioFxChange={handleAudioFxChange}
            deinterlace={deinterlace}
            onDeinterlaceToggle={handleDeinterlaceToggle}
            audioDevice={audioDevice}
            onAudioDeviceChange={handleAudioDeviceChange}
            onScreenshot={takeScreenshot}
            onAbLoopCycle={cycleAbLoop}
            onPlayPause={playPause}
            onVolumeChange={handleVolumeChange}
            onMuteToggle={handleMuteToggle}
            onSeek={handleSeek}
            onSeekCommit={handleSeekCommit}
            onSpeedChange={handleSpeedChange}
            onAudioTrackChange={handleAudioTrackChange}
            onSubtitleTrackChange={handleSubtitleTrackChange}
            onOpenSubtitlePanel={handleOpenSubtitlePanel}
            onMonoAudioToggle={handleMonoAudioToggle}
            onDynamicAudioChange={handleDynamicAudioChange}
            onSkipBack={handleSkipBack}
            onSkipForward={handleSkipForward}
            onFullscreenToggle={toggleFullscreen}
            onHoverChange={handleBarHoverChange}
            onOpenFile={handleOpenFile}
            onSourceLocal={handleOpenFile}
            onSourceNetwork={openSourceNetwork}
            onSourceRecent={openSourceRecent}
            onLibraryOpen={openLibrary}
            onOpenSettings={openSettings}
            showThumbnails={isLocalFile && hoverPreview}
          />
        )}
      </AnimatePresence>

      {/* Subtitle settings — slides in from the right */}
      <SubtitleSettingsPanel
        open={subtitlePanelOpen}
        onClose={() => setSubtitlePanelOpen(false)}
        style={subtitleStyle}
        delayMs={subtitleDelay}
        onStyleChange={handleSubtitleStyleChange}
        onDelayChange={handleSubtitleDelayChange}
        onLoadSubtitle={handleLoadSubtitle}
      />

      {/* Playlist is now embedded in LibraryModal as a right-side panel */}

      <OpenSourceDialog
        open={openSourceOpen}
        onSubmit={handleOpenSource}
        onClose={() => setOpenSourceOpen(false)}
      />

      <RecentSourcesPanel
        open={recentPanelOpen}
        recents={recentFiles}
        onPick={(p) => {
          const lower = p.toLowerCase();
          if (
            lower.startsWith("http://") ||
            lower.startsWith("https://") ||
            lower.startsWith("rtsp://") ||
            lower.startsWith("rtmp://") ||
            lower.startsWith("rtmps://") ||
            lower.startsWith("mms://") ||
            lower.startsWith("magnet:")
          ) {
            void handleOpenSource(p, false);
          } else {
            void loadPath(p);
          }
        }}
        onClear={async () => {
          setRecentFiles([]);
          if (storeRef.current) {
            await storeRef.current.set("recentFiles", []);
            saveStore();
          }
        }}
        onClose={() => setRecentPanelOpen(false)}
      />


      <LibraryModal
        open={libraryOpen}
        initialTab={libraryInitialTab}
        settingsBundle={settingsBundle}
        onClose={() => {
          setLibraryOpen(false);
          setLibraryInitialTab(null);
        }}
        onPlayFile={(path) => {
          setLibraryOpen(false);
          void loadPath(path);
        }}
        onPlayTorrent={(magnet, fileIndex) => {
          setLibraryOpen(false);
          void handleOpenSource(magnet, false, fileIndex);
        }}
        playlist={playlist}
        onPlaylistPlayIndex={handlePlaylistPlayIndex}
        onPlaylistRemove={handlePlaylistRemove}
        onPlaylistClear={handlePlaylistClear}
        onPlaylistMove={handlePlaylistMove}
      />

      {/* Jump to time dialog */}
      <JumpToTimeDialog
        open={jumpToTimeOpen}
        duration={duration}
        onSeek={(s) => {
          seekTargetRef.current = s;
          currentTimeRef.current = s;
          setDisplayTime(s);
          if (duration > 0) progressRef.current = (s / duration) * 100;
          invoke("seek", { seconds: s, mode: "absolute" }).catch(logErr("seek"));
        }}
        onClose={() => setJumpToTimeOpen(false)}
      />

      {/* Media info dialog */}
      <MediaInfoDialog
        open={mediaInfoOpen}
        onClose={() => setMediaInfoOpen(false)}
      />

      {/* Drag-over overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            key="drag-overlay"
            className="absolute inset-0 z-40 border-2 border-dashed border-[var(--np-text-tertiary)]
                       bg-[var(--np-hover)] flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-[var(--np-hover)] flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                     className="w-6 h-6 text-[var(--np-text-secondary)]">
                  <path strokeLinecap="round" strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <span className="text-sm text-[var(--np-text-secondary)]">Drop to open</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AppContextMenu
        hasFile={hasFile}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        audioTracks={audioTracks}
        subtitleTracks={subtitleTracks}
        selectedAudioId={selectedAudio}
        selectedSubId={selectedSub}
        disabled={libraryOpen || subtitlePanelOpen || jumpToTimeOpen || mediaInfoOpen || openSourceOpen || recentPanelOpen}
        onPlayPause={playPause}
        onSpeedChange={handleSpeedChange}
        onAudioTrackChange={handleAudioTrackChange}
        onSubtitleTrackChange={handleSubtitleTrackChange}
        onMediaInfo={() => setMediaInfoOpen(true)}
        onAddToPlaylist={hasFile ? handleAddPlaylistFiles : undefined}
      />

      {/* Dev-only: command tester (only mounted in `npm run dev`) */}
      {import.meta.env.DEV && <DevTester />}
    </div>
  );
}
