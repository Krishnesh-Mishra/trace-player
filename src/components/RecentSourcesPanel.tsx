import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Globe, FolderOpen, Magnet, X, Trash2 } from "lucide-react";
import type { WatchHistoryEntry } from "../App";

interface Props {
  open: boolean;
  recents: WatchHistoryEntry[];
  onPick: (path: string) => void;
  onClear: () => void;
  onRemove: (path: string) => void;
  onClose: () => void;
}

function classify(path: string): {
  icon: React.ReactNode;
  label: string;
  sub: string;
} {
  const lower = path.toLowerCase();
  if (lower.startsWith("magnet:")) {
    const dn = /dn=([^&]+)/.exec(path)?.[1];
    return {
      icon: <Magnet className="w-4 h-4 text-[var(--np-text-secondary)] shrink-0" />,
      label: dn ? decodeURIComponent(dn).replace(/\+/g, " ") : "Magnet link",
      sub: "Torrent",
    };
  }
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("rtsp://") ||
    lower.startsWith("rtmp://") ||
    lower.startsWith("rtmps://") ||
    lower.startsWith("mms://")
  ) {
    let host = path;
    try {
      host = new URL(path).hostname.replace(/^www\./, "");
    } catch {
      /* ignore */
    }
    return {
      icon: <Globe className="w-4 h-4 text-[var(--np-text-secondary)] shrink-0" />,
      label: path,
      sub: host,
    };
  }
  const fname = path.split(/[/\\]/).pop() || path;
  return {
    icon: <FolderOpen className="w-4 h-4 text-[var(--np-text-secondary)] shrink-0" />,
    label: fname,
    sub: path,
  };
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export default function RecentSourcesPanel({
  open,
  recents,
  onPick,
  onClear,
  onRemove,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClearClick = useCallback(() => {
    if (confirmClear) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
      setConfirmClear(false);
      onClear();
    } else {
      setConfirmClear(true);
      confirmTimer.current = setTimeout(() => {
        setConfirmClear(false);
        confirmTimer.current = null;
      }, 3000);
    }
  }, [confirmClear, onClear]);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current && t && !panelRef.current.contains(t)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          className="absolute top-0 right-0 bottom-0 w-80 z-50
                     bg-[var(--np-overlay-heavy)] backdrop-blur-xl border-l border-[var(--np-divider)]
                     flex flex-col"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--np-divider)]">
            <span className="flex items-center gap-2 text-sm text-[var(--np-text)]">
              <Clock className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
              Recent
            </span>
            <div className="flex items-center gap-1">
              {recents.length > 0 && (
                <button
                  onClick={handleClearClick}
                  title="Clear recent"
                  className={`flex items-center gap-1 px-1.5 py-1 rounded-lg cursor-pointer
                             transition-colors duration-100
                             ${confirmClear
                               ? "text-red-400 hover:text-red-300 hover:bg-red-500/15"
                               : "text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-hover)]"
                             }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmClear && (
                    <span className="text-[11px] whitespace-nowrap">Confirm?</span>
                  )}
                </button>
              )}
              <button
                onClick={onClose}
                title="Close"
                className="p-1.5 text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] hover:bg-[var(--np-hover)]
                           rounded-lg cursor-pointer transition-colors duration-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-1 py-1">
            {recents.length === 0 ? (
              <div className="text-[11px] text-[var(--np-text-tertiary)] px-3 py-6 text-center">
                Nothing here yet — files and URLs you open will show up.
              </div>
            ) : (
              recents.map((entry) => {
                const c = classify(entry.path);
                const hasProgress = entry.position > 10 && entry.duration > 0 && entry.position < entry.duration - 30;
                const pct = entry.duration > 0 ? Math.min((entry.position / entry.duration) * 100, 100) : 0;
                return (
                  <div
                    key={entry.path}
                    className="group relative flex items-start gap-2.5 px-3 py-2
                               text-left text-sm text-[var(--np-text)] rounded-lg
                               hover:bg-[var(--np-hover)] cursor-pointer
                               transition-colors duration-100"
                    onClick={() => {
                      onPick(entry.path);
                      onClose();
                    }}
                  >
                    <span className="mt-0.5">{c.icon}</span>
                    <span className="flex flex-col items-start min-w-0 flex-1">
                      <span className="truncate w-full">{c.label}</span>
                      <span className="text-[9px] text-[var(--np-text-tertiary)] truncate w-full">
                        {c.sub}
                      </span>
                      {hasProgress && (
                        <span className="flex items-center gap-1.5 mt-0.5 w-full">
                          <span className="flex-1 h-[2px] rounded-full bg-[var(--np-divider)] overflow-hidden">
                            <span
                              className="block h-full rounded-full bg-[var(--np-accent)]"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="text-[8px] text-[var(--np-text-muted)] shrink-0">
                            {fmtTime(entry.position)}
                          </span>
                        </span>
                      )}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(entry.path);
                      }}
                      className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center shrink-0
                                 text-[var(--np-text-muted)] hover:text-red-400
                                 opacity-0 group-hover:opacity-100
                                 transition-opacity duration-100 cursor-pointer rounded"
                      title="Remove"
                      aria-label="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
