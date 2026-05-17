import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, Pause, Play, Square } from "lucide-react";

interface TorrentStats {
  torrentId: number;
  state: string;
  progressBytes: number;
  totalBytes: number;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
  peersLive: number;
  etaSeconds: number | null;
  name: string | null;
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

function fmtEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function statusLabel(state: string): string {
  switch (state) {
    case "live": return "Downloading";
    case "paused": return "Paused";
    case "initializing": return "Initializing";
    case "error": return "Error";
    default: return state || "Unknown";
  }
}

function statusColor(state: string): string {
  switch (state) {
    case "live": return "text-green-400";
    case "paused": return "text-yellow-400";
    case "initializing": return "text-blue-400";
    case "error": return "text-red-400";
    default: return "text-white/50";
  }
}

export default function DownloadsView() {
  const [downloads, setDownloads] = useState<TorrentStats[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
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
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <Download className="w-4 h-4 text-white/50" />
        <h2 className="text-sm font-medium text-white/90">Downloads</h2>
        {downloads.length > 0 && (
          <span className="text-[10px] text-white/40">
            {downloads.length} active
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {downloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Download className="w-10 h-10 text-white/10 mb-3" />
            <p className="text-sm text-white/30">No active downloads</p>
            <p className="text-[11px] text-white/20 mt-1">
              Right-click a torrent and select "Download" to start
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {downloads.map((dl) => {
              const pct = dl.totalBytes > 0
                ? (dl.progressBytes / dl.totalBytes) * 100
                : 0;
              const isPaused = dl.state === "paused";
              return (
                <div key={dl.torrentId} className="bg-white/[0.03] rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-white/80 leading-snug line-clamp-2 mb-2">
                        {dl.name || `Torrent #${dl.torrentId}`}
                      </p>

                      <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full bg-white/50 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-[11px] text-white/60 font-medium">
                          {pct.toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-white/40">
                          {fmtSize(dl.progressBytes)} / {fmtSize(dl.totalBytes)}
                        </span>
                        {!isPaused && dl.downloadSpeedBps > 0 && (
                          <span className="text-[10px] text-white/40">
                            ↓ {fmtSpeed(dl.downloadSpeedBps)}
                          </span>
                        )}
                        {!isPaused && dl.uploadSpeedBps > 0 && (
                          <span className="text-[10px] text-white/40">
                            ↑ {fmtSpeed(dl.uploadSpeedBps)}
                          </span>
                        )}
                        {dl.peersLive > 0 && (
                          <span className="text-[10px] text-white/40">
                            {dl.peersLive} peers
                          </span>
                        )}
                        {!isPaused && dl.etaSeconds != null && dl.etaSeconds > 0 && (
                          <span className="text-[10px] text-white/40">
                            ETA {fmtEta(dl.etaSeconds)}
                          </span>
                        )}
                        <span className={`text-[10px] ml-auto ${statusColor(dl.state)}`}>
                          {statusLabel(dl.state)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          const cmd = isPaused ? "resume_download" : "pause_download";
                          invoke(cmd, { id: dl.torrentId }).catch(() => {});
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg
                                   text-white/40 hover:text-white/80 hover:bg-white/10
                                   cursor-pointer transition-colors"
                        title={isPaused ? "Resume" : "Pause"}
                      >
                        {isPaused ? (
                          <Play className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Pause className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          invoke("stop_download", { id: dl.torrentId }).catch(() => {});
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg
                                   text-white/40 hover:text-white/80 hover:bg-white/10
                                   cursor-pointer transition-colors"
                        title="Stop"
                      >
                        <Square className="w-3 h-3 fill-current" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
