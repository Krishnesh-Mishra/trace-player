import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import {
  Download, Pause, Play, Film, MoreHorizontal, Trash2,
  RotateCcw, X, Info, Copy, Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

interface TorrentStats {
  torrentId: number;
  state: string;
  progressBytes: number;
  totalBytes: number;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
  peersLive: number;
  etaSeconds: number | null;
  initProgress: number | null;
  name: string | null;
}

interface DownloadRow {
  id: number;
  torrent_id: number;
  magnet_uri: string;
  title: string;
  file_index: number | null;
  progress_bytes: number;
  total_bytes: number;
  state: string;
  started_at: number;
}

function fmtSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

function fmtSize(bytes: number): string {
  if (bytes <= 0) return "Unknown";
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

function statusColor(state: string): string {
  switch (state) {
    case "live": return "text-green-400";
    case "paused": return "text-yellow-400";
    case "initializing": return "text-blue-400";
    case "error": return "text-red-400";
    default: return "text-[var(--np-text-tertiary)]";
  }
}

function statusLabel(state: string): string {
  switch (state) {
    case "live": return "Downloading";
    case "paused": return "Paused";
    case "initializing": return "Initializing…";
    case "error": return "Error";
    case "completed": return "Completed";
    default: return state || "Unknown";
  }
}

let dbPromise: Promise<Awaited<ReturnType<typeof Database.load>>> | null = null;
function getDb() {
  if (!dbPromise) dbPromise = Database.load("sqlite:library.db");
  return dbPromise;
}

interface DownloadsViewProps {
  onPlayFile?: (path: string) => void;
  onPlayTorrent?: (magnet: string, fileIndex?: number) => void;
}

export default function DownloadsView({ onPlayFile, onPlayTorrent }: DownloadsViewProps) {
  const [liveStats, setLiveStats] = useState<TorrentStats[]>([]);
  const [rows, setRows] = useState<DownloadRow[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [propsRow, setPropsRow] = useState<DownloadRow | null>(null);

  const loadRows = useCallback(async () => {
    try {
      const db = await getDb();
      const r = await db.select<DownloadRow[]>(
        "SELECT * FROM downloads ORDER BY started_at DESC",
      );
      setRows(r);
    } catch {}
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    // Tracks which (magnet, file_index) pairs we've already back-filled into
    // library.items so we don't re-issue the same UPDATE every poll tick. We
    // only need this for the lifetime of the component — restart-on-mount is
    // fine; the next library open re-scans for missing thumbs anyway.
    const pathBackfilled = new Set<string>();

    const poll = async () => {
      try {
        const stats = await invoke<TorrentStats[]>("list_downloads");
        setLiveStats(stats);
        const db = await getDb();
        for (const s of stats) {
          const fileRows = await db.select<DownloadRow[]>(
            "SELECT * FROM downloads WHERE torrent_id = $1",
            [s.torrentId],
          );

          if (fileRows.length <= 1) {
            await db.execute(
              "UPDATE downloads SET progress_bytes = $1, total_bytes = $2, state = $3 WHERE torrent_id = $4",
              [s.progressBytes, s.totalBytes, s.state, s.torrentId],
            );
          } else {
            const overallPct = s.totalBytes > 0 ? s.progressBytes / s.totalBytes : 0;
            for (const row of fileRows) {
              const fileProgress = Math.round(overallPct * row.total_bytes);
              await db.execute(
                "UPDATE downloads SET progress_bytes = $1, state = $2 WHERE id = $3",
                [fileProgress, s.state, row.id],
              );
            }
          }

          if (s.name) {
            await db.execute(
              "UPDATE downloads SET title = $1 WHERE torrent_id = $2 AND title = ('Torrent #' || $2)",
              [s.name, s.torrentId],
            );
          }

          // When any file in this torrent has fully downloaded, ask rqbit for
          // its on-disk path and back-fill the matching library item. The
          // library auto-gen loop then picks up the populated `path` on the
          // next library open and generates a thumb via the cheap local-file
          // route (no stream-fallback needed).
          for (const row of fileRows) {
            const isComplete = row.total_bytes > 0 && row.progress_bytes >= row.total_bytes;
            if (!isComplete) continue;
            const key = `${row.magnet_uri}|${row.file_index ?? "-"}`;
            if (pathBackfilled.has(key)) continue;
            pathBackfilled.add(key);
            try {
              const localPath = await invoke<string | null>("get_torrent_file_path", {
                magnet: row.magnet_uri,
                fileIndex: row.file_index,
              });
              if (!localPath) continue;
              if (row.file_index !== null) {
                await db.execute(
                  "UPDATE items SET path = $1 WHERE magnet_uri = $2 AND file_index = $3 AND (path IS NULL OR path = '')",
                  [localPath, row.magnet_uri, row.file_index],
                );
              } else {
                await db.execute(
                  "UPDATE items SET path = $1 WHERE magnet_uri = $2 AND file_index IS NULL AND (path IS NULL OR path = '')",
                  [localPath, row.magnet_uri],
                );
              }
            } catch (e) {
              // Re-try on next tick if backfill failed.
              pathBackfilled.delete(key);
              console.warn("[downloads] items.path backfill failed:", row.title, e);
            }
          }
        }
      } catch {}
    };
    void poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (liveStats.length > 0) void loadRows();
  }, [liveStats, loadRows]);

  const deleteRow = useCallback(async (id: number) => {
    const db = await getDb();
    await db.execute("DELETE FROM downloads WHERE id = $1", [id]);
    void loadRows();
  }, [loadRows]);

  const cancelDownload = useCallback(async (row: DownloadRow) => {
    invoke("stop_download", { id: row.torrent_id, fileIndex: row.file_index }).catch(() => {});
    await deleteRow(row.id);
  }, [deleteRow]);

  const playDownload = useCallback(async (row: DownloadRow) => {
    try {
      const localPath = await invoke<string | null>("get_torrent_file_path", {
        magnet: row.magnet_uri,
        fileIndex: row.file_index,
      });
      if (localPath && onPlayFile) {
        onPlayFile(localPath);
        return;
      }
    } catch {}
    if (onPlayTorrent && row.magnet_uri) {
      onPlayTorrent(row.magnet_uri, row.file_index ?? undefined);
    }
  }, [onPlayFile, onPlayTorrent]);

  const resumeDownload = useCallback(async (row: DownloadRow) => {
    try {
      await invoke<{ torrentId: number; fileLength: number }>("start_download", {
        magnet: row.magnet_uri,
        fileIndex: row.file_index,
      });
      void loadRows();
    } catch (e) {
      console.error("resume_download:", e);
    }
  }, [loadRows]);

  const isFullyDownloaded = (row: DownloadRow) =>
    row.total_bytes > 0 && row.progress_bytes >= row.total_bytes;

  const openActiveMenu = useCallback((e: React.MouseEvent, row: DownloadRow) => {
    const items: ContextMenuItem[] = [
      { label: "Play Video", icon: <Play className="w-3.5 h-3.5" />, onClick: () => void playDownload(row) },
      { label: "", separator: true, onClick: () => {} },
      { label: "Properties", icon: <Info className="w-3.5 h-3.5" />, onClick: () => setPropsRow(row) },
      { label: "", separator: true, onClick: () => {} },
      { label: "Cancel Download", icon: <X className="w-3.5 h-3.5" />, onClick: () => void cancelDownload(row) },
      { label: "Remove from List", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => void deleteRow(row.id) },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [playDownload, cancelDownload, deleteRow]);

  const openCompletedMenu = useCallback((e: React.MouseEvent, row: DownloadRow) => {
    const fullyDone = isFullyDownloaded(row);
    const items: ContextMenuItem[] = [
      { label: "Play Video", icon: <Play className="w-3.5 h-3.5" />, onClick: () => void playDownload(row) },
      ...(!fullyDone ? [
        { label: "Resume Download", icon: <RotateCcw className="w-3.5 h-3.5" />, onClick: () => void resumeDownload(row) },
      ] : []),
      { label: "", separator: true, onClick: () => {} },
      { label: "Properties", icon: <Info className="w-3.5 h-3.5" />, onClick: () => setPropsRow(row) },
      { label: "", separator: true, onClick: () => {} },
      { label: "Remove from List", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => void deleteRow(row.id) },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [playDownload, resumeDownload, deleteRow]);

  const activeIds = new Set(liveStats.map((s) => s.torrentId));
  const activeRows = rows.filter((r) => activeIds.has(r.torrent_id));
  const completedRows = rows.filter((r) => !activeIds.has(r.torrent_id));

  const statsMap = new Map(liveStats.map((s) => [s.torrentId, s]));

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <Download className="w-4 h-4 text-[var(--np-text-tertiary)]" />
        <h2 className="text-sm font-medium text-[var(--np-text)]">Downloads</h2>
        {activeRows.length > 0 && (
          <span className="text-[10px] text-[var(--np-text-tertiary)]">
            {activeRows.length} active
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {activeRows.length > 0 && (
          <div className="grid grid-cols-1 gap-3 mb-6">
            {activeRows.map((row) => {
              const live = statsMap.get(row.torrent_id);
              const isInit = live?.state === "initializing";
              const pct = isInit && live?.initProgress != null
                ? live.initProgress * 100
                : row.total_bytes > 0
                  ? (row.progress_bytes / row.total_bytes) * 100
                  : 0;
              const isPaused = live?.state === "paused";
              const state = live?.state ?? row.state;
              return (
                <div key={row.id} className="bg-[var(--np-hover)] rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-[var(--np-text)] leading-snug line-clamp-2 mb-2">
                        {row.title}
                      </p>
                      <div className="h-2 bg-[var(--np-surface-alt)] rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full bg-[var(--np-text-tertiary)] rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-[11px] text-[var(--np-text-secondary)] font-medium">
                          {pct.toFixed(1)}%
                        </span>
                        {isInit ? (
                          <span className="text-[10px] text-[var(--np-text-tertiary)]">
                            Checking existing data…
                          </span>
                        ) : (
                          <span className="text-[10px] text-[var(--np-text-tertiary)]">
                            {fmtSize(row.progress_bytes)} / {fmtSize(row.total_bytes)}
                          </span>
                        )}
                        {!isPaused && !isInit && live && live.downloadSpeedBps > 0 && (
                          <span className="text-[10px] text-[var(--np-text-tertiary)]">
                            ↓ {fmtSpeed(live.downloadSpeedBps)}
                          </span>
                        )}
                        {live && live.peersLive > 0 && (
                          <span className="text-[10px] text-[var(--np-text-tertiary)]">
                            {live.peersLive} peers
                          </span>
                        )}
                        {!isPaused && !isInit && live?.etaSeconds != null && live.etaSeconds > 0 && (
                          <span className="text-[10px] text-[var(--np-text-tertiary)]">
                            ETA {fmtEta(live.etaSeconds)}
                          </span>
                        )}
                        <span className={`text-[10px] ml-auto ${statusColor(state)}`}>
                          {statusLabel(state)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isInit && (
                        <button
                          onClick={() => {
                            const cmd = isPaused ? "resume_download" : "pause_download";
                            invoke(cmd, { id: row.torrent_id }).catch(() => {});
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg
                                     text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-active)]
                                     cursor-pointer transition-colors"
                          title={isPaused ? "Resume" : "Pause"}
                        >
                          {isPaused ? (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          ) : (
                            <Pause className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={(e) => openActiveMenu(e, row)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg
                                   text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-active)]
                                   cursor-pointer transition-colors"
                        title="More options"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {completedRows.length > 0 && (
          <>
            <p className="text-[10px] text-[var(--np-text-muted)] uppercase tracking-wider mb-3">
              Downloaded
            </p>
            <div className="grid grid-cols-1 gap-2">
              {completedRows.map((row) => {
                const pct = row.total_bytes > 0
                  ? (row.progress_bytes / row.total_bytes) * 100
                  : 0;
                return (
                  <div key={row.id} className="group bg-[var(--np-hover)] rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <Film className="w-4 h-4 text-[var(--np-text-muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-[var(--np-text)] truncate">{row.title}</p>
                        <p className="text-[10px] text-[var(--np-text-tertiary)]">
                          {fmtSize(row.total_bytes)}
                          {!isFullyDownloaded(row) && ` · ${pct.toFixed(0)}% downloaded`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => void playDownload(row)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg
                                     text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-active)]
                                     cursor-pointer transition-colors"
                          title="Play"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button
                          onClick={(e) => openCompletedMenu(e, row)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg
                                     text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-active)]
                                     cursor-pointer transition-colors"
                          title="More options"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {activeRows.length === 0 && completedRows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Download className="w-10 h-10 text-[var(--np-text-muted)] mb-3" />
            <p className="text-sm text-[var(--np-text-muted)]">No downloads yet</p>
            <p className="text-[11px] text-[var(--np-text-muted)] mt-1">
              Right-click a torrent and select "Download" to start
            </p>
          </div>
        )}
      </div>

      <ContextMenu
        open={ctxMenu !== null}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        items={ctxMenu?.items ?? []}
        onClose={() => setCtxMenu(null)}
      />

      <DownloadPropsDialog
        row={propsRow}
        onClose={() => setPropsRow(null)}
      />
    </div>
  );
}

// ── Properties Dialog ───────────────────────────────────────────────────────

function DownloadPropsDialog({ row, onClose }: { row: DownloadRow | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!row) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [row, onClose]);

  const handleCopy = useCallback(() => {
    if (!row) return;
    navigator.clipboard.writeText(row.magnet_uri).catch(() => {});
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [row]);

  if (!row) return null;

  const pct = row.total_bytes > 0 ? (row.progress_bytes / row.total_bytes) * 100 : 0;
  const truncatedMagnet = row.magnet_uri.length > 80
    ? row.magnet_uri.slice(0, 80) + "…"
    : row.magnet_uri;

  const infoRows: { label: string; value: React.ReactNode }[] = [
    { label: "Name", value: row.title },
    { label: "Size", value: fmtSize(row.total_bytes) },
    { label: "Downloaded", value: `${fmtSize(row.progress_bytes)} (${pct.toFixed(1)}%)` },
    { label: "State", value: statusLabel(row.state) },
    ...(row.file_index !== null ? [{ label: "File Index", value: String(row.file_index) }] : []),
    {
      label: "Magnet",
      value: (
        <div className="flex items-start gap-1.5">
          <span className="text-[11px] text-[var(--np-text)] break-all leading-relaxed">
            {truncatedMagnet}
          </span>
          <button
            onClick={handleCopy}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded
                       text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-hover)]
                       cursor-pointer transition-colors"
            title="Copy magnet link"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      ),
    },
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="absolute inset-0 z-[70] flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50" />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Download Properties"
          className="relative bg-[var(--np-overlay)] rounded-2xl shadow-2xl w-[380px] p-5"
          initial={{ scale: 0.92, y: -8 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.92, y: -8 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-[var(--np-text)]">Properties</h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-6 h-6 flex items-center justify-center text-[var(--np-text-tertiary)]
                         hover:text-[var(--np-text)] rounded-md hover:bg-[var(--np-hover)] cursor-pointer
                         transition-colors duration-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2.5">
            {infoRows.map((r) => (
              <div key={r.label} className="flex gap-3">
                <span className="text-[11px] text-[var(--np-text-tertiary)] w-20 shrink-0">{r.label}</span>
                <div className="flex-1 min-w-0 text-[11px] text-[var(--np-text)]">{r.value}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
