import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";

interface Props {
  open: boolean;
  onSubmit: (url: string, append: boolean) => Promise<void> | void;
  onClose: () => void;
}

const HTTP_PREFIXES = ["http://", "https://", "rtsp://", "rtmp://", "rtmps://", "mms://"];

function validate(value: string): string | null {
  const t = value.trim();
  if (!t) return "Enter a magnet link, .torrent path, or stream URL";
  const lower = t.toLowerCase();
  if (lower.startsWith("magnet:")) return null;
  if (lower.endsWith(".torrent")) return null;
  if (HTTP_PREFIXES.some((p) => lower.startsWith(p))) return null;
  return "Paste a magnet link, a stream URL (http/https/rtsp/rtmp), or pick a .torrent file";
}

function isTorrentInput(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return lower.startsWith("magnet:") || lower.endsWith(".torrent");
}

export default function OpenSourceDialog({ open, onSubmit, onClose }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
      setBusy(false);
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = async (append: boolean) => {
    const err = validate(value);
    if (err) { setError(err); return; }
    try {
      setBusy(true);
      await onSubmit(value.trim(), append);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const pickTorrent = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "Torrent file", extensions: ["torrent"] }],
      });
      if (typeof selected === "string") {
        setValue(selected);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void submit(false); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  const showTorrentPicker = !value.trim() || isTorrentInput(value);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-[#111]/95 backdrop-blur-xl border border-white/10 rounded-2xl
                       shadow-2xl p-5 w-[460px] max-w-[92vw] flex flex-col gap-4"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-white">Open source</span>
              <span className="text-[10px] text-white/40">
                Paste a magnet link, stream URL (http/https/rtsp/rtmp/mms), or pick a .torrent file
              </span>
            </div>

            <input
              ref={inputRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              onKeyDown={handleKey}
              placeholder="magnet:?xt=urn:btih:…  •  http://stream.example.com/video.mp4"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={`w-full bg-white/8 border rounded-lg px-3 py-2 text-sm text-white
                          placeholder:text-white/25 outline-none focus:ring-1 truncate
                          transition-colors duration-100
                          ${error
                            ? "border-red-500/60 focus:ring-red-500/40"
                            : "border-white/10 focus:border-white/30 focus:ring-white/20"
                          }`}
            />

            {showTorrentPicker && (
              <button
                onClick={pickTorrent}
                className="w-full flex items-center justify-center gap-2 py-2
                           bg-white/8 hover:bg-white/15 text-xs text-white/85
                           rounded-lg cursor-pointer transition-colors duration-100"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Choose .torrent file
              </button>
            )}

            {error && (
              <span className="text-[11px] text-red-400 leading-snug">{error}</span>
            )}

            <div className="flex gap-2 justify-between items-center">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80
                           rounded-lg hover:bg-white/8 transition-colors duration-100 cursor-pointer
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => void submit(true)}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium text-white/85
                             border border-white/20 hover:border-white/35 hover:bg-white/8
                             rounded-lg transition-all duration-100 cursor-pointer
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add to playlist
                </button>
                <button
                  onClick={() => void submit(false)}
                  disabled={busy}
                  className="px-4 py-1.5 text-xs font-medium text-black bg-white
                             rounded-lg hover:bg-white/90 active:scale-95
                             transition-all duration-100 cursor-pointer
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? "Opening…" : "Play"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
