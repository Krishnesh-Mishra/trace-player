import { Select, ListBox } from "@heroui/react";
import type { Key } from "react";
import type {
  HdrMode,
  HdrInfo,
} from "../../types";
import {
  HDR_OPTIONS,
} from "../../types";
import { ToggleRow } from "../../controls/settings/shared";

interface Props {
  hdrMode: HdrMode;
  hdrInfo: HdrInfo | null;
  onHdrModeChange: (m: HdrMode) => void;
  vsync: boolean;
  onVsyncChange: (b: boolean) => void;
  exclusiveFullscreen: boolean;
  onExclusiveFullscreenChange: (b: boolean) => void;
  deinterlace: boolean;
  onDeinterlaceToggle: () => void;
}

export default function VideoSettings({
  hdrMode,
  hdrInfo,
  onHdrModeChange,
  vsync,
  onVsyncChange,
  exclusiveFullscreen,
  onExclusiveFullscreenChange,
  deinterlace,
  onDeinterlaceToggle,
}: Props) {
  return (
    <>
      {/* HDR */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">HDR</div>
        {hdrInfo && (
          <p className="text-[9px] text-[var(--np-text-tertiary)] mb-2">
            Source: {hdrInfo.format} &middot; {hdrInfo.primaries}
          </p>
        )}
        <Select
          aria-label="HDR"
          selectedKey={hdrMode}
          onSelectionChange={(key: Key | null) => { if (key != null) onHdrModeChange(key as HdrMode); }}
          className="w-full"
        >
          <Select.Trigger className="w-full bg-[var(--np-hover)] hover:bg-[var(--np-active)] rounded-lg px-3 py-2 text-[12px] text-[var(--np-text)] cursor-pointer transition-colors duration-100">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="bg-[var(--np-overlay-heavy)] backdrop-blur-xl rounded-lg shadow-2xl overflow-hidden">
            <ListBox className="p-1 outline-none">
              {HDR_OPTIONS.map((opt) => (
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

      {/* Display */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Display</div>
        <div className="space-y-px">
          <ToggleRow
            label="VSync"
            description="Sync frame output with your display refresh rate"
            enabled={vsync}
            onToggle={() => onVsyncChange(!vsync)}
          />
          <ToggleRow
            label="Exclusive Fullscreen"
            description="Bypass the compositor for lower latency in fullscreen"
            enabled={exclusiveFullscreen}
            onToggle={() => onExclusiveFullscreenChange(!exclusiveFullscreen)}
          />
          <ToggleRow
            label="Deinterlace"
            description="Apply deinterlacing filter for interlaced video sources"
            enabled={deinterlace}
            onToggle={onDeinterlaceToggle}
          />
        </div>
      </div>
    </>
  );
}
