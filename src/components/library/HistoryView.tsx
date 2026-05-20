import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { Clock, Film, Play, X, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import type { WatchHistoryEntry } from "../../App";

interface Props {
  onPlayFile: (path: string) => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtRelativeTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const tail = slash >= 0 ? path.slice(slash + 1) : path;
  try { return decodeURIComponent(tail); } catch { return tail; }
}

let _dbPromise: ReturnType<typeof Database.load> | null = null;
function getDb() {
  if (!_dbPromise) _dbPromise = Database.load("sqlite:library.db");
  return _dbPromise;
}

interface FileMetaInfo {
  size: number;
  created: number | null;
  modified: number | null;
}

interface HistoryEntryWithSize extends WatchHistoryEntry {
  file_size: number | null;
}

export default function HistoryView({ onPlayFile }: Props) {
  const [entries, setEntries] = useState<HistoryEntryWithSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [thumbCache, setThumbCache] = useState<Map<string, string>>(new Map());
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const thumbActiveRef = useRef(false);
  const thumbQueueRef = useRef<string[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const loadEntries = useCallback(async () => {
    try {
      const db = await getDb();
      const rows = await db.select<WatchHistoryEntry[]>(
        "SELECT * FROM watch_history ORDER BY played_at DESC LIMIT 100"
      );
      const withSizes: HistoryEntryWithSize[] = await Promise.all(
        rows.map(async (row) => {
          let file_size: number | null = null;
          if (!row.path.startsWith("http") && !row.path.startsWith("magnet:")) {
            try {
              const meta = await invoke<FileMetaInfo>("get_file_metadata", { path: row.path });
              file_size = meta.size;
            } catch { /* file may not exist */ }
          }
          return { ...row, file_size };
        })
      );
      if (mountedRef.current) setEntries(withSizes);
    } catch (e) {
      console.error("[history] load failed:", e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const processThumbQueue = useCallback(async () => {
    if (thumbActiveRef.current) return;
    thumbActiveRef.current = true;
    while (thumbQueueRef.current.length > 0 && mountedRef.current) {
      const path = thumbQueueRef.current.shift()!;
      try {
        const thumbPath = await invoke<string>("generate_library_thumb", { path });
        const b64 = await invoke<string>("read_thumb_base64", { path: thumbPath });
        if (mountedRef.current) {
          setThumbCache((prev) => {
            const next = new Map(prev);
            next.set(path, `data:image/jpeg;base64,${b64}`);
            return next;
          });
        }
      } catch { /* thumb generation can fail for URLs/missing files */ }
    }
    thumbActiveRef.current = false;
  }, []);

  useEffect(() => {
    const localEntries = entries.filter(
      (e) => !e.path.startsWith("http") && !e.path.startsWith("magnet:")
    );
    const newPaths = localEntries
      .filter((e) => !thumbCache.has(e.path))
      .map((e) => e.path);
    if (newPaths.length === 0) return;
    thumbQueueRef.current = newPaths;
    void processThumbQueue();
  }, [entries, processThumbQueue, thumbCache]);

  const handleRemove = useCallback(async (path: string) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM watch_history WHERE path = $1", [path]);
      setEntries((prev) => prev.filter((e) => e.path !== path));
    } catch (e) {
      console.error("[history] remove failed:", e);
    }
  }, []);

  const handleClearAll = useCallback(() => {
    if (clearConfirm) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
      setClearConfirm(false);
      getDb().then((db) =>
        db.execute("DELETE FROM watch_history")
      ).then(() => setEntries([])).catch(() => {});
    } else {
      setClearConfirm(true);
      clearTimerRef.current = setTimeout(() => {
        setClearConfirm(false);
        clearTimerRef.current = null;
      }, 3000);
    }
  }, [clearConfirm]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--np-surface-alt)]">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--np-text-muted)]" />
          <span className="text-xs text-[var(--np-text-secondary)]">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        {entries.length > 0 && (
          <button
            onClick={handleClearAll}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] cursor-pointer
                       transition-colors duration-100 ${
                         clearConfirm
                           ? "bg-red-500/15 text-red-400"
                           : "text-[var(--np-text-tertiary)] hover:text-red-300 hover:bg-red-500/10"
                       }`}
          >
            <Trash2 className="w-3 h-3" />
            <span>{clearConfirm ? "Confirm?" : "Clear all"}</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-[var(--np-divider)] border-t-[var(--np-text-secondary)] rounded-full animate-spin" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="w-10 h-10 text-[var(--np-text-muted)] mb-3" />
            <p className="text-sm text-[var(--np-text-muted)]">
              No watch history yet
            </p>
            <p className="text-[10px] text-[var(--np-text-muted)] mt-1">
              Videos you play will appear here
            </p>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {entries.map((entry) => {
              const pct = entry.duration > 0
                ? Math.min((entry.position / entry.duration) * 100, 100)
                : 0;
              const hasProgress = entry.position > 10 && entry.duration > 0 && entry.position < entry.duration - 30;
              const isUrl = entry.path.startsWith("http") || entry.path.startsWith("magnet:");

              return (
                <motion.div
                  key={entry.path}
                  className="group cursor-pointer"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => onPlayFile(entry.path)}
                >
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-[var(--np-hover)]">
                    {thumbCache.has(entry.path) ? (
                      <img
                        src={thumbCache.get(entry.path)}
                        alt={fileName(entry.path)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="w-8 h-8 text-[var(--np-text-muted)]" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40
                                    transition-colors duration-150 flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <div className="w-10 h-10 rounded-full bg-[var(--np-selected)] backdrop-blur-sm
                                        flex items-center justify-center">
                          <Play className="w-5 h-5 text-[var(--np-text)] fill-[var(--np-text)]" />
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemove(entry.path);
                      }}
                      className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center
                                 rounded-full bg-black/60 text-white/70 hover:text-red-400
                                 opacity-0 group-hover:opacity-100
                                 transition-all duration-150 cursor-pointer"
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>

                    {hasProgress && (
                      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
                        <div
                          className="h-full bg-[var(--np-accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}

                    {entry.duration > 0 && (
                      <span className="absolute bottom-1.5 right-1.5 px-1 py-0.5 text-[9px]
                                       bg-black/70 text-white/90 rounded">
                        {hasProgress
                          ? `${fmtDuration(entry.position)} / ${fmtDuration(entry.duration)}`
                          : fmtDuration(entry.duration)
                        }
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 px-0.5">
                    <p className="text-xs text-[var(--np-text)] truncate">
                      {fileName(entry.path)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {!isUrl && entry.file_size && (
                        <span className="text-[10px] text-[var(--np-text-tertiary)]">
                          {fmtSize(entry.file_size)}
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--np-text-muted)]">
                        {fmtRelativeTime(entry.played_at)}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
