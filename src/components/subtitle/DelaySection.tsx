import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import RangeSlider from "../ui/RangeSlider";

interface Props {
  delayMs: number;
  onChange: (delayMs: number) => void;
}

export default function DelaySection({ delayMs, onChange }: Props) {
  return (
    <div className="pt-2 border-t border-[var(--np-divider)] space-y-2">
      <span className="text-[11px] text-[var(--np-text-tertiary)] uppercase tracking-wider">Delay</span>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[var(--np-text-secondary)]">Subtitle delay</span>
          <span className="text-[11px] text-[var(--np-text)] tabular-nums">
            {delayMs >= 0 ? "+" : ""}
            {delayMs} ms
          </span>
        </div>
        <RangeSlider
          value={delayMs}
          min={-5000}
          max={5000}
          step={50}
          onChange={onChange}
        />
      </div>

      <div className="flex items-center gap-1.5 pt-1">
        <motion.button
          className="flex-1 px-2 py-1.5 text-[11px] text-[var(--np-text)]
                     rounded-md  bg-[var(--np-hover)] cursor-pointer
                     hover:bg-[var(--np-active)] transition-colors duration-100"
          whileTap={{ scale: 0.96 }}
          onClick={() => onChange(Math.max(-5000, delayMs - 100))}
        >
          −100 ms
        </motion.button>
        <motion.button
          className="flex items-center justify-center w-9 h-7 cursor-pointer
                     rounded-md  bg-[var(--np-hover)]
                     hover:bg-[var(--np-active)] transition-colors duration-100"
          whileTap={{ scale: 0.92 }}
          onClick={() => onChange(0)}
          title="Reset delay"
        >
          <RotateCcw className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
        </motion.button>
        <motion.button
          className="flex-1 px-2 py-1.5 text-[11px] text-[var(--np-text)]
                     rounded-md  bg-[var(--np-hover)] cursor-pointer
                     hover:bg-[var(--np-active)] transition-colors duration-100"
          whileTap={{ scale: 0.96 }}
          onClick={() => onChange(Math.min(5000, delayMs + 100))}
        >
          +100 ms
        </motion.button>
      </div>
    </div>
  );
}
