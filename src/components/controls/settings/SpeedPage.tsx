import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { SPEEDS } from "../../types";
import { BackHeader, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  playbackSpeed: number;
  onSpeedChange: (s: number) => void;
  onClose: () => void;
  onBack: () => void;
}

export default function SpeedPage({
  direction,
  playbackSpeed,
  onSpeedChange,
  onClose,
  onBack,
}: Props) {
  return (
    <motion.div
      key="speed"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Playback Speed" onClick={onBack} />
      <div className="px-1 py-1 max-h-48 overflow-y-auto">
        {SPEEDS.map((s) => (
          <motion.button
            key={s}
            className="w-full flex items-center justify-between px-3 py-2
                       text-sm text-white/90 rounded-lg hover:bg-white/10 cursor-pointer
                       transition-colors duration-100"
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              onSpeedChange(s);
              onClose();
            }}
          >
            <span>{s === 1 ? "Normal" : `${s}×`}</span>
            {playbackSpeed === s && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
              >
                <Check className="w-3.5 h-3.5 text-white/70" />
              </motion.div>
            )}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
