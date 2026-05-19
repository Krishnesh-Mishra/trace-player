import { FolderOpen } from "lucide-react";
import { ToggleRow } from "../../controls/settings/shared";
import type { LoopMode } from "../../types";

interface Props {
  alwaysOnTop: boolean;
  onAlwaysOnTopToggle: () => void;
  screenshotDir: string | null;
  onPickScreenshotDir: () => void;
  loopMode: LoopMode;
  onLoopCycle: () => void;
}

const LOOP_LABELS: Record<LoopMode, string> = {
  off: "Off",
  file: "File",
  playlist: "Playlist",
};

function truncatePath(path: string, maxLen: number = 32): string {
  if (path.length <= maxLen) return path;
  return "…" + path.slice(-maxLen);
}

export default function GeneralSettings({
  alwaysOnTop,
  onAlwaysOnTopToggle,
  screenshotDir,
  onPickScreenshotDir,
  loopMode,
  onLoopCycle,
}: Props) {
  return (
    <>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">General</div>

        <ToggleRow
          label="Always on top"
          description="Keep the player window above other windows"
          enabled={alwaysOnTop}
          onToggle={onAlwaysOnTopToggle}
        />
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Loop Mode</div>

        <button
          onClick={onLoopCycle}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg
                     hover:bg-[var(--np-hover)] cursor-pointer transition-colors duration-100"
        >
          <span className="text-sm text-[var(--np-text)]">Loop</span>
          <span className="text-[11px] text-[var(--np-text-tertiary)]">{LOOP_LABELS[loopMode]}</span>
        </button>
        <p className="text-[9px] text-[var(--np-text-tertiary)] px-3 mt-0.5">
          Cycle: Off → File → Playlist
        </p>
      </div>

      <div className="h-px bg-[var(--np-divider)] my-4" />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--np-text-tertiary)] mb-2">Screenshot</div>

        <button
          onClick={onPickScreenshotDir}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg
                     hover:bg-[var(--np-hover)] cursor-pointer transition-colors duration-100
                     text-sm text-[var(--np-text)]"
        >
          <FolderOpen className="w-4 h-4 text-[var(--np-text-tertiary)] shrink-0" />
          <span className="truncate text-[11px] text-[var(--np-text-secondary)]">
            {screenshotDir ? truncatePath(screenshotDir) : "Default (Pictures)"}
          </span>
        </button>
        <p className="text-[9px] text-[var(--np-text-tertiary)] px-3 mt-0.5">
          Where screenshots are saved.
        </p>
      </div>
    </>
  );
}
