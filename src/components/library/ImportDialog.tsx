import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Magnet, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onImportLocal: (path: string, title: string) => void;
  onImportTorrent: (magnetUri: string, title: string) => void;
}

export default function ImportDialog({
  open: isOpen,
  onClose,
  onImportLocal,
  onImportTorrent,
}: Props) {
  const [mode, setMode] = useState<"pick" | "torrent">("pick");
  const [magnetInput, setMagnetInput] = useState("");
  const [error, setError] = useState("");

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

  const handleTorrentSubmit = () => {
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
    onImportTorrent(val, title);
    setMagnetInput("");
    setError("");
    onClose();
  };

  const handleClose = () => {
    setMode("pick");
    setMagnetInput("");
    setError("");
    onClose();
  };

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
            className="relative bg-[#111] border border-white/10 rounded-2xl shadow-2xl
                       w-[380px] p-5"
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
                             border border-white/10 bg-white/[0.03] hover:bg-white/[0.08]
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
                             border border-white/10 bg-white/[0.03] hover:bg-white/[0.08]
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
                  className={`w-full bg-white/8 border rounded-lg px-3 py-2 text-sm text-white
                             placeholder:text-white/25 outline-none focus:ring-1
                             transition-colors duration-100 ${
                               error
                                 ? "border-red-500/60 focus:ring-red-500/40"
                                 : "border-white/10 focus:border-white/30 focus:ring-white/20"
                             }`}
                />
                {error && (
                  <p className="text-[10px] text-red-400">{error}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setMode("pick");
                      setError("");
                    }}
                    className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80
                               rounded-lg hover:bg-white/8 cursor-pointer
                               transition-colors duration-100"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleTorrentSubmit}
                    className="px-4 py-1.5 text-xs font-medium text-black bg-white
                               rounded-lg hover:bg-white/90 active:scale-95
                               transition-all duration-100 cursor-pointer"
                  >
                    Add
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
