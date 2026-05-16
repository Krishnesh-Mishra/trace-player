import { motion, AnimatePresence } from "framer-motion";
import { Play, Download, X } from "lucide-react";
import type { LibraryItem } from "./types";

interface Props {
  open: boolean;
  item: LibraryItem | null;
  onClose: () => void;
  onStream: (item: LibraryItem) => void;
  onDownload: (item: LibraryItem) => void;
}

export default function TorrentActionDialog({
  open,
  item,
  onClose,
  onStream,
  onDownload,
}: Props) {
  if (!item) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[60] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60" />
          <motion.div
            className="relative bg-[#111] border border-white/10 rounded-2xl shadow-2xl
                       w-[340px] p-5"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-white/90">
                Play Torrent
              </h3>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center text-white/40
                           hover:text-white rounded-md hover:bg-white/10 cursor-pointer
                           transition-colors duration-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-white/50 mb-4 truncate">
              {item.title}
            </p>

            <div className="space-y-2">
              <button
                onClick={() => {
                  onStream(item);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg
                           border border-white/10 bg-white/[0.03] hover:bg-white/[0.08]
                           cursor-pointer transition-colors duration-100"
              >
                <Play className="w-5 h-5 text-white/50" />
                <div className="text-left">
                  <p className="text-xs text-white/80">Stream Now</p>
                  <p className="text-[10px] text-white/40">
                    Play immediately via streaming
                  </p>
                </div>
              </button>
              <button
                onClick={() => {
                  onDownload(item);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg
                           border border-white/10 bg-white/[0.03] hover:bg-white/[0.08]
                           cursor-pointer transition-colors duration-100"
              >
                <Download className="w-5 h-5 text-white/50" />
                <div className="text-left">
                  <p className="text-xs text-white/80">Download First</p>
                  <p className="text-[10px] text-white/40">
                    Download to disk, then play locally
                  </p>
                </div>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
