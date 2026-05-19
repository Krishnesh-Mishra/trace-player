import { useCallback, useEffect, useRef, useState } from "react";
import React from "react";
import { motion } from "framer-motion";
import { Play, Pause, Maximize2, X } from "lucide-react";

interface Props {
  isPlaying: boolean;
  progressRef: React.RefObject<number>; // 0..100
  onPlayPause: () => void;
  onExitPip: () => void;
  onSeekCommit: (pct: number) => void;
}

/** Minimal control strip shown at the bottom of the window in PiP mode. */
export default function PipBar({
  isPlaying,
  progressRef,
  onPlayPause,
  onExitPip,
  onSeekCommit,
}: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const [localPct, setLocalPct] = useState<number | null>(null);
  const draggingRef = useRef(false);

  // Sync the fill bar from the ref at ~60fps when not dragging.
  useEffect(() => {
    let active = true;
    const tick = () => {
      if (!active) return;
      if (!draggingRef.current && fillRef.current) {
        fillRef.current.style.width = `${progressRef.current}%`;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { active = false; };
  }, [progressRef]);

  const getPct = useCallback((e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    const pct = getPct(e);
    setLocalPct(pct);
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
  }, [getPct]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.buttons & 1)) return;
    const pct = getPct(e);
    setLocalPct(pct);
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
  }, [getPct]);

  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    if (draggingRef.current && localPct !== null) {
      onSeekCommit(localPct);
    }
    draggingRef.current = false;
    setLocalPct(null);
  }, [localPct, onSeekCommit]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className="absolute bottom-0 left-0 right-0 z-30 px-2 py-1.5
                 bg-black/55 backdrop-blur-md border-t border-white/10
                 flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={onPlayPause}
        aria-label="Play / Pause"
        className="w-7 h-7 rounded-full flex items-center justify-center
                   text-white hover:bg-white/15 transition-colors"
      >
        {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>

      <div
        className="flex-1 h-1.5 rounded-full bg-white/20 cursor-pointer relative"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${progressRef.current}%`, background: "var(--np-accent, #fff)" }}
        />
      </div>

      <button
        onClick={onExitPip}
        aria-label="Restore"
        title="Restore"
        className="w-7 h-7 rounded-full flex items-center justify-center
                   text-white/80 hover:text-white hover:bg-white/15 transition-colors"
      >
        <Maximize2 size={13} />
      </button>
      <button
        onClick={onExitPip}
        aria-label="Exit Picture in Picture"
        title="Exit PiP"
        className="w-7 h-7 rounded-full flex items-center justify-center
                   text-white/60 hover:text-white hover:bg-white/15 transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
