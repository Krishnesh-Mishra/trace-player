import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fmtTime } from "./types";

interface Props {
  open: boolean;
  duration: number;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}

function parseTime(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => isNaN(n) || n < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export default function JumpToTimeDialog({ open, duration, onSeek, onClose }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(false);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  const commit = () => {
    const secs = parseTime(value);
    if (secs === null || (duration > 0 && secs > duration)) {
      setError(true);
      return;
    }
    onSeek(secs);
    onClose();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
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
            className="bg-[#111]/90 backdrop-blur-xl  rounded-2xl
                       shadow-2xl p-5 w-72 flex flex-col gap-4"
            initial={{ scale: 0.92, y: -8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-white">Jump to time</span>
              {duration > 0 && (
                <span className="text-[10px] text-white/40">Duration: {fmtTime(duration)}</span>
              )}
            </div>

            <input
              ref={inputRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(false); }}
              onKeyDown={handleKey}
              placeholder="0:00  or  HH:MM:SS"
              className={`w-full bg-white/8 border rounded-lg px-3 py-2 text-sm text-white
                         placeholder:text-white/25 outline-none focus:ring-1
                         transition-colors duration-100
                         ${error
                           ? "border-red-500/60 focus:ring-red-500/40"
                           : "border-white/10 focus:border-white/30 focus:ring-white/20"
                         }`}
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80
                           rounded-lg hover:bg-white/8 transition-colors duration-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={commit}
                className="px-4 py-1.5 text-xs font-medium text-black bg-white
                           rounded-lg hover:bg-white/90 active:scale-95
                           transition-all duration-100 cursor-pointer"
              >
                Go
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
