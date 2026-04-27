import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import type { ImageParams } from "../../types";
import { DEFAULT_IMAGE_PARAMS } from "../../types";
import RangeSlider from "../../ui/RangeSlider";
import { BackHeader, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  imageParams: ImageParams;
  onChange: (p: ImageParams) => void;
  onBack: () => void;
}

const FIELDS: { key: keyof ImageParams; label: string; desc: string }[] = [
  { key: "brightness", label: "Brightness", desc: "Overall lightness" },
  { key: "contrast", label: "Contrast", desc: "Difference between dark and bright" },
  { key: "saturation", label: "Saturation", desc: "Color intensity" },
  { key: "gamma", label: "Gamma", desc: "Midtone curve — useful in dim rooms" },
  { key: "hue", label: "Hue", desc: "Shift the color spectrum" },
];

export default function ImagePage({ direction, imageParams, onChange, onBack }: Props) {
  const setField = (key: keyof ImageParams, v: number) =>
    onChange({ ...imageParams, [key]: v });

  const isModified =
    imageParams.brightness !== 0 ||
    imageParams.contrast !== 0 ||
    imageParams.saturation !== 0 ||
    imageParams.gamma !== 0 ||
    imageParams.hue !== 0;

  return (
    <motion.div
      key="video_image"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Image Adjustments" onClick={onBack} />

      <div className="px-3 py-3 space-y-3">
        {FIELDS.map(({ key, label, desc }) => (
          <div key={key}>
            <div className="flex items-center justify-between text-[11px] text-white/70 mb-1.5">
              <span>{label}</span>
              <span className="tabular-nums text-white/90">{imageParams[key]}</span>
            </div>
            <RangeSlider
              value={imageParams[key]}
              min={-100}
              max={100}
              step={1}
              onChange={(v) => setField(key, v)}
            />
            <p className="text-[9px] text-white/40 mt-1">{desc}</p>
          </div>
        ))}

        <button
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
                      text-xs cursor-pointer transition-colors duration-100 ${
                        isModified
                          ? "text-white/90 bg-white/10 hover:bg-white/15"
                          : "text-white/30 bg-white/5 cursor-default"
                      }`}
          disabled={!isModified}
          onClick={() => onChange(DEFAULT_IMAGE_PARAMS)}
        >
          <RotateCcw className="w-3 h-3" />
          Reset all
        </button>
      </div>
    </motion.div>
  );
}
