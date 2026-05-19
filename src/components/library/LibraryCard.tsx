import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { Play, Trash2 as _Trash2, Film } from "lucide-react";
import type { LibraryItem } from "./types";

interface Props {
  item: LibraryItem;
  onPlay: () => void;
  onDelete: () => void;
  renaming?: boolean;
  onRenameSubmit?: (name: string) => void;
  onRenameCancel?: () => void;
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
  onDelete: _onDelete,
  renaming,
  onRenameSubmit,
  onRenameCancel,
}: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!item.thumb_path) return;
    invoke<string>("read_thumb_base64", { path: item.thumb_path })
      .then((b64) => setThumbUrl(`data:image/jpeg;base64,${b64}`))
      .catch(() => {});
  }, [item.thumb_path]);

  return (
    <motion.div
      className="group cursor-pointer"
      whileTap={{ scale: 0.97 }}
      onClick={onPlay}
    >
      <div className="relative aspect-video rounded-lg overflow-hidden bg-[var(--np-hover)]">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-8 h-8 text-[var(--np-text-muted)]" />
          </div>
        )}

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-150 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <div className="w-10 h-10 rounded-full bg-[var(--np-selected)] backdrop-blur-sm flex items-center justify-center">
              <Play className="w-5 h-5 text-[var(--np-text)] fill-[var(--np-text)]" />
            </div>
          </div>
        </div>

        {/* <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60
                     flex items-center justify-center opacity-0 group-hover:opacity-100
                     hover:bg-red-500/80 transition-all duration-100 cursor-pointer"
        >
          <Trash2 className="w-3 h-3 text-white" />
        </button> */}

        {item.duration !== null && item.duration > 0 && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px]
                          font-medium bg-black/70 text-[var(--np-text)]">
            {fmtDuration(item.duration)}
          </span>
        )}
      </div>

      <div className="mt-1.5 px-0.5">
        {renaming ? (
          <input
            type="text"
            defaultValue={item.title}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onRenameSubmit?.((e.target as HTMLInputElement).value);
              if (e.key === "Escape") onRenameCancel?.();
            }}
            onBlur={(e) => onRenameSubmit?.(e.target.value)}
            className="w-full bg-[var(--np-hover)] rounded px-1.5 py-0.5
                       text-xs text-[var(--np-text)] outline-none"
          />
        ) : (
          <p className="text-xs text-[var(--np-text)] truncate">{item.title}</p>
        )}
        {item.file_size !== null && item.file_size > 0 && (
          <p className="text-[10px] text-[var(--np-text-tertiary)] mt-0.5">
            {fmtSize(item.file_size)}
          </p>
        )}
      </div>
    </motion.div>
  );
}
