import { motion } from "framer-motion";
import type { BarSize } from "../../types";
import { APPEARANCE_BARSIZE_OPTIONS } from "../../types";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  barSize: BarSize;
  onChange: (b: BarSize) => void;
  onBack: () => void;
}

export default function AppearanceBarSizePage({
  direction,
  barSize,
  onChange,
  onBack,
}: Props) {
  return (
    <motion.div
      key="appearance_bar_size"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Control bar size" onClick={onBack} />

      <div className="px-1 pb-2">
        {APPEARANCE_BARSIZE_OPTIONS.map((opt) => (
          <TrackOption
            key={opt.value}
            label={opt.label}
            selected={barSize === opt.value}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>
    </motion.div>
  );
}
