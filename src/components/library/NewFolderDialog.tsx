import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderPlus } from "lucide-react";

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
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function NewFolderDialog({ open, onConfirm, onCancel }: Props) {
  const [name, setName] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

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

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="New folder"
            className="relative bg-[var(--np-surface)] rounded-xl shadow-2xl w-[300px] p-4"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <FolderPlus className="w-4 h-4 text-[var(--np-text-tertiary)]" />
              <h3 className="text-sm font-medium text-[var(--np-text)]">New Folder</h3>
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
              className="w-full bg-[var(--np-hover)] rounded-lg px-3 py-2 text-xs text-[var(--np-text)]
                         placeholder:text-[var(--np-text-muted)] outline-none mb-3"
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={handleClose}
                className="px-3 py-1.5 text-xs text-[var(--np-text-tertiary)] hover:text-[var(--np-text)]
                           rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
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
