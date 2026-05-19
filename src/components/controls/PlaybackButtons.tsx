import { motion } from "framer-motion";
import { Play, Pause } from "lucide-react";
import Seek10Icon from "./Seek10Icon";

interface Props {
  isPlaying: boolean;
  onPlayPause: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  // Kept on the prop type so callers (ControlBar) don't need to change, but
  // currently unused — frame-step buttons were removed from the bar UX.
  onFrameStep?: (backward: boolean) => void;
}

export default function PlaybackButtons({
  isPlaying,
  onPlayPause,
  onSkipBack,
  onSkipForward,
}: Props) {
  return (
    <>
      <motion.button
        className="w-8 h-8 flex items-center justify-center text-white/80
                   hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                   transition-colors duration-100"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.88 }}
        onClick={onSkipBack}
        aria-label="Previous"
        title="Back 10 seconds (J / ←)"
      >
        <Seek10Icon direction="back" />
      </motion.button>
      <motion.button
        className="w-9 h-9 flex items-center justify-center text-white rounded-lg
                   hover:bg-white/10 cursor-pointer transition-colors duration-100"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.88 }}
        onClick={onPlayPause}
        aria-label="Play / Pause"
        title="Play / Pause (Space / K)"
      >
        {isPlaying ? (
          <Pause className="w-5 h-5" fill="currentColor" />
        ) : (
          <Play className="w-5 h-5 translate-x-px" fill="currentColor" />
        )}
      </motion.button>

      <motion.button
        className="w-8 h-8 flex items-center justify-center text-white/80
                   hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                   transition-colors duration-100"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.88 }}
        onClick={onSkipForward}
        aria-label="Next"
        title="Forward 10 seconds (L / →)"
      >
        <Seek10Icon direction="forward" />
      </motion.button>
    </>
  );
}
