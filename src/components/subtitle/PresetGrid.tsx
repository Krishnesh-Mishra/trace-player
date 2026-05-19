import { motion } from "framer-motion";
import { PRESETS, type SubtitleStyle } from "./presets";

interface Props {
  onPick: (style: SubtitleStyle) => void;
}

export default function PresetGrid({ onPick }: Props) {
  return (
    <div className="space-y-2">
      <span className="text-[11px] text-[var(--np-text-tertiary)] uppercase tracking-wider">
        Presets
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(PRESETS).map(([key, { label, style }]) => (
          <motion.button
            key={key}
            className="px-2.5 py-2 text-[12px] text-[var(--np-text)] rounded-md
                        bg-[var(--np-hover)] cursor-pointer
                       hover:bg-[var(--np-active)]
                       transition-colors duration-100"
            whileTap={{ scale: 0.96 }}
            onClick={() => onPick(style)}
          >
            {label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
