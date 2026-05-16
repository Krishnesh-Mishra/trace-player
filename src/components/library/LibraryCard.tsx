import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { Play, Trash2, Film } from "lucide-react";
import type { LibraryItem } from "./types";

interface Props {
  item: LibraryItem;
  onPlay: () => void;
  onDelete: () => void;
  onThumbGenerated?: (id: number, thumbPath: string) => void;
}

function fmtDuration(secs: number | null): string {
  if (secs === null || secs <= 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function LibraryCard({
  item,
  onPlay,
  onDelete,
  onThumbGenerated,
}: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (item.thumb_path) {
      setThumbUrl(convertFileSrc(item.thumb_path));
      return;
    }
    const source = item.path || item.magnet_uri;
    if (!source || item.tab === "torrents" || generating) return;

    let cancelled = false;
    setGenerating(true);
    invoke<string>("generate_library_thumb", { path: source })
      .then((path) => {
        if (!cancelled) {
          setThumbUrl(convertFileSrc(path));
          onThumbGenerated?.(item.id, path);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setGenerating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.thumb_path, item.path, item.magnet_uri, item.tab, item.id, generating, onThumbGenerated]);

  return (
    <motion.div
      className="group cursor-pointer"
      whileTap={{ scale: 0.97 }}
      onClick={onPlay}
    >
      <div className="relative aspect-video rounded-lg overflow-hidden bg-white/5">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-8 h-8 text-white/15" />
          </div>
        )}

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-150 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-5 h-5 text-white fill-white" />
            </div>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60
                     flex items-center justify-center opacity-0 group-hover:opacity-100
                     hover:bg-red-500/80 transition-all duration-100 cursor-pointer"
        >
          <Trash2 className="w-3 h-3 text-white" />
        </button>

        {item.duration !== null && item.duration > 0 && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px]
                          font-medium bg-black/70 text-white/90">
            {fmtDuration(item.duration)}
          </span>
        )}
      </div>

      <div className="mt-1.5 px-0.5">
        <p className="text-xs text-white/80 truncate">{item.title}</p>
        {item.file_size !== null && item.file_size > 0 && (
          <p className="text-[10px] text-white/40 mt-0.5">
            {fmtSize(item.file_size)}
          </p>
        )}
      </div>
    </motion.div>
  );
}
