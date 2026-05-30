import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
  onSubmit: (url: string, append: boolean) => Promise<void> | void;
  onClose: () => void;
}

const HTTP_PREFIXES = ["http://", "https://", "rtsp://", "rtmp://", "rtmps://", "mms://"];

function validate(value: string): string | null {
  const t = value.trim();
  if (!t) return "Enter a stream URL";
  const lower = t.toLowerCase();
  if (HTTP_PREFIXES.some((p) => lower.startsWith(p))) return null;
  return "Paste a stream URL (http, https, rtsp, rtmp, or mms)";
}

export default function OpenSourceDialog({ open, onSubmit, onClose }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

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

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void submit(false); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Open source"
            className="bg-[var(--np-overlay)] backdrop-blur-xl rounded-2xl
                       shadow-2xl p-5 w-[460px] max-w-[92vw] flex flex-col gap-4"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-[var(--np-text)]">Open URL</span>
              <span className="text-[10px] text-[var(--np-text-tertiary)]">
                Paste a stream URL (http, https, rtsp, rtmp, mms)
              </span>
            </div>

            <input
              ref={inputRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              onKeyDown={handleKey}
              placeholder="https://stream.example.com/video.mp4"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={`w-full bg-[var(--np-hover)] rounded-lg px-3 py-2 text-sm text-[var(--np-text)]
                          placeholder:text-[var(--np-text-muted)] outline-none focus:ring-1 truncate
                          transition-colors duration-100
                          ${error
                            ? "ring-1 ring-red-500/60 focus:ring-red-500/40"
                            : "focus:ring-[var(--np-active)]"
                          }`}
            />

            {error && (
              <span className="text-[11px] text-red-400 leading-snug">{error}</span>
            )}

            <div className="flex gap-2 justify-between items-center">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 text-xs text-[var(--np-text-tertiary)] hover:text-[var(--np-text)]
                           rounded-lg hover:bg-[var(--np-hover)] transition-colors duration-100 cursor-pointer
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Cancel
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
