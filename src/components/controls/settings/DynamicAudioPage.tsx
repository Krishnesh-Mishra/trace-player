import { motion } from "framer-motion";
import type { DynamicAudioState } from "../../types";
import RangeSlider from "../../ui/RangeSlider";
import { BackHeader, ToggleRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  dynamicAudio: DynamicAudioState;
  onDynamicAudioChange: (state: DynamicAudioState) => void;
  onBack: () => void;
}

export default function DynamicAudioPage({
  direction,
  dynamicAudio,
  onDynamicAudioChange,
  onBack,
}: Props) {
  const setMin = (v: number) => {
    const clamped = Math.min(v, dynamicAudio.maxDb - 3);
    onDynamicAudioChange({ ...dynamicAudio, minDb: clamped });
  };
  const setMax = (v: number) => {
    const clamped = Math.max(v, dynamicAudio.minDb + 3);
    onDynamicAudioChange({ ...dynamicAudio, maxDb: clamped });
  };

  return (
    <motion.div
      key="dynamic"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Dynamic Audio" onClick={onBack} />

      <div className="px-3 py-3 space-y-3">
        <ToggleRow
          label="Enabled"
          description="Boost quiet dialogue, limit sudden loud peaks"
          enabled={dynamicAudio.enabled}
          onToggle={() =>
            onDynamicAudioChange({ ...dynamicAudio, enabled: !dynamicAudio.enabled })
          }
          inline
        />

        <div
          className={`space-y-3 transition-opacity duration-150 ${
            dynamicAudio.enabled ? "opacity-100" : "opacity-40 pointer-events-none"
          }`}
        >
          <div>
            <div className="flex items-center justify-between text-[11px] text-[var(--np-text-secondary)] mb-1.5">
              <span>Min loudness</span>
              <span className="tabular-nums text-[var(--np-text)]">{dynamicAudio.minDb} dB</span>
            </div>
            <RangeSlider
              value={dynamicAudio.minDb}
              min={-50}
              max={-10}
              step={1}
              onChange={setMin}
            />
            <p className="text-[9px] text-[var(--np-text-tertiary)] mt-1">
              Anything quieter is amplified up to this level.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] text-[var(--np-text-secondary)] mb-1.5">
              <span>Max loudness</span>
              <span className="tabular-nums text-[var(--np-text)]">{dynamicAudio.maxDb} dB</span>
            </div>
            <RangeSlider
              value={dynamicAudio.maxDb}
              min={-20}
              max={0}
              step={1}
              onChange={setMax}
            />
            <p className="text-[9px] text-[var(--np-text-tertiary)] mt-1">
              Sudden loud peaks are limited to this ceiling (5 ms attack).
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
