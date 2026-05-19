import { useRef } from "react";
import { motion } from "framer-motion";
import type { AudioFxState, EqBands } from "../../types";
import { EQ_BAND_FREQS, DEFAULT_EQ } from "../../types";
import RangeSlider from "../../ui/RangeSlider";
import { BackHeader, ToggleRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  fx: AudioFxState;
  onChange: (f: AudioFxState) => void;
  onBack: () => void;
}

export default function AudioFxPage({ direction, fx, onChange, onBack }: Props) {
  const set = <K extends keyof AudioFxState>(key: K, v: AudioFxState[K]) =>
    onChange({ ...fx, [key]: v });

  const setBand = (i: number, db: number) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(db)));
    if (fx.eq.bands[i] === clamped) return;
    const next = fx.eq.bands.slice() as EqBands;
    next[i] = clamped;
    onChange({ ...fx, eq: { ...fx.eq, bands: next } });
  };

  const resetEq = () =>
    onChange({ ...fx, eq: { ...fx.eq, bands: DEFAULT_EQ.bands.slice() as EqBands } });

  return (
    <motion.div
      key="audio_fx"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Audio FX" onClick={onBack} />

      <div className="px-3 py-3 space-y-3">
        <ToggleRow
          label="Volume Normalize"
          description="Even out loud and quiet movies to a consistent level"
          enabled={fx.normalize}
          onToggle={() => set("normalize", !fx.normalize)}
          inline
        />

        <ToggleRow
          label="Night Mode"
          description="Reduce loud peaks so you don't wake the neighbors"
          enabled={fx.nightMode}
          onToggle={() => set("nightMode", !fx.nightMode)}
          inline
        />

        <ToggleRow
          label="Pitch Correction"
          description="Speed up without chipmunk voice"
          enabled={fx.pitchCorrection}
          onToggle={() => set("pitchCorrection", !fx.pitchCorrection)}
          inline
        />

        {/* ── 10-band EQ ────────────────────────────────────────────── */}
        <div className="border-t border-white/8 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <ToggleRow
              label="Equalizer"
              description="10-band linear-phase EQ (±12 dB)"
              enabled={fx.eq.enabled}
              onToggle={() => set("eq", { ...fx.eq, enabled: !fx.eq.enabled })}
              inline
            />
          </div>
          <div className={fx.eq.enabled ? "" : "opacity-40 pointer-events-none"}>
            <div className="flex justify-between items-end gap-1 px-1">
              {fx.eq.bands.map((db, i) => (
                <EqColumn
                  key={EQ_BAND_FREQS[i]}
                  freq={EQ_BAND_FREQS[i]}
                  value={db}
                  onChange={(v) => setBand(i, v)}
                />
              ))}
            </div>
            <div className="flex justify-end mt-1">
              <button
                className="text-[10px] text-white/50 hover:text-white/80 px-2 py-0.5"
                onClick={resetEq}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-white/8 pt-3">
          <div className="flex items-center justify-between text-[11px] text-white/70 mb-1.5">
            <span>Audio Delay</span>
            <span className="tabular-nums text-white/90">
              {fx.audioDelayMs > 0 ? "+" : ""}
              {fx.audioDelayMs} ms
            </span>
          </div>
          <RangeSlider
            value={fx.audioDelayMs}
            min={-2000}
            max={2000}
            step={10}
            onChange={(v) => set("audioDelayMs", v)}
          />
          <p className="text-[9px] text-white/40 mt-1">
            Shift audio earlier (–) or later (+) to sync with video.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/** Vertical slider, –12..+12 dB, ~28px wide × 80px tall. */
function EqColumn({
  freq,
  value,
  onChange,
}: {
  freq: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const yToDb = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const pct = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return Math.round(12 - pct * 24);
  };
  const pct = ((12 - value) / 24) * 100;
  const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
  const ariaLabel = freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next = value;
    switch (e.key) {
      case "ArrowUp":
        next = Math.min(12, value + 1);
        break;
      case "ArrowDown":
        next = Math.max(-12, value - 1);
        break;
      case "Home":
        next = 12;
        break;
      case "End":
        next = -12;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(next);
  };

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <span className="text-[9px] tabular-nums text-white/60 h-3">
        {value > 0 ? `+${value}` : value}
      </span>
      <div
        ref={trackRef}
        tabIndex={0}
        role="slider"
        aria-valuemin={-12}
        aria-valuemax={12}
        aria-valuenow={value}
        aria-label={ariaLabel}
        className="relative w-2.5 h-20 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--np-accent)] rounded"
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onChange(yToDb(e.clientY));
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) onChange(yToDb(e.clientY));
        }}
      >
        <div className="absolute inset-x-1/2 -translate-x-1/2 w-[3px] h-full bg-white/15 rounded-full" />
        {/* Center reference line at 0 dB */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/25" />
        <div
          className="absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md pointer-events-none"
          style={{ top: `calc(${pct}% - 5px)` }}
        />
      </div>
      <span className="text-[9px] text-white/50 h-3">{label}</span>
    </div>
  );
}
