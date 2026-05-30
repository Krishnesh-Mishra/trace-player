import { motion } from "framer-motion";
import { BatteryCharging, Zap } from "lucide-react";
import type { PerfProfileName } from "../../types";
import { PERF_OPTIONS } from "../../types";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  profile: PerfProfileName;
  effective: string;       // resolved profile when Auto is selected
  onBattery: boolean;
  onChange: (p: PerfProfileName) => void;
  onBack: () => void;
}

export default function PerformancePage({
  direction,
  profile,
  effective,
  onBattery,
  onChange,
  onBack,
}: Props) {
  const showEffective = profile === "auto" && effective && effective !== "auto";

  return (
    <motion.div
      key="performance"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Performance" onClick={onBack} />

      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[10px] text-[var(--np-text-secondary)]">
        {onBattery ? (
          <>
            <BatteryCharging className="w-3 h-3" />
            <span>Currently on battery</span>
          </>
        ) : (
          <>
            <Zap className="w-3 h-3" />
            <span>Plugged in</span>
          </>
        )}
      </div>

      <div className="px-1 pb-2">
        {PERF_OPTIONS.map((opt) => (
          <TrackOption
            key={opt.value}
            label={opt.label}
            description={opt.desc}
            selected={profile === opt.value}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>

      {showEffective && (
        <div className="px-3 pb-2 text-[10px] text-[var(--np-text-tertiary)] border-t border-[var(--np-divider)] pt-2">
          Active:{" "}
          <span className="text-[var(--np-text)]">
            {effective.replace("_", " ")}
          </span>
        </div>
      )}
    </motion.div>
  );
}
