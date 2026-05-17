import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderPlus } from "lucide-react";

interface Props {
  open: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function NewFolderDialog({ open, onConfirm, onCancel }: Props) {
  const [name, setName] = useState("");

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    setName("");
  };

  const handleClose = () => {
    setName("");
    onCancel();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[60] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/50" />
          <motion.div
            className="relative bg-[#141414] rounded-xl shadow-2xl w-[300px] p-4"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <FolderPlus className="w-4 h-4 text-white/50" />
              <h3 className="text-sm font-medium text-white/90">New Folder</h3>
            </div>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") handleClose();
              }}
              placeholder="Folder name"
              autoFocus
              className="w-full bg-white/8 rounded-lg px-3 py-2 text-xs text-white
                         placeholder:text-white/25 outline-none mb-3"
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={handleClose}
                className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80
                           rounded-lg hover:bg-white/8 cursor-pointer
                           transition-colors duration-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-1.5 text-xs font-medium text-black bg-white
                           rounded-lg hover:bg-white/90 active:scale-95
                           transition-all duration-100 cursor-pointer"
              >
                Create
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
