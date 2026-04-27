import { motion } from "framer-motion";
import type { UpscalingProfile, PipelineInfo } from "../../types";
import { UPSCALING_OPTIONS } from "../../types";
import { BackHeader, TrackOption, StatRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  profile: UpscalingProfile;
  pipeline: PipelineInfo | null;
  onChange: (p: UpscalingProfile) => void;
  onBack: () => void;
}

export default function UpscalingPage({
  direction,
  profile,
  pipeline,
  onChange,
  onBack,
}: Props) {
  const usingNeural =
    (profile === "medium" || profile === "high") &&
    (pipeline?.glsl_shader_count ?? 0) > 0;
  const wantedNeuralButFell =
    (profile === "medium" || profile === "high") &&
    (pipeline?.glsl_shader_count ?? 0) === 0;
  return (
    <motion.div
      key="video_upscaling"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Upscaling" onClick={onBack} />

      <div className="px-1 py-2">
        {UPSCALING_OPTIONS.map((opt) => (
          <TrackOption
            key={opt.value}
            label={opt.label}
            description={opt.desc}
            selected={profile === opt.value}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>

      {pipeline && (
        <div className="px-3 pb-3 pt-2 border-t border-white/8 space-y-0.5">
          <StatRow label="Active scaler" value={pipeline.scale} />
          <StatRow label="Chroma scaler" value={pipeline.cscale} />
          <StatRow
            label="GLSL shaders"
            value={
              pipeline.glsl_shader_count > 0
                ? `${pipeline.glsl_shader_count} loaded`
                : "none"
            }
          />
          <StatRow
            label="Source"
            value={
              pipeline.video_w && pipeline.video_h
                ? `${pipeline.video_w}×${pipeline.video_h}`
                : "(no file)"
            }
          />
          {usingNeural && (
            <p className="text-[9px] text-emerald-300/80 mt-1.5 leading-snug">
              Neural upscaler active.
            </p>
          )}
          {wantedNeuralButFell && (
            <p className="text-[9px] text-amber-300/80 mt-1.5 leading-snug">
              No shader files found in resources/shaders/. Drop in
              FSRCNNX_x2_8-0-4-1.glsl + KrigBilateral.glsl, then restart.
              Currently playing at Low.
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}
