import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2, Shuffle, Repeat, Play, GripVertical } from "lucide-react";
import type { PlaylistItem } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  items: PlaylistItem[];
  loopPlaylist: boolean;
  onAdd: () => void;
  onClear: () => void;
  onShuffle: () => void;
  onLoopPlaylistToggle: () => void;
  onPlayIndex: (idx: number) => void;
  onRemove: (idx: number) => void;
  onMove: (from: number, to: number) => void;
}

/**
 * Right-side sliding playlist panel. Uses native HTML5 drag-and-drop for
 * reorder — the parent owns the actual playlist-move call, this component
 * just emits (from, to) and lets mpv re-broadcast the new state.
 */
export default function PlaylistPanel({
  open,
  onClose,
  items,
  loopPlaylist,
  onAdd,
  onClear,
  onShuffle,
  onLoopPlaylistToggle,
  onPlayIndex,
  onRemove,
  onMove,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  const handleDrop = (toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) {
      setDragIdx(null);
      setDropIdx(null);
      return;
    }
    onMove(dragIdx, toIdx);
    setDragIdx(null);
    setDropIdx(null);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          key="playlist-panel"
          className="absolute top-0 right-0 bottom-0 z-50
                     w-[340px] bg-[#0d0d0f]/95 backdrop-blur-xl
                     border-l border-white/10 shadow-2xl
                     flex flex-col"
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 h-12 border-b border-white/10 shrink-0">
            <h2 className="text-sm font-medium text-white tracking-wide">
              Playlist
              {items.length > 0 && (
                <span className="ml-2 text-[10px] text-white/40 tabular-nums">
                  {items.length}
                </span>
              )}
            </h2>
            <motion.button
              className="w-7 h-7 flex items-center justify-center text-white/60
                         hover:text-white rounded-md hover:bg-white/10 cursor-pointer
                         transition-colors duration-100"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </motion.button>
          </div>

          <div className="flex items-center gap-1 px-3 py-2 border-b border-white/8 shrink-0">
            <ToolbarButton onClick={onAdd} icon={<Plus className="w-3.5 h-3.5" />} label="Add" />
            <ToolbarButton onClick={onShuffle} icon={<Shuffle className="w-3.5 h-3.5" />} label="Shuffle" />
            <ToolbarButton
              onClick={onLoopPlaylistToggle}
              icon={<Repeat className="w-3.5 h-3.5" />}
              label="Loop"
              active={loopPlaylist}
            />
            <div className="flex-1" />
            <ToolbarButton
              onClick={onClear}
              icon={<Trash2 className="w-3.5 h-3.5" />}
              label="Clear"
              destructive
            />
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                  <Play className="w-4 h-4 text-white/40 translate-x-0.5" />
                </div>
                <p className="text-xs text-white/60">Playlist is empty</p>
                <p className="text-[10px] text-white/35 mt-1 leading-snug">
                  Add files to queue them up. Auto-advance plays them in order.
                </p>
                <button
                  onClick={onAdd}
                  className="mt-4 px-3 py-1.5 text-[11px] bg-white/10 hover:bg-white/15
                             text-white/85 rounded-md cursor-pointer transition-colors"
                >
                  Add Files
                </button>
              </div>
            ) : (
              <ul className="px-2 space-y-0.5">
                {items.map((item, i) => (
                  <li
                    key={`${item.index}-${item.filename}`}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dropIdx !== i) setDropIdx(i);
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setDropIdx(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(i);
                    }}
                    className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
                                transition-colors duration-100
                                ${item.current ? "bg-[var(--np-accent-soft)] border border-[var(--np-accent)]/30" : "hover:bg-white/8"}
                                ${dropIdx === i && dragIdx !== i ? "ring-1 ring-[var(--np-accent)]" : ""}`}
                    onDoubleClick={() => onPlayIndex(item.index)}
                  >
                    <GripVertical className="w-3 h-3 text-white/30 shrink-0 cursor-grab" />
                    <button
                      className="w-5 h-5 flex items-center justify-center shrink-0 text-white/50 hover:text-white"
                      onClick={() => onPlayIndex(item.index)}
                      title="Play"
                    >
                      <Play className="w-3 h-3 translate-x-px" />
                    </button>
                    <div
                      className="flex-1 min-w-0"
                      onClick={() => onPlayIndex(item.index)}
                    >
                      <p
                        className={`text-[11px] truncate ${
                          item.current ? "text-white font-medium" : "text-white/85"
                        }`}
                        title={item.filename}
                      >
                        {item.title || displayName(item.filename)}
                      </p>
                    </div>
                    <button
                      className="w-5 h-5 flex items-center justify-center text-white/30
                                 hover:text-red-400 opacity-0 group-hover:opacity-100
                                 transition-opacity duration-100 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(item.index);
                      }}
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToolbarButton({
  onClick,
  icon,
  label,
  active,
  destructive,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  destructive?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className={`px-2 py-1 flex items-center gap-1 rounded-md text-[10px] cursor-pointer
                  transition-colors duration-100 ${
                    active
                      ? "bg-[var(--np-accent-soft)] text-[var(--np-accent)] border border-[var(--np-accent)]/30"
                      : destructive
                      ? "text-white/55 hover:text-red-300 hover:bg-red-500/10"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

/** Last path segment, decoded if URL-encoded. */
function displayName(p: string): string {
  if (!p) return "(unknown)";
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const tail = slash >= 0 ? p.slice(slash + 1) : p;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}
