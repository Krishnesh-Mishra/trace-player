import { BatteryCharging, Zap } from "lucide-react";
import { Select, ListBox } from "@heroui/react";
import type { Key } from "react";
import type {
  PerfProfileName,
  UpscalingProfile,
  InterpolationMode,
} from "../../types";
import {
  PERF_OPTIONS,
  UPSCALING_OPTIONS,
  INTERPOLATION_OPTIONS,
} from "../../types";

interface Props {
  perfProfile: PerfProfileName;
  perfEffective: string;
  onBattery: boolean;
  onPerfProfileChange: (p: PerfProfileName) => void;
  upscaling: UpscalingProfile;
  onUpscalingChange: (p: UpscalingProfile) => void;
  interpolation: InterpolationMode;
  onInterpolationChange: (m: InterpolationMode) => void;
}

export default function PerformanceSettings({
  perfProfile,
  perfEffective,
  onBattery,
  onPerfProfileChange,
  upscaling,
  onUpscalingChange,
  interpolation,
  onInterpolationChange,
}: Props) {
  const showEffective =
    perfProfile === "auto" && perfEffective && perfEffective !== "auto";

  return (
    <>
      {/* Battery status */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Status</div>
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--np-text-secondary)]">
          {onBattery ? (
            <>
              <BatteryCharging className="w-4 h-4 shrink-0" />
              <span>Currently on battery</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 shrink-0" />
              <span>Plugged in</span>
            </>
          )}
        </div>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Profile selector */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Profile</div>
        <Select
          aria-label="Performance Profile"
          selectedKey={perfProfile}
          onSelectionChange={(key: Key | null) => { if (key != null) onPerfProfileChange(key as PerfProfileName); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {PERF_OPTIONS.map((opt) => (
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
      </div>

      {/* Active profile display */}
      {showEffective && (
        <>
          <div className="h-px bg-[var(--np-divider)] my-4" />
          <div className="px-3 text-[10px] text-[var(--np-text-tertiary)]">
            Active:{" "}
            <span className="text-[var(--np-text)]">
              {perfEffective.replace("_", " ")}
            </span>
          </div>
        </>
      )}

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Upscaling */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Upscaling</div>
        <Select
          aria-label="Upscaling"
          selectedKey={upscaling}
          onSelectionChange={(key: Key | null) => { if (key != null) onUpscalingChange(key as UpscalingProfile); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {UPSCALING_OPTIONS.map((opt) => (
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
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      {/* Frame Smoothing */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Frame Smoothing</div>
        <Select
          aria-label="Frame Smoothing"
          selectedKey={interpolation}
          onSelectionChange={(key: Key | null) => { if (key != null) onInterpolationChange(key as InterpolationMode); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {INTERPOLATION_OPTIONS.map((opt) => (
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
      </div>
    </>
  );
}
