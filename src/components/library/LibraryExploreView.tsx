import { useState, useCallback } from "react";
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

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
              placeholder="Enter a folder path to scan for videos (e.g. D:\Videos)"
              className="w-full bg-white/5 border border-white/8 rounded-lg pl-10 pr-3 py-2
                         text-xs text-white placeholder:text-white/25 outline-none
                         focus:border-white/20 transition-colors duration-100"
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            className="px-4 py-2 text-xs font-medium text-black bg-white rounded-lg
                       hover:bg-white/90 active:scale-95 transition-all duration-100
                       cursor-pointer shrink-0"
          >
            Scan
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}

        {!loading && !searched && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="w-10 h-10 text-white/15 mb-3" />
            <p className="text-sm text-white/30">
              Enter a folder path to discover video files
            </p>
            <p className="text-[10px] text-white/20 mt-1">
              Scans the directory for video files
            </p>
          </div>
        )}

        {!loading && searched && results.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-white/30">
              No video files found in that location
            </p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {results.map((video) => (
              <motion.div
                key={video.path}
                className="group cursor-pointer"
                whileTap={{ scale: 0.97 }}
                onClick={() => onPlayFile(video.path)}
              >
                <div className="relative aspect-video rounded-lg overflow-hidden bg-white/5">
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-8 h-8 text-white/15" />
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40
                                  transition-colors duration-150 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm
                                      flex items-center justify-center">
                        <Play className="w-5 h-5 text-white fill-white" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 px-0.5">
                  <p className="text-xs text-white/80 truncate">{video.name}</p>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {fmtSize(video.size)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
