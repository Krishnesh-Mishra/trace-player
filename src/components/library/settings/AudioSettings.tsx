import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Select, ListBox } from "@heroui/react";
import type { Key } from "react";
import type { AudioFxState, AudioDevice, DynamicAudioState, EqBands } from "../../types";
import { EQ_BAND_FREQS, DEFAULT_EQ } from "../../types";
import RangeSlider from "../../ui/RangeSlider";
import { ToggleRow } from "../../controls/settings/shared";

interface Props {
  audioFx: AudioFxState;
  onAudioFxChange: (f: AudioFxState) => void;
  audioDevice: string;
  onAudioDeviceChange: (name: string) => void;
  monoAudio: boolean;
  onMonoAudioToggle: () => void;
  dynamicAudio: DynamicAudioState;
  onDynamicAudioChange: (s: DynamicAudioState) => void;
}

export default function AudioSettings({
  audioFx,
  onAudioFxChange,
  audioDevice,
  onAudioDeviceChange,
  monoAudio,
  onMonoAudioToggle,
  dynamicAudio,
  onDynamicAudioChange,
}: Props) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  useEffect(() => {
    invoke<AudioDevice[]>("get_audio_devices")
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  const setFx = <K extends keyof AudioFxState>(key: K, v: AudioFxState[K]) =>
    onAudioFxChange({ ...audioFx, [key]: v });

  const setBand = (i: number, db: number) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(db)));
    if (audioFx.eq.bands[i] === clamped) return;
    const next = audioFx.eq.bands.slice() as EqBands;
    next[i] = clamped;
    onAudioFxChange({ ...audioFx, eq: { ...audioFx.eq, bands: next } });
  };

  const resetEq = () =>
    onAudioFxChange({ ...audioFx, eq: { ...audioFx.eq, bands: DEFAULT_EQ.bands.slice() as EqBands } });

  const setDynMin = (v: number) => {
    const clamped = Math.min(v, dynamicAudio.maxDb - 3);
    onDynamicAudioChange({ ...dynamicAudio, minDb: clamped });
  };

  const setDynMax = (v: number) => {
    const clamped = Math.max(v, dynamicAudio.minDb + 3);
    onDynamicAudioChange({ ...dynamicAudio, maxDb: clamped });
  };

  const deviceOptions = devices.map((d) => ({
    value: d.name,
    label: d.description || d.name,
  }));

  return (
    <>
      {/* Output Device */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Output Device</div>
        {devices.length === 0 ? (
          <p className="text-[11px] text-[var(--np-text-muted)] px-3 py-2">Loading devices…</p>
        ) : (
          <Select
            aria-label="Output Device"
            selectedKey={audioDevice}
            onSelectionChange={(key: Key | null) => { if (key != null) onAudioDeviceChange(key as string); }}
            className="w-full"
          >
            <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
              <ListBox className="p-1 outline-none">
                {deviceOptions.map((opt) => (
                  <ListBox.Item
                    key={opt.value}
                    id={opt.value}
                    className="px-3 py-2 text-[12px] text-[var(--np-text)] rounded-md cursor-pointer outline-none hover:bg-[var(--np-hover)] data-[selected]:bg-[var(--np-selected)] transition-colors duration-100"
                  >
                    {opt.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        )}
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* General */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">General</div>
        <ToggleRow
          label="Mono Audio"
          description="Mix all channels down to mono"
          enabled={monoAudio}
          onToggle={onMonoAudioToggle}
        />
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Effects */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Effects</div>
        <div className="space-y-px">
          <ToggleRow
            label="Volume Normalize"
            description="Even out loud and quiet movies to a consistent level"
            enabled={audioFx.normalize}
            onToggle={() => setFx("normalize", !audioFx.normalize)}
          />
          <ToggleRow
            label="Night Mode"
            description="Reduce loud peaks so you don't wake the neighbors"
            enabled={audioFx.nightMode}
            onToggle={() => setFx("nightMode", !audioFx.nightMode)}
          />
          <ToggleRow
            label="Pitch Correction"
            description="Speed up without chipmunk voice"
            enabled={audioFx.pitchCorrection}
            onToggle={() => setFx("pitchCorrection", !audioFx.pitchCorrection)}
          />
        </div>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Dynamic Audio */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Dynamic Audio</div>
        <ToggleRow
          label="Enabled"
          description="Boost quiet dialogue, limit sudden loud peaks"
          enabled={dynamicAudio.enabled}
          onToggle={() =>
            onDynamicAudioChange({ ...dynamicAudio, enabled: !dynamicAudio.enabled })
          }
        />

        <div
          className={`mt-3 space-y-3 transition-opacity duration-150 ${
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
              onChange={setDynMin}
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
              onChange={setDynMax}
            />
            <p className="text-[9px] text-[var(--np-text-tertiary)] mt-1">
              Sudden loud peaks are limited to this ceiling (5 ms attack).
            </p>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Equalizer */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Equalizer</div>
        <ToggleRow
          label="Enabled"
          description="10-band linear-phase EQ (±12 dB)"
          enabled={audioFx.eq.enabled}
          onToggle={() => setFx("eq", { ...audioFx.eq, enabled: !audioFx.eq.enabled })}
        />

        <div
          className={`mt-3 transition-opacity duration-150 ${
            audioFx.eq.enabled ? "opacity-100" : "opacity-40 pointer-events-none"
          }`}
        >
          <div className="flex justify-between items-end gap-1 px-1">
            {audioFx.eq.bands.map((db, i) => (
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
              className="text-[10px] text-[var(--np-text-tertiary)] hover:text-[var(--np-text)] px-2 py-0.5
                         cursor-pointer transition-colors duration-100"
              onClick={resetEq}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Audio Delay */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Audio Delay</div>
        <div className="flex items-center justify-between text-[11px] text-[var(--np-text-secondary)] mb-1.5">
          <span>Delay</span>
          <span className="tabular-nums text-[var(--np-text)]">
            {audioFx.audioDelayMs > 0 ? "+" : ""}
            {audioFx.audioDelayMs} ms
          </span>
        </div>
        <RangeSlider
          value={audioFx.audioDelayMs}
          min={-2000}
          max={2000}
          step={10}
          onChange={(v) => setFx("audioDelayMs", v)}
        />
        <p className="text-[9px] text-[var(--np-text-tertiary)] mt-1">
          Shift audio earlier (&ndash;) or later (+) to sync with video.
        </p>
      </div>
    </>
  );
}

/** Vertical slider, -12..+12 dB, ~28px wide x 80px tall. */
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
      <span className="text-[9px] tabular-nums text-[var(--np-text-secondary)] h-3">
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
        <div className="absolute inset-x-1/2 -translate-x-1/2 w-[3px] h-full bg-[var(--np-active)] rounded-full" />
        {/* Center reference line at 0 dB */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--np-text-muted)]" />
        <div
          className="absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md pointer-events-none"
          style={{ top: `calc(${pct}% - 5px)` }}
        />
      </div>
      <span className="text-[9px] text-[var(--np-text-tertiary)] h-3">{label}</span>
    </div>
  );
}
