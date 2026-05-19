import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Pause, Play, X } from "lucide-react";

interface TorrentStats {
  torrentId: number;
  state: string;
  progressBytes: number;
  totalBytes: number;
  downloadSpeedBps: number;
  name: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function fmtSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DownloadsPanel({ open, onClose }: Props) {
  const [downloads, setDownloads] = useState<TorrentStats[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setDownloads([]);
      return;
    }
    const poll = () => {
      invoke<TorrentStats[]>("list_downloads")
        .then(setDownloads)
        .catch(() => {});
    };
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute top-0 right-0 bottom-0 w-80 z-[60]
                     bg-[var(--np-bg)] backdrop-blur-xl flex flex-col"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <h3 className="text-sm font-medium text-[var(--np-text)] flex items-center gap-2">
              <Download className="w-4 h-4" />
              Downloads
            </h3>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center text-[var(--np-text-tertiary)]
                         hover:text-[var(--np-text)] rounded-md hover:bg-[var(--np-hover)] cursor-pointer
                         transition-colors duration-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {downloads.length === 0 ? (
              <p className="text-[11px] text-[var(--np-text-muted)] text-center mt-8">
                No active downloads
              </p>
            ) : (
              <div className="space-y-3">
                {downloads.map((dl) => {
                  const pct =
                    dl.totalBytes > 0
                      ? (dl.progressBytes / dl.totalBytes) * 100
                      : 0;
                  const isPaused = dl.state === "paused";
                  return (
                    <div key={dl.torrentId} className="bg-[var(--np-hover)] rounded-lg p-3">
                      <div className="flex items-start gap-2 mb-2">
                        <p className="flex-1 text-[11px] text-[var(--np-text-secondary)] leading-snug line-clamp-2">
                          {dl.name || `Torrent #${dl.torrentId}`}
                        </p>
                        <button
                          onClick={() => {
                            const cmd = isPaused
                              ? "resume_download"
                              : "pause_download";
                            invoke(cmd, { id: dl.torrentId }).catch(() => {});
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded-md
                                     text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-hover)]
                                     cursor-pointer transition-colors shrink-0"
                        >
                          {isPaused ? (
                            <Play className="w-3 h-3 fill-current" />
                          ) : (
                            <Pause className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <div className="h-1.5 bg-[var(--np-hover)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--np-text-tertiary)] rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-[var(--np-text-tertiary)]">
                          {pct.toFixed(1)}% · {fmtSize(dl.progressBytes)} / {fmtSize(dl.totalBytes)}
                        </span>
                        {!isPaused && dl.downloadSpeedBps > 0 && (
                          <span className="text-[10px] text-[var(--np-text-tertiary)]">
                            {fmtSpeed(dl.downloadSpeedBps)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
