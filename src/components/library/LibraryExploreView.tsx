import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, Film, Play } from "lucide-react";
import { motion } from "framer-motion";
import type { ExploreVideo } from "./types";

interface Props {
  onPlayFile: (path: string) => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
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

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
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
    </div>
  );
}
