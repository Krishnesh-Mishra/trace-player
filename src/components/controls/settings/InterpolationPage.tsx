import { motion } from "framer-motion";
import type { InterpolationMode } from "../../types";
import { INTERPOLATION_OPTIONS } from "../../types";
import { BackHeader, TrackOption, ToggleRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  mode: InterpolationMode;
  vsync: boolean;
  exclusiveFullscreen: boolean;
  onModeChange: (m: InterpolationMode) => void;
  onVsyncChange: (b: boolean) => void;
  onExclusiveFullscreenChange: (b: boolean) => void;
  onBack: () => void;
}

export default function InterpolationPage({
  direction,
  mode,
  vsync,
  exclusiveFullscreen,
  onModeChange,
  onVsyncChange,
  onExclusiveFullscreenChange,
  onBack,
}: Props) {
  return (
    <motion.div
      key="video_interp"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Frame Smoothing" onClick={onBack} />

      <div className="px-1 py-2">
        {INTERPOLATION_OPTIONS.map((opt) => (
          <TrackOption
            key={opt.value}
            label={opt.label}
            description={opt.desc}
            selected={mode === opt.value}
            onClick={() => onModeChange(opt.value)}
          />
        ))}
      </div>

      <div className="px-3 py-2 border-t border-white/8 space-y-2.5">
        <ToggleRow
          label="VSync"
          description="Match output to display refresh — fewer tears"
          enabled={vsync}
          onToggle={() => onVsyncChange(!vsync)}
          inline
        />
        <ToggleRow
          label="Exclusive Fullscreen"
          description="Bypass the desktop compositor in fullscreen so VSync isn't gated by DWM (Windows)"
          enabled={exclusiveFullscreen}
          onToggle={() => onExclusiveFullscreenChange(!exclusiveFullscreen)}
          inline
        />
      </div>
    </motion.div>
  );
}
