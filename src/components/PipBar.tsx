import { motion } from "framer-motion";
import { Play, Pause, Maximize2, X } from "lucide-react";

interface Props {
  isPlaying: boolean;
  progress: number; // 0..100
  onPlayPause: () => void;
  onExitPip: () => void;
  onSeekCommit: (pct: number) => void;
}

/** Minimal control strip shown at the bottom of the window in PiP mode. */
export default function PipBar({
  isPlaying,
  progress,
  onPlayPause,
  onExitPip,
  onSeekCommit,
}: Props) {
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
        className="w-7 h-7 rounded-full flex items-center justify-center
                   text-white hover:bg-white/15 transition-colors"
      >
        {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>

      <div
        className="flex-1 h-1.5 rounded-full bg-white/20 cursor-pointer relative"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const rect = e.currentTarget.getBoundingClientRect();
          onSeekCommit(((e.clientX - rect.left) / rect.width) * 100);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeekCommit(
              Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
            );
          }
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${progress}%`, background: "var(--np-accent, #fff)" }}
        />
      </div>

      <button
        onClick={onExitPip}
        title="Restore"
        className="w-7 h-7 rounded-full flex items-center justify-center
                   text-white/80 hover:text-white hover:bg-white/15 transition-colors"
      >
        <Maximize2 size={13} />
      </button>
      <button
        onClick={onExitPip}
        title="Exit PiP"
        className="w-7 h-7 rounded-full flex items-center justify-center
                   text-white/60 hover:text-white hover:bg-white/15 transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
