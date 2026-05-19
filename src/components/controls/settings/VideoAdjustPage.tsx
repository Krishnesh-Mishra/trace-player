import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import type { VideoState } from "../../types";
import { ASPECT_OPTIONS, DEFAULT_VIDEO_STATE } from "../../types";
import RangeSlider from "../../ui/RangeSlider";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  video: VideoState;
  onChange: (v: VideoState) => void;
  onBack: () => void;
}

const ROTATIONS: VideoState["rotate"][] = [0, 90, 180, 270];

export default function VideoAdjustPage({ direction, video, onChange, onBack }: Props) {
  const isModified =
    video.aspect !== "auto" || video.zoom !== 0 || video.rotate !== 0;

  return (
    <motion.div
      key="video_adjust"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Aspect, Zoom & Rotate" onClick={onBack} />

      <div className="px-3 py-3 space-y-3">
        {/* Aspect ratio */}
        <div>
          <div className="text-[11px] text-[var(--np-text-secondary)] mb-1.5">Aspect ratio</div>
          <div className="space-y-0.5">
            {ASPECT_OPTIONS.map((opt) => (
              <TrackOption
                key={opt.value}
                label={opt.label}
                description={opt.desc}
                selected={video.aspect === opt.value}
                onClick={() => onChange({ ...video, aspect: opt.value })}
              />
            ))}
          </div>
        </div>

        {/* Zoom */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-[var(--np-text-secondary)] mb-1.5">
            <span>Zoom</span>
            <span className="tabular-nums text-[var(--np-text)]">
              {video.zoom === 0 ? "1.00×" : `${Math.pow(2, video.zoom).toFixed(2)}×`}
            </span>
          </div>
          <RangeSlider
            value={video.zoom}
            min={-1}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ ...video, zoom: v })}
          />
          <p className="text-[9px] text-[var(--np-text-tertiary)] mt-1">
            Crop in toward the center of the frame.
          </p>
        </div>

        {/* Rotate */}
        <div>
          <div className="text-[11px] text-[var(--np-text-secondary)] mb-1.5">Rotate</div>
          <div className="grid grid-cols-4 gap-1">
            {ROTATIONS.map((deg) => (
              <button
                key={deg}
                className={`px-2 py-1.5 text-xs rounded-md cursor-pointer
                            transition-colors duration-100 ${
                              video.rotate === deg
                                ? "bg-white text-black"
                                : "bg-[var(--np-hover)] text-[var(--np-text)] hover:bg-[var(--np-active)]"
                            }`}
                onClick={() => onChange({ ...video, rotate: deg })}
              >
                {deg}°
              </button>
            ))}
          </div>
        </div>

        <button
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
                      text-xs cursor-pointer transition-colors duration-100 ${
                        isModified
                          ? "text-[var(--np-text)] bg-[var(--np-hover)] hover:bg-[var(--np-active)]"
                          : "text-[var(--np-text-muted)] bg-[var(--np-hover)] cursor-default"
                      }`}
          disabled={!isModified}
          onClick={() => onChange(DEFAULT_VIDEO_STATE)}
        >
          <RotateCcw className="w-3 h-3" />
          Reset all
        </button>
      </div>
    </motion.div>
  );
}
