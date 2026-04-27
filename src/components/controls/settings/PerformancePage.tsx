import { motion } from "framer-motion";
import { BatteryCharging, Zap, FolderOpen } from "lucide-react";
import type { PerfProfileName } from "../../types";
import { PERF_OPTIONS } from "../../types";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  profile: PerfProfileName;
  effective: string;       // resolved profile when Auto is selected
  onBattery: boolean;
  screenshotDir: string | null;
  onChange: (p: PerfProfileName) => void;
  onPickScreenshotDir: () => void;
  onBack: () => void;
}

export default function PerformancePage({
  direction,
  profile,
  effective,
  onBattery,
  screenshotDir,
  onChange,
  onPickScreenshotDir,
  onBack,
}: Props) {
  const showEffective = profile === "auto" && effective && effective !== "auto";

  const truncatedDir = screenshotDir
    ? screenshotDir.length > 32
      ? "…" + screenshotDir.slice(-32)
      : screenshotDir
    : "Default (Pictures)";

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

      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[10px] text-white/60">
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
        <div className="px-3 pb-2 text-[10px] text-white/50 border-t border-white/8 pt-2">
          Active:{" "}
          <span className="text-white/80">
            {effective.replace("_", " ")}
          </span>
        </div>
      )}

      <button
        className="w-full flex items-start gap-2 px-3 py-2 border-t border-white/8
                   text-left text-xs text-white/85 hover:bg-white/10 cursor-pointer
                   transition-colors duration-100"
        onClick={onPickScreenshotDir}
      >
        <FolderOpen className="w-3.5 h-3.5 text-white/60 mt-0.5 shrink-0" />
        <span className="flex flex-col min-w-0">
          <span>Screenshot folder</span>
          <span className="text-[9px] text-white/45 truncate">{truncatedDir}</span>
        </span>
      </button>
    </motion.div>
  );
}
