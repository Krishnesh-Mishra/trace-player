import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import Database from "@tauri-apps/plugin-sql";

import TitleBar from "./components/TitleBar";
import ControlBar, {
  type Track,
  type ThumbnailSheet,
  type Chapter,
  type AppearanceState,
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
import GestureLayer from "./components/GestureLayer";
import PipBar from "./components/PipBar";
import AppContextMenu from "./components/AppContextMenu";

const logErr = (ctx: string) => (e: unknown) => console.warn(`[TracePlayer] ${ctx}:`, e);

export interface WatchHistoryEntry {
  id: number;
  path: string;
  position: number;
  duration: number;
  subtitle_path: string | null;
  played_at: number;
}

let _dbPromise: ReturnType<typeof Database.load> | null = null;
function getDb() {
  if (!_dbPromise) _dbPromise = Database.load("sqlite:library.db");
  return _dbPromise;
}

type TrackList = { audio: Track[]; subtitle: Track[] };

function isNetworkPath(path: string): boolean {
  if (!path) return false;
  const l = path.toLowerCase();
  return ["http://", "https://", "rtsp://", "rtmp://", "rtmps://", "mms://"].some(
    (p) => l.startsWith(p)
  );
}

const HIDE_DELAY_MS = 2000;
const DORMANCY_DELAY_MS = 4000;
// Recent history caps for the lite build: keep 50 rows, surface the top 10.
const HISTORY_LIMIT = 50;
const RECENT_VISIBLE = 10;

export default function App() {
  const { theme, setTheme } = useTheme();
  const [hasFile, setHasFile] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
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

  const progressRef = useRef(0);
  const [displayTime, setDisplayTime] = useState(0);
  const displayTimeCounter = useRef(0);
  const [duration, setDuration] = useState(0);

  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<Track[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<string>("auto");
  const [selectedSub, setSelectedSub] = useState<string>("auto");

  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState(false);

  const [thumbnails, setThumbnails] = useState<ThumbnailSheet | null>(null);
  const denseThumbsRef = useRef<Map<number, string>>(new Map());
  const [, setDenseTick] = useState(0);

  const [chapters, setChapters] = useState<Chapter[]>([]);

  const [appearance, setAppearance] = useState<AppearanceState>(DEFAULT_APPEARANCE);

  const [pipMode, setPipMode] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([]);
  const [jumpToTimeOpen, setJumpToTimeOpen] = useState(false);
  const [mediaInfoOpen, setMediaInfoOpen] = useState(false);
  const [openSourceOpen, setOpenSourceOpen] = useState(false);
  const [recentPanelOpen, setRecentPanelOpen] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
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
  const storeLoadedRef = useRef(false);

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
  const loadPathRef = useRef<((path: string) => Promise<void>) | null>(null);
  const reapplyForCurrentFileRef = useRef<(() => void) | null>(null);
  const currentFilePathRef = useRef("");
  const lastPositionSaveRef = useRef(0);

  const currentTimeRef = useRef(0);

  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { hasFileRef.current = hasFile; }, [hasFile]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isSeekingRef.current = isSeeking; }, [isSeeking]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => {
    anyOverlayOpenRef.current =
      jumpToTimeOpen || mediaInfoOpen || openSourceOpen || recentPanelOpen || subtitlePanelOpen;
  }, [jumpToTimeOpen, mediaInfoOpen, openSourceOpen, recentPanelOpen, subtitlePanelOpen]);
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
        currentTimeRef.current = t;
        const d = durationRef.current;
        if (d > 0) progressRef.current = (t / d) * 100;
        displayTimeCounter.current++;
        if (displayTimeCounter.current % 10 === 0) {
          setDisplayTime(t);
        }
        const now = Date.now();
        if (now - lastPositionSaveRef.current > 30_000 && currentFilePathRef.current) {
          lastPositionSaveRef.current = now;
          getDb().then(db => db.execute(
            "UPDATE watch_history SET position = $1, duration = $2 WHERE path = $3",
            [t, durationRef.current, currentFilePathRef.current]
          )).catch(() => {});
        }
      })
    );

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

    unlisteners.push(
      listen<unknown>("mpv:frame-changed", () => {
        if (isLocalFileRef.current) return;
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
        setDuration(e.payload);
        if (e.payload > 0) clearLoadingState();
      })
    );
    unlisteners.push(
      listen<boolean>("mpv:pause", (e) => setIsPlaying(!e.payload))
    );
    unlisteners.push(listen<number>("mpv:volume", (e) => setVolume(Math.round(e.payload))));
    unlisteners.push(listen<number>("mpv:speed", (e) => setPlaybackSpeed(e.payload)));

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
      listen<{ reason: number; error: number; is_error: boolean }>("mpv:eof", (e) => {
        const { error, is_error } = e.payload;
        setIsPlaying(false);
        if (!is_error) {
          const p = currentFilePathRef.current;
          if (p) {
            getDb().then(db => db.execute(
              "UPDATE watch_history SET position = 0 WHERE path = $1", [p]
            )).catch(() => {});
          }
          return;
        }
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

    unlisteners.push(
      listen<string>("mpv:cli-file", (e) => {
        if (e.payload) loadPathRef.current?.(e.payload);
      })
    );

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

    unlisteners.push(
      listen<{ t: number; b64: string; tile_width: number; tile_height: number }>(
        "mpv:thumbnail-tile",
        (e) => {
          const p = e.payload;
          const map = denseThumbsRef.current;
          const key = denseBucket(p.t);
          if (map.has(key)) map.delete(key);
          map.set(key, `data:image/jpeg;base64,${p.b64}`);
          while (map.size > DENSE_LRU_MAX) {
            const oldest = map.keys().next().value;
            if (oldest === undefined) break;
            map.delete(oldest);
          }
          setDenseTick((n) => (n + 1) | 0);
        }
      )
    );

    unlisteners.push(
      listen<{ title: string | null; time: number }[]>(
        "mpv:chapters",
        (e) => setChapters(e.payload)
      )
    );

    unlisteners.push(
      listen<string>("mpv:file-loaded", (e) => {
        const prevPath = currentFilePathRef.current;
        const prevTime = currentTimeRef.current;
        const prevDur = durationRef.current;
        if (prevPath && prevTime > 5) {
          getDb().then(db => db.execute(
            "UPDATE watch_history SET position = $1, duration = $2 WHERE path = $3",
            [prevTime, prevDur, prevPath]
          )).catch(() => {});
        }
        setHasFile(true);
        progressRef.current = 0;
        currentTimeRef.current = 0;
        setDisplayTime(0);
        seekTargetRef.current = null;
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
        setBufferingForCache(false);
        reapplyForCurrentFileRef.current?.();
        const path = e.payload;
        currentFilePathRef.current = path;
        const isNetwork = isNetworkPath(path);
        invoke("set_stream_cache", { enabled: isNetwork }).catch(() => {});
        getDb().then(db => db.select<WatchHistoryEntry[]>(
          "SELECT position, duration, subtitle_path FROM watch_history WHERE path = $1", [path]
        )).then(rows => {
          const entry = rows[0];
          if (!entry) return;
          if (entry.position > 10 && entry.duration > 0 && entry.position < entry.duration - 30) {
            invoke("seek", { seconds: entry.position, mode: "absolute" }).catch(() => {});
          }
          if (entry.subtitle_path) {
            invoke("load_subtitle", { path: entry.subtitle_path }).catch(() => {
              getDb().then(db => db.execute(
                "UPDATE watch_history SET subtitle_path = NULL WHERE path = $1", [path]
              )).catch(() => {});
            });
          }
        }).catch(() => {});
        const isLocal = path.length > 0 && !isNetwork;
        setIsLocalFile(isLocal);
        if (isLocal && hoverPreviewRef.current) {
          invoke("start_thumbnailing", { path }).catch(() => {});
        }
      })
    );

    unlisteners.push(
      listen<boolean>("mpv:hover-preview-enabled", (e) => setHoverPreview(e.payload))
    );

    unlisteners.push(
      listen<boolean>("mpv:paused-for-cache", (e) => {
        setBufferingForCache(e.payload);
      })
    );

    return () => {
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
    };
  }, []);

  // Rehydrate from mpv on mount.
  useEffect(() => {
    type PlayerStateSnapshot = {
      path: string;
      paused: boolean;
      timePos: number;
      duration: number;
      volume: number;
      speed: number;
      tracks: { audio: Track[]; subtitle: Track[] };
    };
    const rehydrate = () => {
      invoke<PlayerStateSnapshot>("get_player_state")
        .then((s) => {
          if (!s.path) return;
          setHasFile(true);
          setIsPlaying(!s.paused);
          currentTimeRef.current = s.timePos;
          setDisplayTime(s.timePos);
          setDuration(s.duration);
          if (s.duration > 0) progressRef.current = (s.timePos / s.duration) * 100;
          setVolume(Math.round(s.volume));
          setPlaybackSpeed(s.speed);
          setAudioTracks(s.tracks.audio);
          setSubtitleTracks(s.tracks.subtitle);
          const selA = s.tracks.audio.find((t) => t.selected);
          setSelectedAudio(selA ? String(selA.id) : "auto");
          const selS = s.tracks.subtitle.find((t) => t.selected);
          setSelectedSub(selS ? String(selS.id) : "no");
        })
        .catch(() => {});
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const handle = requestAnimationFrame(() => {
      if (ric) ric(rehydrate);
      else setTimeout(rehydrate, 0);
    });
    return () => cancelAnimationFrame(handle);
  }, []);

  // CLI file check
  useEffect(() => {
    invoke<string | null>("take_cli_file")
      .then((path) => {
        if (path) {
          setIsLoading(true);
          loadPathRef.current?.(path);
        }
      })
      .catch(() => {})
      .finally(() => setInitialCheckDone(true));
  }, []);

  // Drag & drop — load first file only (no playlist queue in lite).
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
        const savedAppearance = await s.get<AppearanceState>("appearance");
        if (savedAppearance && !cancelled) setAppearance({ ...DEFAULT_APPEARANCE, ...savedAppearance });
        const savedAlwaysOnTop = await s.get<boolean>("alwaysOnTop");
        if (savedAlwaysOnTop && !cancelled) {
          setAlwaysOnTop(true);
          getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
        }
        if (!cancelled) {
          const db = await getDb();
          const rows = await db.select<WatchHistoryEntry[]>(
            `SELECT * FROM watch_history ORDER BY played_at DESC LIMIT ${HISTORY_LIMIT}`
          );
          setWatchHistory(rows);
        }
        const savedPip = await s.get<boolean>("pipMode");
        if (savedPip && !cancelled) {
          setPipMode(true);
          invoke("enter_pip").catch(() => {});
        }
      } catch (e) {
        console.warn("[TracePlayer] settings store failed to load:", e);
      } finally {
        storeLoadedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const debouncedSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveStore = useCallback(() => {
    clearTimeout(debouncedSave.current);
    debouncedSave.current = setTimeout(() => {
      storeRef.current?.save().catch(() => {});
    }, 500);
  }, []);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("subtitleStyle", subtitleStyle).then(() => saveStore()).catch(() => {});
  }, [subtitleStyle, saveStore]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("subtitleDelay", subtitleDelay).then(() => saveStore()).catch(() => {});
  }, [subtitleDelay, saveStore]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("appearance", appearance).then(() => saveStore()).catch(() => {});
  }, [appearance, saveStore]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("alwaysOnTop", alwaysOnTop).then(() => saveStore()).catch(() => {});
  }, [alwaysOnTop, saveStore]);

  useEffect(() => {
    if (!storeLoadedRef.current || !storeRef.current) return;
    storeRef.current.set("pipMode", pipMode).then(() => saveStore()).catch(() => {});
  }, [pipMode, saveStore]);

  // ── auto-hide controls ──────────────────────────────────────────────────────
  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!isPlayingRef.current) return;
    if (barHoveredRef.current) return;
    hideTimer.current = setTimeout(() => setShowControls(false), HIDE_DELAY_MS);
  }, [clearHideTimer]);

  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      clearHideTimer();
    } else {
      scheduleHide();
    }
  }, [isPlaying, scheduleHide, clearHideTimer]);

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
  }, [showControls, subtitlePanelOpen, jumpToTimeOpen, mediaInfoOpen, pipMode, clearDormancyTimer]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen("ui:wake", () => {
      if (isDormantRef.current) isDormantRef.current = false;
      if (hasFileRef.current) {
        setShowControls(true);
        scheduleHide();
      }
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
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
      await win.setFullscreen(!fs);
      setIsFullscreen(!fs);
    } catch (e) {
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
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let active = true;
    let pending = false;
    const win = getCurrentWindow();
    const unlisten = win.onResized(() => {
      if (!pending) {
        pending = true;
        invoke("resize_mpv_to_parent").finally(() => { pending = false; });
      }
      win.isFullscreen().then((fs) => { if (active) setIsFullscreen(fs); }).catch(() => {});
    });
    return () => {
      active = false;
      unlisten.then((f) => f());
    };
  }, []);

  // ── command helpers ─────────────────────────────────────────────────────────
  const playPause = useCallback(() => {
    if (!hasFileRef.current) return;
    const wasPlaying = isPlayingRef.current;
    setIsPlaying(!wasPlaying);
    isPlayingRef.current = !wasPlaying;
    invoke(wasPlaying ? "pause" : "play").catch((e) => {
      setIsPlaying(wasPlaying);
      isPlayingRef.current = wasPlaying;
      setError(String(e));
    });
  }, []);

  const seekRelative = useCallback((delta: number) => {
    if (!hasFileRef.current) return;
    invoke("seek", { seconds: delta, mode: "relative" }).catch(logErr("seek_relative"));
  }, []);

  const requestThumbWindow = useCallback((t: number) => {
    if (!hasFileRef.current || !hoverPreviewRef.current) return;
    const d = durationRef.current;
    if (d <= 0 || !isFinite(t)) return;
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

  const handleFrameStep = useCallback((backward: boolean) => {
    if (!hasFileRef.current) return;
    invoke("frame_step", { backward }).catch(() => {});
  }, []);

  const upsertWatchHistory = useCallback(async (path: string) => {
    try {
      const db = await getDb();
      await db.execute(
        `INSERT INTO watch_history (path, played_at) VALUES ($1, strftime('%s','now'))
         ON CONFLICT(path) DO UPDATE SET played_at = strftime('%s','now')`,
        [path]
      );
      await db.execute(
        `DELETE FROM watch_history WHERE id NOT IN (
           SELECT id FROM watch_history ORDER BY played_at DESC LIMIT ${HISTORY_LIMIT}
         )`
      );
      const rows = await db.select<WatchHistoryEntry[]>(
        `SELECT * FROM watch_history ORDER BY played_at DESC LIMIT ${HISTORY_LIMIT}`
      );
      setWatchHistory(rows);
    } catch {
      /* ignore */
    }
  }, []);

  const removeFromWatchHistory = useCallback(async (path: string) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM watch_history WHERE path = $1", [path]);
      setWatchHistory((prev) => prev.filter((e) => e.path !== path));
    } catch {
      /* ignore */
    }
  }, []);

  const handleLoadSubtitle = useCallback(async () => {
    try {
      const subPath = await open({
        multiple: false,
        filters: [
          { name: "Subtitle", extensions: ["srt", "ass", "vtt", "sub", "ssa", "smi"] },
        ],
      });
      if (typeof subPath === "string") {
        await invoke("load_subtitle", { path: subPath });
        const videoPath = currentFilePathRef.current;
        if (videoPath) {
          const db = await getDb();
          await db.execute(
            "UPDATE watch_history SET subtitle_path = $1 WHERE path = $2",
            [subPath, videoPath]
          );
        }
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ── keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }

      if (isDormantRef.current) {
        isDormantRef.current = false;
        invoke("ui_wake").catch(() => {});
        setShowControls(true);
        scheduleHide();
        return;
      }

      if (isSeekingRef.current || isLoadingRef.current || anyOverlayOpenRef.current) return;

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
        case ",":
          e.preventDefault();
          invoke("chapter_seek", { delta: -1 }).catch(() => {});
          return;
        case ".":
          e.preventDefault();
          invoke("chapter_seek", { delta: 1 }).catch(() => {});
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

      if (e.key >= "0" && e.key <= "9") {
        seekAbsolutePct(parseInt(e.key, 10) * 10);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    playPause, seekRelative, seekAbsolutePct, stepVolume, toggleMute,
    toggleFullscreen, exitFullscreen, scheduleHide, takeScreenshot,
    handleFrameStep, togglePip,
  ]);

  // ── file open ───────────────────────────────────────────────────────────────
  const loadPath = async (path: string) => {
    currentFilePathRef.current = path;
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    setIsLoading(true);
    loadingTimerRef.current = setTimeout(() => {
      setIsLoading(false);
      loadingTimerRef.current = null;
    }, 10_000);
    try {
      await invoke("load_file", { path });
      setHasFile(true);
      setError(null);
      upsertWatchHistory(path);
    } catch (e) {
      setError(String(e));
      clearLoadingState();
    }
  };

  loadPathRef.current = loadPath;

  const reapplyForCurrentFile = () => {
    invoke("set_subtitle_style", { style: subtitleStyle }).catch(() => {});
    invoke("set_subtitle_delay", { delayMs: subtitleDelay }).catch(() => {});
  };
  reapplyForCurrentFileRef.current = reapplyForCurrentFile;

  const handleOpenFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Video",
            extensions: [
              "mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "flv", "wmv",
              "mpg", "mpeg", "ogv", "3gp", "m2ts", "mts",
            ],
          },
        ],
      });
      if (!selected || typeof selected !== "string") return;
      await loadPath(selected);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleOpenSource = useCallback(
    async (url: string, _append: boolean) => {
      const wasEmpty = !hasFileRef.current;
      if (hasFileRef.current && isPlayingRef.current) {
        invoke("pause").catch(() => {});
      }
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      setIsLoading(true);
      loadingTimerRef.current = setTimeout(() => {
        setIsLoading(false);
        loadingTimerRef.current = null;
      }, 30_000);
      try {
        await invoke("open_source", { url, append: false, fileIndex: null });
        if (wasEmpty || !hasFileRef.current) {
          setHasFile(true);
        }
        setError(null);
        upsertWatchHistory(url);
      } catch (e) {
        clearLoadingState();
        throw e;
      }
    },
    [clearLoadingState, upsertWatchHistory]
  );

  const handleVolumeChange = useCallback((v: number) => {
    const prev = volumeRef.current;
    setVolume(v);
    setIsMuted(v === 0);
    invoke("set_volume", { volume: v }).catch((e) => { setVolume(prev); logErr("set_volume")(e); });
    invoke("set_mute", { muted: v === 0 }).catch(logErr("set_mute"));
  }, []);

  const handleMuteToggle = useCallback(() => toggleMute(), [toggleMute]);

  const dragSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragSeekPendingRef = useRef<number | null>(null);

  const fireDragSeek = useCallback(() => {
    const seconds = dragSeekPendingRef.current;
    dragSeekPendingRef.current = null;
    dragSeekTimerRef.current = null;
    if (seconds === null) return;
    seekTargetRef.current = seconds;
    invoke("seek", { seconds, mode: "absolute+keyframes" }).catch(logErr("seek_keyframes"));
  }, []);

  const handleSeek = useCallback((p: number) => {
    progressRef.current = p;
    const d = durationRef.current;
    if (d <= 0 || !hasFileRef.current) return;
    const seconds = (p / 100) * d;
    currentTimeRef.current = seconds;
    seekTargetRef.current = seconds;
    dragSeekPendingRef.current = seconds;
    if (dragSeekTimerRef.current !== null) return;
    dragSeekTimerRef.current = setTimeout(fireDragSeek, 33);
  }, [fireDragSeek]);

  const handleSeekCommit = useCallback((p: number) => {
    if (dragSeekTimerRef.current !== null) {
      clearTimeout(dragSeekTimerRef.current);
      dragSeekTimerRef.current = null;
    }
    dragSeekPendingRef.current = null;
    setIsSeeking(true);
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

  const handleSubtitleStyleChange = (style: SubtitleStyle) => {
    setSubtitleStyle(style);
    invoke("set_subtitle_style", { style }).catch(logErr("set_subtitle_style"));
  };

  const handleSubtitleDelayChange = (delayMs: number) => {
    setSubtitleDelay(delayMs);
    invoke("set_subtitle_delay", { delayMs }).catch(logErr("set_subtitle_delay"));
  };

  const handleOpenSubtitlePanel = useCallback(() => setSubtitlePanelOpen(true), []);

  const openMediaInfo = useCallback(() => setMediaInfoOpen(true), []);
  const openJumpToTime = useCallback(() => setJumpToTimeOpen(true), []);

  return (
    <div
      className="w-screen h-screen bg-transparent relative overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: showControls || !hasFile ? "default" : "none" }}
    >
      <TitleBar hasFile={hasFile} isFullscreen={isFullscreen} />

      <GestureLayer
        enabled={hasFile && !subtitlePanelOpen && !jumpToTimeOpen && !mediaInfoOpen}
        duration={duration}
        brightness={0}
        zoom={0}
        volume={volume}
        onPlayPause={playPause}
        onSeekRelative={seekRelative}
        onVolumeChange={handleVolumeChange}
        onBrightnessChange={() => { /* no image-params in lite */ }}
        onSeekAbsolutePct={seekAbsolutePct}
        onZoomChange={() => { /* no zoom in lite */ }}
        onDoubleClickFullscreen={toggleFullscreen}
      />

      <AnimatePresence>
        {!hasFile && initialCheckDone && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--np-bg)]"
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
                  className="w-20 h-20 object-contain"
                  draggable={false}
                />
              </div>
              <div className="text-center">
                <p className="text-[var(--np-text)] text-sm font-medium tracking-wide">Trace Player Lite</p>
                <p className="text-[var(--np-text-secondary)] text-xs mt-1">Open a video file to begin</p>
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={handleOpenFile}
                  className="px-5 py-2 bg-[var(--np-text)] text-[var(--np-bg)] text-sm font-medium rounded-lg
                             hover:opacity-80 active:scale-95 transition-all duration-100"
                >
                  Open File
                </button>
                <button
                  onClick={() => setOpenSourceOpen(true)}
                  className="px-4 py-2 bg-[var(--np-hover)] text-[var(--np-text)] text-sm font-medium rounded-lg
                              hover:bg-[var(--np-active)] active:scale-95
                             transition-all duration-100"
                >
                  Open URL
                </button>
              </div>

              {watchHistory.length > 0 && (
                <div className="mt-2 w-64 max-h-48 overflow-y-auto">
                  <p className="text-[var(--np-text-tertiary)] text-[10px] uppercase tracking-wider mb-1.5">
                    Recent
                  </p>
                  {watchHistory.slice(0, RECENT_VISIBLE).map((entry) => {
                    const p = entry.path;
                    const isUrl =
                      p.startsWith("http://") ||
                      p.startsWith("https://") ||
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
                                     text-[var(--np-text-secondary)] hover:text-[var(--np-text)] truncate cursor-pointer"
                          title={p}
                        >
                          {display}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromWatchHistory(p);
                          }}
                          className="w-5 h-5 mr-1 flex items-center justify-center shrink-0
                                     text-[var(--np-text-muted)] hover:text-red-400
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

      <LoadingSourceOverlay />

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

      <BufferingBanner
        hasFile={hasFile}
        forcedVisible={isSeeking && !isLocalFile}
      />

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
            thumbnails={thumbnails}
            denseThumbs={denseThumbsRef.current}
            onHoverWindow={requestThumbWindow}
            appearance={appearance}
            chapters={chapters}
            alwaysOnTop={alwaysOnTop}
            theme={theme}
            onThemeChange={setTheme}
            onAlwaysOnTopToggle={handleAlwaysOnTopToggle}
            onAppearanceChange={setAppearance}
            onMediaInfo={openMediaInfo}
            onJumpToTime={openJumpToTime}
            onFrameStep={handleFrameStep}
            onScreenshot={takeScreenshot}
            onPlayPause={playPause}
            onVolumeChange={handleVolumeChange}
            onMuteToggle={handleMuteToggle}
            onSeek={handleSeek}
            onSeekCommit={handleSeekCommit}
            onSpeedChange={handleSpeedChange}
            onAudioTrackChange={handleAudioTrackChange}
            onSubtitleTrackChange={handleSubtitleTrackChange}
            onOpenSubtitlePanel={handleOpenSubtitlePanel}
            onLoadSubtitle={handleLoadSubtitle}
            onSkipBack={handleSkipBack}
            onSkipForward={handleSkipForward}
            onFullscreenToggle={toggleFullscreen}
            onHoverChange={handleBarHoverChange}
            showThumbnails={isLocalFile && hoverPreview}
          />
        )}
      </AnimatePresence>

      <SubtitleSettingsPanel
        open={subtitlePanelOpen}
        onClose={() => setSubtitlePanelOpen(false)}
        style={subtitleStyle}
        delayMs={subtitleDelay}
        onStyleChange={handleSubtitleStyleChange}
        onDelayChange={handleSubtitleDelayChange}
        onLoadSubtitle={handleLoadSubtitle}
      />

      <OpenSourceDialog
        open={openSourceOpen}
        onSubmit={handleOpenSource}
        onClose={() => setOpenSourceOpen(false)}
      />

      <RecentSourcesPanel
        open={recentPanelOpen}
        recents={watchHistory.slice(0, RECENT_VISIBLE)}
        onPick={(p) => {
          const lower = p.toLowerCase();
          if (
            lower.startsWith("http://") ||
            lower.startsWith("https://") ||
            lower.startsWith("rtsp://") ||
            lower.startsWith("rtmp://") ||
            lower.startsWith("rtmps://") ||
            lower.startsWith("mms://")
          ) {
            void handleOpenSource(p, false);
          } else {
            void loadPath(p);
          }
        }}
        onClear={async () => {
          const db = await getDb();
          await db.execute("DELETE FROM watch_history");
          setWatchHistory([]);
        }}
        onRemove={removeFromWatchHistory}
        onClose={() => setRecentPanelOpen(false)}
      />

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

      <MediaInfoDialog
        open={mediaInfoOpen}
        onClose={() => setMediaInfoOpen(false)}
      />

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
        disabled={subtitlePanelOpen || jumpToTimeOpen || mediaInfoOpen || openSourceOpen || recentPanelOpen}
        onPlayPause={playPause}
        onSpeedChange={handleSpeedChange}
        onAudioTrackChange={handleAudioTrackChange}
        onSubtitleTrackChange={handleSubtitleTrackChange}
        onMediaInfo={() => setMediaInfoOpen(true)}
        onLoadSubtitle={handleLoadSubtitle}
      />

      {import.meta.env.DEV && <DevTester />}
    </div>
  );
}
