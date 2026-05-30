import { motion } from "framer-motion";
import type { SeekBarSize } from "../../types";
import { APPEARANCE_SEEKBAR_OPTIONS } from "../../types";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  seekBarSize: SeekBarSize;
  onChange: (s: SeekBarSize) => void;
  onBack: () => void;
}

export default function AppearanceSeekBarPage({
  direction,
  seekBarSize,
  onChange,
  onBack,
}: Props) {
  return (
    <motion.div
      key="appearance_seek_bar_size"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Seek bar thickness" onClick={onBack} />

      <div className="px-1 pb-2">
        {APPEARANCE_SEEKBAR_OPTIONS.map((opt) => (
          <TrackOption
            key={opt.value}
            label={opt.label}
            selected={seekBarSize === opt.value}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>
    </motion.div>
  );
}
