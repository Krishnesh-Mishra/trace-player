import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import type { LibraryItem, FolderEntry } from "./types";

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const prev = document.activeElement as HTMLElement;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length) focusable[0].focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', handler);
    return () => {
      el.removeEventListener('keydown', handler);
      prev?.focus();
    };
  }, [active]);
}

interface Props {
  open: boolean;
  item?: LibraryItem | null;
  folder?: FolderEntry | null;
  onClose: () => void;
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

function fmtSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(epoch: number | null): string {
  if (!epoch) return "Unknown";
  return new Date(epoch * 1000).toLocaleString();
}

export default function PropertiesDialog({ open, item, folder, onClose }: Props) {
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setFileMeta(null);
      setMediaInfo(null);
      return;
    }
    if (item?.path) {
      invoke<FileMeta>("get_file_metadata", { path: item.path })
        .then(setFileMeta)
        .catch(() => {});
      invoke<MediaInfo>("probe_video_info", { path: item.path })
        .then(setMediaInfo)
        .catch(() => {});
    }
  }, [open, item?.path]);

  const rows: { label: string; value: string }[] = [];

  if (item) {
    rows.push({ label: "Title", value: item.title });
    rows.push({ label: "Type", value: item.tab === "torrents" ? "Torrent" : "Local Video" });
    if (item.path) rows.push({ label: "Path", value: item.path });
    if (item.magnet_uri) rows.push({ label: "Magnet", value: item.magnet_uri.slice(0, 60) + "..." });
    if (item.file_index !== null) rows.push({ label: "File Index", value: String(item.file_index) });
    const size = fileMeta?.size ?? item.file_size;
    rows.push({ label: "Size", value: fmtSize(size) });
    if (mediaInfo && mediaInfo.width > 0 && mediaInfo.height > 0) {
      rows.push({ label: "Resolution", value: `${mediaInfo.width}x${mediaInfo.height}` });
    }
    if (mediaInfo) {
      rows.push({ label: "Video Streams", value: String(mediaInfo.videoCount) });
      rows.push({ label: "Audio Streams", value: String(mediaInfo.audioCount) });
      rows.push({ label: "Subtitles", value: String(mediaInfo.subtitleCount) });
    }
    if (fileMeta?.created) rows.push({ label: "Created", value: fmtDate(fileMeta.created) });
    if (fileMeta?.modified) rows.push({ label: "Modified", value: fmtDate(fileMeta.modified) });
    rows.push({ label: "Added", value: fmtDate(item.added_at) });
    if (item.last_played) rows.push({ label: "Last Played", value: fmtDate(item.last_played) });
    rows.push({ label: "Play Count", value: String(item.play_count) });
  } else if (folder) {
    rows.push({ label: "Name", value: folder.name });
    rows.push({ label: "Type", value: "Folder" });
    rows.push({ label: "Tab", value: folder.tab });
    rows.push({ label: "Created", value: fmtDate(folder.created_at) });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[70] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/50" />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Properties"
            className="relative bg-[#111] rounded-2xl shadow-2xl
                       w-[360px] p-5"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white/90">Properties</h3>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-6 h-6 flex items-center justify-center text-white/40
                           hover:text-white rounded-md hover:bg-white/10 cursor-pointer
                           transition-colors duration-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.label} className="flex gap-3">
                  <span className="text-[11px] text-white/40 w-20 shrink-0">{row.label}</span>
                  <span className="text-[11px] text-white/80 break-all">{row.value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
