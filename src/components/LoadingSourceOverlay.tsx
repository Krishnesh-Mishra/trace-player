import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

/**
 * Shown while the backend is doing slow source-acquisition work the user
 * would otherwise mistake for a frozen window: torrent init / first-byte
 * fetches, archive first-entry extracts, on-demand cache-misses on
 * playlist skip.
 *
 * Driven by:
 *   - `mpv:source-loading`     {phase, label, progress?}  → show / update
 *   - `mpv:source-loading-done` ()                        → hide
 *   - `mpv:rqbit-init-progress` (0..1)                    → init % during validation
 *   - `mpv:torrent-stats`      (TorrentStats)             → live speed/peers/ETA
 */
type Payload = {
  phase: "extract" | "connect" | "buffer" | string;
  label: string;
  progress: number | null;
};

type TorrentStats = {
  torrentId: number;
  state: string;
  progressBytes: number;
  totalBytes: number;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
  peersLive: number;
  peersQueued: number;
  peersSeen: number;
  etaSeconds: number | null;
  initProgress: number | null;
  name: string | null;
};

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)} ${units[i]}`;
}

function fmtSpeed(bps: number): string {
  return bps > 0 ? `${fmtBytes(bps)}/s` : "—";
}

function fmtEta(secs: number | null): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return "—";
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function LoadingSourceOverlay() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [stats, setStats] = useState<TorrentStats | null>(null);
  // -1 = mpv not in buffering state; 0-100 = cache fill %. Reaches 100 right
  // as mpv resumes, making it the ideal "readiness to play" progress signal.
  const [cacheBuffering, setCacheBuffering] = useState<number>(-1);
  // Tracks whether a source-loading session is currently open. rqbit's stdout
  // drainer keeps emitting "initializing X.YY%" lines for a beat after we've
  // already cleared the overlay (init runs async to set_only_files); without
  // this gate those late events resurrect the overlay stuck at 94%-ish.
  const activeRef = useRef(false);

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [];
    unlisteners.push(
      listen<Payload>("mpv:source-loading", (e) => {
        activeRef.current = true;
        // Reset stale cache-buffering value from a previous playback session
        // so the progress bar doesn't jump to 100% before the new source loads.
        setCacheBuffering(-1);
        setPayload(e.payload);
      })
    );
    unlisteners.push(
      listen<unknown>("mpv:source-loading-done", () => {
        activeRef.current = false;
        setPayload(null);
        setStats(null);
        setCacheBuffering(-1);
      })
    );
    // rqbit's stdout-parsed init progress arrives here as a 0..1 number.
    // Only update if a session is still active — otherwise late lines from
    // the previous load would revive a closed overlay.
    unlisteners.push(
      listen<number>("mpv:rqbit-init-progress", (e) => {
        if (!activeRef.current) return;
        setPayload({
          phase: "connect",
          label: `Validating torrent pieces — ${(e.payload * 100).toFixed(1)}%`,
          progress: e.payload,
        });
      })
    );
    // Live torrent stats — we keep the latest snapshot regardless of overlay
    // visibility so the buffering banner (rendered separately in App.tsx)
    // can also pull from this source.
    unlisteners.push(
      listen<TorrentStats>("mpv:torrent-stats", (e) => {
        setStats(e.payload);
      })
    );
    // mpv cache-buffering-state: -1 when not buffering, 0-100 while stalled.
    // Hitting 100 means the cache is full and playback is about to resume.
    // This is the most accurate "readiness to play" progress source.
    unlisteners.push(
      listen<number>("mpv:cache-buffering", (e) => {
        if (!activeRef.current) return;
        setCacheBuffering(e.payload);
      })
    );
    const dismissOverlay = () => {
      activeRef.current = false;
      setPayload(null);
      setStats(null);
      setCacheBuffering(-1);
    };
    // Primary dismiss: fires exactly when mpv decodes the first frame and is
    // ready to display. This is the precise "frame is ready" signal.
    unlisteners.push(
      listen<unknown>("mpv:playback-restart", () => {
        if (!activeRef.current) return;
        dismissOverlay();
      })
    );
    // Dismiss when the first real frame renders after a stall.
    unlisteners.push(
      listen<unknown>("mpv:frame-changed", () => {
        if (!activeRef.current) return;
        dismissOverlay();
      })
    );
    // Fallback dismiss paths in case playback-restart is missed:
    //   1. file-loaded arms a pending dismiss flag.
    //   2. Any time-pos tick executes the dismiss if armed.
    const pendingDismissRef = { current: false };
    unlisteners.push(
      listen<string>("mpv:file-loaded", () => {
        if (activeRef.current) pendingDismissRef.current = true;
      })
    );
    unlisteners.push(
      listen<number>("mpv:time-pos", (e) => {
        if (!activeRef.current) return;
        if (e.payload >= 0 && pendingDismissRef.current) {
          pendingDismissRef.current = false;
          dismissOverlay();
        }
      })
    );
    return () => {
      unlisteners.forEach((p) => {
        p.then((u) => u()).catch(() => {});
      });
    };
  }, []);

  // Progress priority:
  //  1. cache-buffering-state (0-100): mpv's own cache fill level — hits 100
  //     exactly when playback resumes. Most accurate "ready to play" signal.
  //  2. Explicit payload.progress (e.g. archive extract %).
  //  3. Nothing — don't show rqbit's progressBytes/totalBytes here; it's the
  //     overall torrent %, which barely moves and confuses users.
  const progress =
    cacheBuffering >= 0
      ? cacheBuffering / 100
      : payload?.progress != null
      ? payload.progress
      : null;

  // Derived label refinement: if we have stats and the overlay is visible,
  // augment "Validating…" with peers (the user's main "is anything happening?"
  // signal). Once init finishes, switch wording to "Downloading content".
  let label = payload?.label ?? "";
  let phase = payload?.phase ?? "";
  if (payload && stats) {
    if (stats.state === "initializing" && stats.initProgress != null) {
      label = `Validating torrent pieces — ${(stats.initProgress * 100).toFixed(1)}%`;
      phase = "connect";
    } else if (stats.state === "live") {
      label = "Downloading content…";
      phase = "buffer";
    }
  }
  // Cache-buffering override: once mpv is actively stalling for its read
  // cache, show the fill % as the label — this is the clearest signal of
  // "how close to playing" rather than any download percentage.
  if (cacheBuffering >= 0) {
    label = `${cacheBuffering}% buffered`;
    phase = "buffer";
  }

  return (
    <AnimatePresence>
      {payload && (
        <motion.div
          key="src-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-[9999] flex items-center justify-center
                     pointer-events-auto bg-black/35"
        >
          <motion.div
            initial={{ scale: 0.96, y: 4 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="flex flex-col items-center gap-3 px-6 py-5
                       bg-[#111]/85 backdrop-blur-xl 
                       rounded-2xl shadow-2xl pointer-events-auto min-w-[320px] max-w-[420px]"
          >
            <Loader2 className="w-6 h-6 text-white/85 animate-spin" />
            <div className="flex flex-col items-center gap-1 w-full">
              <span className="text-[11px] uppercase tracking-wider text-white/45">
                {phase === "extract"
                  ? "Unpacking archive"
                  : phase === "connect"
                  ? "Validating torrent"
                  : phase === "buffer"
                  ? "Downloading content"
                  : "Loading source"}
              </span>
              <span className="text-xs text-white/85 truncate max-w-full text-center">
                {label}
              </span>
              {stats?.name && (
                <span className="text-[10px] text-white/40 truncate max-w-full text-center">
                  {stats.name}
                </span>
              )}
              {typeof progress === "number" && (
                <div className="mt-2 w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-[width] duration-200"
                    style={{
                      width: `${Math.round(progress * 100)}%`,
                      background: "var(--np-accent)",
                    }}
                  />
                </div>
              )}
              {stats && (
                <div className="mt-2 grid grid-cols-3 gap-2 w-full text-center">
                  <Stat label="Speed" value={fmtSpeed(stats.downloadSpeedBps)} />
                  <Stat
                    label="Peers"
                    value={
                      stats.peersLive > 0
                        ? `${stats.peersLive}${
                            stats.peersQueued > 0 ? ` (+${stats.peersQueued})` : ""
                          }`
                        : stats.peersSeen > 0
                        ? `0 / ${stats.peersSeen} seen`
                        : "searching…"
                    }
                  />
                  <Stat label="ETA" value={fmtEta(stats.etaSeconds)} />
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase tracking-wider text-white/35">
        {label}
      </span>
      <span className="text-[11px] text-white/80 font-medium tabular-nums">
        {value}
      </span>
    </div>
  );
}
