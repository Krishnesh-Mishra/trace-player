import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2 } from "lucide-react";

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
  name: string;
  isFolder: boolean;
  onConfirm: (mode: "deleteAll" | "moveToParent") => void;
  onCancel: () => void;
}

export default function DeleteConfirmDialog({ open, name, isFolder, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

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
          className="absolute inset-0 z-[80] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <div className="absolute inset-0 bg-black/50" />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Delete confirmation"
            className="relative bg-[var(--np-surface)] rounded-xl shadow-2xl
                       w-[320px] p-4"
            initial={{ scale: 0.92 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-400" />
              </div>
              <h3 className="text-sm font-medium text-[var(--np-text)]">Delete</h3>
            </div>

            <p className="text-[11px] text-[var(--np-text-secondary)] mb-4 leading-relaxed">
              {isFolder ? (
                <>
                  Delete <span className="text-[var(--np-text)] font-medium">"{name}"</span>?
                  Choose what happens to the items inside.
                </>
              ) : (
                <>
                  Are you sure you want to delete <span className="text-[var(--np-text)] font-medium">"{name}"</span>?
                  This cannot be undone.
                </>
              )}
            </p>

            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-xs text-[var(--np-text-tertiary)] hover:text-[var(--np-text)]
                           rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                           transition-colors duration-100"
              >
                Cancel
              </button>
              {isFolder ? (
                <>
                  <button
                    onClick={() => onConfirm("moveToParent")}
                    className="px-3 py-1.5 text-xs font-medium text-[var(--np-text)] bg-[var(--np-hover)]
                               rounded-lg hover:bg-[var(--np-active)] active:scale-95
                               transition-all duration-100 cursor-pointer"
                  >
                    Move to Parent
                  </button>
                  <button
                    onClick={() => onConfirm("deleteAll")}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-red-500
                               rounded-lg hover:bg-red-500/90 active:scale-95
                               transition-all duration-100 cursor-pointer"
                  >
                    Delete All
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onConfirm("deleteAll")}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-red-500
                             rounded-lg hover:bg-red-500/90 active:scale-95
                             transition-all duration-100 cursor-pointer"
                >
                  Delete
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
