import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

/**
 * Shown during mid-playback stalls (cache ran dry after seek or peers drop).
 *
 * Driven by:
 *   - `mpv:paused-for-cache`  bool   → show / hide
 *   - `mpv:torrent-stats`     stats  → speed/peers on torrent stalls only
 *
 * `forcedVisible` (seeking on non-local source): shows a minimal spinner
 * only — no stats, because the seek hasn't stalled yet.
 */

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
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)} ${units[i]}`;
}

function fmtEta(secs: number | null): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return "—";
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export default function BufferingBanner({
  hasFile,
  forcedVisible = false,
}: {
  hasFile: boolean;
  forcedVisible?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [stats, setStats] = useState<TorrentStats | null>(null);
  // Rust arms pending_frame_dismiss when paused-for-cache clears or
  // PLAYBACK_RESTART fires, then fires mpv:frame-changed on the first
  // rendered video frame. JS dismisses on that signal — not on time-pos
  // (which advances with the audio clock even while video is still frozen).
  const activeRef = useRef(false);
  // Fallback tick counter: for audio-only files where video-frame-info never
  // changes, dismiss after ~3 s of continuous time-pos advancement instead.
  const fallbackTicksRef = useRef(0);
  const FALLBACK_TICKS = 30; // ~3 s at 10 Hz

  const dismiss = () => {
    fallbackTicksRef.current = 0;
    activeRef.current = false;
    setActive(false);
    setStats(null);
  };

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<boolean>("mpv:paused-for-cache", (e) => {
        if (e.payload) {
          fallbackTicksRef.current = 0;
          activeRef.current = true;
          setActive(true);
        }
        // paused-for-cache=false: Rust already armed pending_frame_dismiss;
        // no JS action needed — we wait for mpv:frame-changed.
      })
    );

    // Primary dismiss: Rust emits this the moment the VO renders a new frame
    // after a stall, so the spinner stays until the freeze visually ends.
    unlisteners.push(
      listen<unknown>("mpv:frame-changed", () => {
        if (activeRef.current) dismiss();
      })
    );

    // Secondary dismiss: playback-restart fires when mpv's decode pipeline
    // restarts after a cache stall. In production builds, video-frame-info
    // can lag behind, so this acts as a reliable backup.
    unlisteners.push(
      listen<unknown>("mpv:playback-restart", () => {
        if (activeRef.current) dismiss();
      })
    );

    // Fallback dismiss for audio-only files: video-frame-info never fires so
    // mpv:frame-changed never arrives. Accept N consecutive time-pos ticks
    // (continuous audio advancement) as a proxy for "playback is running".
    unlisteners.push(
      listen<number>("mpv:time-pos", () => {
        if (activeRef.current) {
          fallbackTicksRef.current++;
          if (fallbackTicksRef.current >= FALLBACK_TICKS) dismiss();
        } else {
          fallbackTicksRef.current = 0;
        }
      })
    );

    // Reset when a new source starts loading so stale state doesn't bleed.
    unlisteners.push(
      listen<unknown>("mpv:source-loading", () => {
        fallbackTicksRef.current = 0;
        activeRef.current = false;
        setActive(false);
        setStats(null);
      })
    );

    unlisteners.push(
      listen<TorrentStats>("mpv:torrent-stats", (e) => setStats(e.payload))
    );

    return () => {
      unlisteners.forEach((p) => p.then((u) => u()).catch(() => {}));
    };
  }, []);

  const visible = hasFile && (active || forcedVisible);
  // When forcedVisible (seeking) and not yet stalled: show only a spinner.
  const seekOnly = forcedVisible && !active;

  const isTorrent = !seekOnly && stats != null && stats.totalBytes > 0;
  const speed = isTorrent && stats!.downloadSpeedBps > 0
    ? `${fmtBytes(stats!.downloadSpeedBps)}/s`
    : null;
  const peers =
    isTorrent && stats!.peersLive > 0
      ? `${stats!.peersLive}${stats!.peersQueued > 0 ? ` (+${stats!.peersQueued})` : ""}`
      : isTorrent && stats!.peersSeen > 0
      ? `0 / ${stats!.peersSeen} seen`
      : null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="buffering"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-[9999999] flex items-center justify-center pointer-events-auto bg-black/30"
        >
          <motion.div
            initial={{ scale: 0.96, y: 4 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="flex flex-col items-center gap-3 px-6 py-5
                       bg-[#111]/85 backdrop-blur-xl border border-white/10
                       rounded-2xl shadow-2xl"
          >
            <Loader2 className="w-6 h-6 text-white/85 animate-spin" />

            {!seekOnly && (
              <div className="flex flex-col items-center gap-1 w-full min-w-[200px] max-w-[320px]">
                <span className="text-[11px] uppercase tracking-wider text-white/45">
                  Buffering
                </span>
                <span className="text-xs text-white/75 text-center">
                  {isTorrent
                    ? speed ? `Downloading at ${speed}` : "Waiting for peers…"
                    : "Fetching content…"}
                </span>
                {isTorrent && (
                  <div className="mt-2 grid grid-cols-3 gap-2 w-full text-center">
                    <Stat label="Speed" value={speed ?? "—"} />
                    <Stat label="Peers" value={peers ?? "searching…"} />
                    <Stat label="ETA" value={fmtEta(stats!.etaSeconds)} />
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase tracking-wider text-white/35">{label}</span>
      <span className="text-[11px] text-white/80 font-medium tabular-nums">{value}</span>
    </div>
  );
}
