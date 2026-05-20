import { useState, useEffect } from "react";
import {
  Magnet,
  HardDrive,
  Search,
  Download,
  Clock,
  Pin,
  PinOff,
  FolderOpen,
  Settings2,
} from "lucide-react";
import type { LibraryTab, LibraryItem, PinnedEntry } from "./types";

interface Props {
  activeTab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  pinned: PinnedEntry[];
  onPinnedClick: (pin: PinnedEntry) => void;
  onUnpin: (id: number) => void;
  getRecentItems: () => Promise<LibraryItem[]>;
  onRecentClick: (item: LibraryItem) => void;
  onSettingsClick: () => void;
}

const TABS: { key: LibraryTab; label: string; icon: typeof Magnet }[] = [
  { key: "torrents", label: "Torrents", icon: Magnet },
  { key: "local", label: "Local", icon: HardDrive },
  { key: "explore", label: "Explore", icon: Search },
  { key: "downloads", label: "Downloads", icon: Download },
  { key: "history", label: "History", icon: Clock },
];

export default function LibrarySidebar({
  activeTab,
  onTabChange,
  pinned,
  onPinnedClick,
  onUnpin,
  getRecentItems,
  onRecentClick,
  onSettingsClick,
}: Props) {
  const [recents, setRecents] = useState<LibraryItem[]>([]);
  const [hoveredPin, setHoveredPin] = useState<number | null>(null);

  useEffect(() => {
    void getRecentItems().then(setRecents);
  }, [getRecentItems]);

  return (
    <div className="w-56 h-full bg-[var(--np-surface-alt)] flex flex-col shrink-0">
      <div className="px-3 pt-4 pb-2">
        <h2 className="text-[10px] font-semibold text-[var(--np-text-muted)] uppercase tracking-wider mb-2">
          Library
        </h2>
        <div className="space-y-0.5">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px]
                         cursor-pointer transition-colors duration-100 ${
                           activeTab === key
                             ? "bg-[var(--np-hover)] text-[var(--np-text)]"
                             : "text-[var(--np-text-tertiary)] hover:text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]"
                         }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {pinned.length > 0 && (
        <div className="px-3 pt-3">
          <h3 className="text-[10px] font-semibold text-[var(--np-text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Pin className="w-3 h-3" /> Pinned
          </h3>
          <div className="space-y-0.5">
            {pinned.map((pin) => (
              <div
                key={pin.id}
                className="flex items-center group"
                onMouseEnter={() => setHoveredPin(pin.id)}
                onMouseLeave={() => setHoveredPin(null)}
              >
                <button
                  onClick={() => onPinnedClick(pin)}
                  className="flex-1 flex items-center gap-2 text-left text-[11px] text-[var(--np-text-tertiary)]
                             hover:text-[var(--np-text)] px-2.5 py-1.5 rounded-md hover:bg-[var(--np-hover)]
                             cursor-pointer truncate transition-colors duration-100"
                >
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{pin.label}</span>
                </button>
                {hoveredPin === pin.id && (
                  <button
                    onClick={() => onUnpin(pin.id)}
                    className="p-1 text-[var(--np-text-muted)] hover:text-[var(--np-text-secondary)] cursor-pointer transition-colors"
                  >
                    <PinOff className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {recents.length > 0 && (
        <div className="px-3 pt-3 overflow-y-auto min-h-0">
          <h3 className="text-[10px] font-semibold text-[var(--np-text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Recent
          </h3>
          <div className="space-y-0.5">
            {recents.map((item) => (
              <button
                key={item.id}
                onClick={() => onRecentClick(item)}
                className="w-full text-left text-[11px] text-[var(--np-text-tertiary)] hover:text-[var(--np-text)]
                           px-2.5 py-1.5 rounded-md hover:bg-[var(--np-hover)] cursor-pointer
                           truncate transition-colors duration-100"
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Spacer to push settings to bottom */}
      <div className="flex-1" />

      {/* Settings */}
      <div className="px-3 pb-3 pt-2">
        <div className="h-px bg-[var(--np-divider)] mb-2" />
        <button
          onClick={onSettingsClick}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px]
                     cursor-pointer transition-colors duration-100 ${
                       activeTab === "settings"
                         ? "bg-[var(--np-hover)] text-[var(--np-text)]"
                         : "text-[var(--np-text-tertiary)] hover:text-[var(--np-text-secondary)] hover:bg-[var(--np-hover)]"
                     }`}
        >
          <Settings2 className="w-4 h-4 shrink-0" />
          Settings
        </button>
      </div>
    </div>
  );
}
