import { motion } from "framer-motion";
import { PRESETS, type SubtitleStyle } from "./presets";

interface Props {
  onPick: (style: SubtitleStyle) => void;
}

export default function PresetGrid({ onPick }: Props) {
  return (
    <div className="space-y-2">
      <span className="text-[11px] text-white/50 uppercase tracking-wider">
        Presets
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(PRESETS).map(([key, { label, style }]) => (
          <motion.button
            key={key}
            className="px-2.5 py-2 text-[12px] text-white/85 rounded-md
                        bg-white/[0.03] cursor-pointer
                       hover:bg-white/10 hover:border-white/20
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
