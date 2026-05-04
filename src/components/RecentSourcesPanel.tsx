import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Globe, FolderOpen, Magnet, X, Trash2 } from "lucide-react";

interface Props {
  open: boolean;
  recents: string[];
  onPick: (path: string) => void;
  onClear: () => void;
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
      icon: <Magnet className="w-4 h-4 text-white/70 shrink-0" />,
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
      icon: <Globe className="w-4 h-4 text-white/70 shrink-0" />,
      label: path,
      sub: host,
    };
  }
  // Local path: pluck the filename for the headline.
  const fname = path.split(/[/\\]/).pop() || path;
  return {
    icon: <FolderOpen className="w-4 h-4 text-white/70 shrink-0" />,
    label: fname,
    sub: path,
  };
}

export default function RecentSourcesPanel({
  open,
  recents,
  onPick,
  onClear,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

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
                     bg-[#0c0c0c]/95 backdrop-blur-xl border-l border-white/10
                     flex flex-col"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8">
            <span className="flex items-center gap-2 text-sm text-white/90">
              <Clock className="w-3.5 h-3.5 text-white/60" />
              Recent
            </span>
            <div className="flex items-center gap-1">
              {recents.length > 0 && (
                <button
                  onClick={onClear}
                  title="Clear recent"
                  className="p-1.5 text-white/55 hover:text-white/90 hover:bg-white/8
                             rounded-lg cursor-pointer transition-colors duration-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={onClose}
                title="Close"
                className="p-1.5 text-white/55 hover:text-white/90 hover:bg-white/8
                           rounded-lg cursor-pointer transition-colors duration-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-1 py-1">
            {recents.length === 0 ? (
              <div className="text-[11px] text-white/40 px-3 py-6 text-center">
                Nothing here yet — files and URLs you open will show up.
              </div>
            ) : (
              recents.map((p) => {
                const c = classify(p);
                return (
                  <button
                    key={p}
                    onClick={() => {
                      onPick(p);
                      onClose();
                    }}
                    className="w-full flex items-start gap-2.5 px-3 py-2
                               text-left text-sm text-white/85 rounded-lg
                               hover:bg-white/10 cursor-pointer
                               transition-colors duration-100"
                  >
                    <span className="mt-0.5">{c.icon}</span>
                    <span className="flex flex-col items-start min-w-0">
                      <span className="truncate w-full">{c.label}</span>
                      <span className="text-[9px] text-white/40 truncate w-full">
                        {c.sub}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
