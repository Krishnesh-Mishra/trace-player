import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Film,
  Play,
  Copy,
  Info,
  ListPlus,
  X,
} from "lucide-react";
import type { ExploreVideo } from "./types";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

interface Props {
  onPlayFile: (path: string) => void;
}

interface FileMeta {
  size: number;
  created: number | null;
  modified: number | null;
}

interface MediaInfo {
  width: number;
  height: number;
  videoCount: number;
  audioCount: number;
  subtitleCount: number;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(epoch: number | null): string {
  if (!epoch) return "Unknown";
  return new Date(epoch * 1000).toLocaleString();
}

export default function LibraryExploreView({ onPlayFile }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExploreVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [autoResults, setAutoResults] = useState<ExploreVideo[]>([]);
  const [autoLoading, setAutoLoading] = useState(true);
  const [thumbCache, setThumbCache] = useState<Map<string, string>>(new Map());
  const mountedRef = useRef(true);
  const thumbActiveRef = useRef(false);
  const thumbQueueRef = useRef<string[]>([]);

  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [propsVideo, setPropsVideo] = useState<ExploreVideo | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    invoke<ExploreVideo[]>("scan_common_folders")
      .then(setAutoResults)
      .catch(() => {})
      .finally(() => setAutoLoading(false));
  }, []);

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
      } catch (e) {
        console.warn("[explore] thumb failed for", path, e);
      }
    }
    thumbActiveRef.current = false;
  }, []);

  useEffect(() => {
    const videos = searched ? results : autoResults;
    const newPaths = videos
      .filter((v) => !thumbCache.has(v.path))
      .map((v) => v.path);
    if (newPaths.length === 0) return;
    thumbQueueRef.current = newPaths;
    void processThumbQueue();
  }, [autoResults, results, searched, processThumbQueue, thumbCache]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const videos = await invoke<ExploreVideo[]>("read_directory_videos", {
        path: query.trim(),
      });
      setResults(videos);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleContext = useCallback(
    (e: React.MouseEvent, video: ExploreVideo) => {
      e.preventDefault();
      e.stopPropagation();
      const items: ContextMenuItem[] = [
        {
          label: "Play",
          icon: <Play className="w-3.5 h-3.5" />,
          onClick: () => onPlayFile(video.path),
        },
        {
          label: "Add to Playlist",
          icon: <ListPlus className="w-3.5 h-3.5" />,
          onClick: () => {
            invoke("playlist_add", { path: video.path }).catch(() => {});
          },
        },
        { label: "", separator: true, onClick: () => {} },
        {
          label: "Copy",
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: "Ctrl+C",
          onClick: () => {
            navigator.clipboard.writeText(video.path).catch(() => {});
          },
        },
        { label: "", separator: true, onClick: () => {} },
        {
          label: "Properties",
          icon: <Info className="w-3.5 h-3.5" />,
          onClick: () => setPropsVideo(video),
        },
      ];
      setCtxMenu({ x: e.clientX, y: e.clientY, items });
    },
    [onPlayFile],
  );

  const displayResults = searched ? results : autoResults;
  const isLoading = searched ? loading : autoLoading;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 py-3 bg-[var(--np-surface-alt)]">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--np-text-muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
              placeholder="Search a folder path or browse videos below..."
              className="w-full bg-[var(--np-hover)] rounded-lg pl-10 pr-3 py-2
                         text-xs text-[var(--np-text)] placeholder:text-[var(--np-text-muted)] outline-none
                         transition-colors duration-100"
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            className="px-4 py-2 text-xs font-medium text-[var(--np-bg)] bg-[var(--np-text)] rounded-lg
                       hover:opacity-80 active:scale-95 transition-all duration-100
                       cursor-pointer shrink-0"
          >
            Scan
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-[var(--np-divider)] border-t-[var(--np-text-secondary)] rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && displayResults.length === 0 && !searched && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="w-10 h-10 text-[var(--np-text-muted)] mb-3" />
            <p className="text-sm text-[var(--np-text-muted)]">
              No video files found on this PC
            </p>
            <p className="text-[10px] text-[var(--np-text-muted)] mt-1">
              Try scanning a specific folder above
            </p>
          </div>
        )}

        {!isLoading && searched && results.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--np-text-muted)]">
              No video files found in that location
            </p>
          </div>
        )}

        {!isLoading && displayResults.length > 0 && (
          <>
            {!searched && (
              <p className="text-[10px] text-[var(--np-text-muted)] uppercase tracking-wider mb-3">
                Videos on this PC
              </p>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {displayResults.map((video) => (
                <motion.div
                  key={video.path}
                  className="group cursor-pointer"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => onPlayFile(video.path)}
                  onContextMenu={(e) => handleContext(e, video)}
                >
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-[var(--np-hover)]">
                    {thumbCache.has(video.path) ? (
                      <img
                        src={thumbCache.get(video.path)}
                        alt={video.name}
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
                  </div>
                  <div className="mt-1.5 px-0.5">
                    <p className="text-xs text-[var(--np-text)] truncate">{video.name}</p>
                    <p className="text-[10px] text-[var(--np-text-tertiary)] mt-0.5">
                      {fmtSize(video.size)}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>

      <ContextMenu
        open={ctxMenu !== null}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        items={ctxMenu?.items ?? []}
        onClose={() => setCtxMenu(null)}
      />

      <ExplorePropertiesDialog
        video={propsVideo}
        onClose={() => setPropsVideo(null)}
      />
    </div>
  );
}

function ExplorePropertiesDialog({
  video,
  onClose,
}: {
  video: ExploreVideo | null;
  onClose: () => void;
}) {
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);

  useEffect(() => {
    if (!video) {
      setFileMeta(null);
      setMediaInfo(null);
      return;
    }
    invoke<FileMeta>("get_file_metadata", { path: video.path })
      .then(setFileMeta)
      .catch(() => {});
    invoke<MediaInfo>("probe_video_info", { path: video.path })
      .then(setMediaInfo)
      .catch(() => {});
  }, [video]);

  useEffect(() => {
    if (!video) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [video, onClose]);

  const rows: { label: string; value: string }[] = [];
  if (video) {
    rows.push({ label: "Name", value: video.name });
    rows.push({ label: "Path", value: video.path });
    rows.push({ label: "Size", value: fmtSize(fileMeta?.size ?? video.size) });
    if (mediaInfo && mediaInfo.width > 0 && mediaInfo.height > 0) {
      rows.push({
        label: "Resolution",
        value: `${mediaInfo.width}x${mediaInfo.height}`,
      });
    }
    if (mediaInfo) {
      rows.push({ label: "Video Streams", value: String(mediaInfo.videoCount) });
      rows.push({ label: "Audio Streams", value: String(mediaInfo.audioCount) });
      rows.push({ label: "Subtitles", value: String(mediaInfo.subtitleCount) });
    }
    if (fileMeta?.created)
      rows.push({ label: "Created", value: fmtDate(fileMeta.created) });
    if (fileMeta?.modified)
      rows.push({ label: "Modified", value: fmtDate(fileMeta.modified) });
  }

  return (
    <AnimatePresence>
      {video && (
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
            aria-label="Properties"
            className="relative bg-[var(--np-overlay)] rounded-2xl shadow-2xl w-[360px] p-5"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[var(--np-text)]">
                Properties
              </h3>
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

            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.label} className="flex gap-3">
                  <span className="text-[11px] text-[var(--np-text-tertiary)] w-20 shrink-0">
                    {row.label}
                  </span>
                  <span className="text-[11px] text-[var(--np-text)] break-all">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
