import { motion } from "framer-motion";
import type { HdrMode, HdrInfo, PipelineInfo } from "../../types";
import { HDR_OPTIONS } from "../../types";
import { BackHeader, TrackOption, StatRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  mode: HdrMode;
  info: HdrInfo | null;
  pipeline: PipelineInfo | null;
  onChange: (m: HdrMode) => void;
  onBack: () => void;
}

export default function HdrPage({
  direction,
  mode,
  info,
  pipeline,
  onChange,
  onBack,
}: Props) {
  const hasGpuNext = pipeline?.vo === "gpu-next";
  const warnNoGpuNext =
    pipeline !== null && !hasGpuNext;
  return (
    <motion.div
      key="video_hdr"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="HDR" onClick={onBack} />

      {info && (
        <div className="px-3 pt-2 pb-1 text-[10px] text-white/60">
          Now playing: <span className="text-white/85">{info.format}</span>
          {info.primaries && info.format !== "SDR" && (
            <span className="text-white/40"> · {info.primaries}</span>
          )}
        </div>
      )}

      <div className="px-1 py-2">
        {HDR_OPTIONS.map((opt) => (
          <TrackOption
            key={opt.value}
            label={opt.label}
            description={opt.desc}
            selected={mode === opt.value}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>

      {pipeline && (
        <div className="px-3 pb-3 pt-2 border-t border-white/8 space-y-0.5">
          <StatRow label="VO" value={pipeline.vo} />
          <StatRow label="GPU API" value={pipeline.gpu_api} />
          <StatRow label="hwdec" value={pipeline.hwdec} />
          <StatRow label="HDR hint" value={pipeline.target_colorspace_hint} />
          <StatRow label="Source gamma" value={pipeline.gamma || "(no file)"} />
          {warnNoGpuNext && (
            <p className="text-[9px] text-amber-300/80 mt-1.5 leading-snug">
              Your libmpv build doesn't expose vo=gpu-next. HDR
              passthrough/tone-mapping options will have limited or no effect.
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}
