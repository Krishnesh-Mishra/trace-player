import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Magnet, X, Loader2, FileUp } from "lucide-react";
import type { TorrentVideoInfo } from "./types";

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

interface ResolvedTorrent {
  magnet: string;
  name: string;
  videos: TorrentVideoInfo[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImportLocal: (path: string, title: string) => void;
  onImportTorrentResolved: (magnetUri: string, name: string, videos: TorrentVideoInfo[]) => void;
}

const PHASE_LABELS: Record<string, string> = {
  connecting: "Connecting to peers...",
  fetching_metadata: "Fetching file list...",
  done: "Processing...",
};

export default function ImportDialog({
  open: isOpen,
  onClose,
  onImportLocal,
  onImportTorrentResolved,
}: Props) {
  const [mode, setMode] = useState<"pick" | "torrent">("pick");
  const [magnetInput, setMagnetInput] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolvePhase, setResolvePhase] = useState("");
  const mountedRef = useRef(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!resolving) return;
    const unlisten = listen<string>("library:resolve-progress", (event) => {
      if (mountedRef.current) setResolvePhase(event.payload);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, [resolving]);

  const handleLocalFile = async () => {
    const result = await open({
      multiple: true,
      filters: [
        {
          name: "Video",
          extensions: [
            "mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "flv",
            "wmv", "mpg", "mpeg", "ogv", "3gp", "m2ts", "mts",
          ],
        },
      ],
    });
    if (result) {
      const paths = Array.isArray(result) ? result : [result];
      for (const p of paths) {
        const name = p.split(/[/\\]/).pop() || p;
        onImportLocal(p, name);
      }
      onClose();
    }
  };

  const handleTorrentSubmit = async () => {
    const val = magnetInput.trim();
    if (!val) return;
    if (!val.startsWith("magnet:")) {
      setError("Must be a magnet: link");
      return;
    }
    const dn = /dn=([^&]+)/.exec(val)?.[1];
    const title = dn
      ? decodeURIComponent(dn).replace(/\+/g, " ")
      : "Torrent";

    setResolving(true);
    setResolvePhase("connecting");
    setError("");
    try {
      const videos = await invoke<TorrentVideoInfo[]>("resolve_torrent_files", { magnet: val });
      if (mountedRef.current) {
        onImportTorrentResolved(val, title, videos);
        setResolving(false);
        setResolvePhase("");
        setMagnetInput("");
        onClose();
      }
    } catch (e) {
      if (mountedRef.current) {
        const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to resolve torrent";
        setError(msg);
        setResolving(false);
        setResolvePhase("");
      }
    }
  };

  const handleTorrentFile = async () => {
    const result = await open({
      multiple: false,
      filters: [{ name: "Torrent", extensions: ["torrent"] }],
    });
    if (!result) return;
    const path = Array.isArray(result) ? result[0] : result;
    setResolving(true);
    setResolvePhase("connecting");
    setError("");
    try {
      const resolved = await invoke<ResolvedTorrent>("resolve_torrent_file", { path });
      if (mountedRef.current) {
        onImportTorrentResolved(resolved.magnet, resolved.name, resolved.videos);
        setResolving(false);
        setResolvePhase("");
        onClose();
      }
    } catch (e) {
      if (mountedRef.current) {
        const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to resolve .torrent file";
        setError(msg);
        setResolving(false);
        setResolvePhase("");
      }
    }
  };

  const handleClose = () => {
    if (resolving) {
      invoke("cancel_torrent_resolve").catch(() => {});
    }
    setMode("pick");
    setMagnetInput("");
    setError("");
    setResolving(false);
    setResolvePhase("");
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); handleClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="absolute inset-0 z-[60] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/60" />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Import"
            className="relative bg-[#111] rounded-2xl shadow-2xl w-[380px] p-5"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white/90">Import</h3>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="w-6 h-6 flex items-center justify-center text-white/40
                           hover:text-white rounded-md hover:bg-white/10 cursor-pointer
                           transition-colors duration-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {mode === "pick" ? (
              <div className="space-y-2">
                <button
                  onClick={() => void handleLocalFile()}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg
                              bg-white/[0.03] hover:bg-white/[0.08]
                             cursor-pointer transition-colors duration-100"
                >
                  <FolderOpen className="w-5 h-5 text-white/50" />
                  <div className="text-left">
                    <p className="text-xs text-white/80">Local Video File</p>
                    <p className="text-[10px] text-white/40">
                      Browse your computer for video files
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setMode("torrent")}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg
                              bg-white/[0.03] hover:bg-white/[0.08]
                             cursor-pointer transition-colors duration-100"
                >
                  <Magnet className="w-5 h-5 text-white/50" />
                  <div className="text-left">
                    <p className="text-xs text-white/80">Torrent / Magnet Link</p>
                    <p className="text-[10px] text-white/40">
                      Add a magnet link to your library
                    </p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="magnet:?xt=urn:btih:..."
                  value={magnetInput}
                  onChange={(e) => {
                    setMagnetInput(e.target.value);
                    setError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleTorrentSubmit()}
                  autoFocus
                  className={`w-full bg-white/8 rounded-lg px-3 py-2 text-sm text-white
                             placeholder:text-white/25 outline-none focus:ring-1
                             transition-colors duration-100 ${
                               error
                                 ? "ring-1 ring-red-500/60 focus:ring-red-500/40"
                                 : "focus:ring-white/20"
                             }`}
                />
                <button
                  onClick={() => void handleTorrentFile()}
                  disabled={resolving}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg
                             bg-white/[0.03] hover:bg-white/[0.08]
                             cursor-pointer transition-colors duration-100
                             disabled:opacity-40 disabled:cursor-default"
                >
                  <FileUp className="w-4 h-4 text-white/50" />
                  <span className="text-[11px] text-white/60">Open .torrent file</span>
                </button>
                {error && (
                  <p className="text-[10px] text-red-400">{error}</p>
                )}
                <div className="flex gap-2 justify-end items-center">
                  {resolving && (
                    <span className="text-[10px] text-white/40 mr-auto">
                      {PHASE_LABELS[resolvePhase] || "Resolving..."}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setMode("pick");
                      setError("");
                    }}
                    disabled={resolving}
                    className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80
                               rounded-lg hover:bg-white/8 cursor-pointer
                               transition-colors duration-100 disabled:opacity-40"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => void handleTorrentSubmit()}
                    disabled={resolving}
                    className="px-4 py-1.5 text-xs font-medium text-black bg-white
                               rounded-lg hover:bg-white/90 active:scale-95
                               transition-all duration-100 cursor-pointer
                               disabled:opacity-60 flex items-center gap-1.5"
                  >
                    {resolving && <Loader2 className="w-3 h-3 animate-spin" />}
                    {resolving ? "Resolving" : "Add"}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
