import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Globe, FolderOpen, Clock, Library } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { BackHeader, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  onLocal: () => void;
  onNetwork: () => void;
  onRecent: () => void;
  onLibrary: () => void;
  onBack: () => void;
}

const CACHE_PRESETS: { label: string; bytes: number }[] = [
  { label: "Off", bytes: 0 },
  { label: "500 MB", bytes: 500 * 1024 * 1024 },
  { label: "1 GB", bytes: 1024 ** 3 },
  { label: "5 GB", bytes: 5 * 1024 ** 3 },
  { label: "10 GB", bytes: 10 * 1024 ** 3 },
  { label: "25 GB", bytes: 25 * 1024 ** 3 },
  { label: "50 GB", bytes: 50 * 1024 ** 3 },
  { label: "100 GB", bytes: 100 * 1024 ** 3 },
];

const ENTRIES: {
  id: "local" | "network" | "recent" | "library";
  icon: React.ReactNode;
  label: string;
  desc: string;
}[] = [
  {
    id: "library",
    icon: <Library className="w-4 h-4 text-white/70" />,
    label: "Library",
    desc: "Browse your saved videos and torrents (B)",
  },
  {
    id: "local",
    icon: <FolderOpen className="w-4 h-4 text-white/70" />,
    label: "Local file",
    desc: "Video, audio, or archive (.zip / .7z / .rar)",
  },
  {
    id: "network",
    icon: <Globe className="w-4 h-4 text-white/70" />,
    label: "Network source",
    desc: "Magnet link, .torrent file, or HTTP / RTSP / RTMP stream",
  },
  {
    id: "recent",
    icon: <Clock className="w-4 h-4 text-white/70" />,
    label: "Recent",
    desc: "Recently opened sources",
  },
];

export default function VideoSourcePage({
  direction,
  onLocal,
  onNetwork,
  onRecent,
  onLibrary,
  onBack,
}: Props) {
  const handlers: Record<"local" | "network" | "recent" | "library", () => void> = {
    local: onLocal,
    network: onNetwork,
    recent: onRecent,
    library: onLibrary,
  };

  const [cacheLimit, setCacheLimit] = useState(0);

  useEffect(() => {
    Store.load("trace-player-settings.json")
      .then((s) => s.get<number>("torrentCacheLimitBytes"))
      .then((v) => { if (typeof v === "number") setCacheLimit(v); })
      .catch(() => {});
  }, []);

  const applyLimit = (bytes: number) => {
    setCacheLimit(bytes);
    Store.load("trace-player-settings.json")
      .then((s) => s.set("torrentCacheLimitBytes", bytes).then(() => s.save()))
      .catch(() => {});
    invoke("set_torrent_cache_limit", { bytes }).catch(() => {});
  };

  return (
    <motion.div
      key="video_source"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Source" onClick={onBack} />
      <div className="px-1 py-1">
        {ENTRIES.map((e) => (
          <button
            key={e.id}
            onClick={() => handlers[e.id]()}
            className="w-full flex items-start gap-2.5 px-3 py-2.5
                       text-sm text-white/90 rounded-lg hover:bg-white/10 cursor-pointer
                       transition-colors duration-100"
          >
            <span className="mt-0.5">{e.icon}</span>
            <span className="flex flex-col items-start text-left">
              <span>{e.label}</span>
              <span className="text-[9px] text-white/40 mt-0.5">{e.desc}</span>
            </span>
          </button>
        ))}

        <div className="border-t border-white/8 mt-1 pt-2 px-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-white/60">Max disc cache</span>
            <span className="text-[11px] text-white/90 font-medium">
              {CACHE_PRESETS.find((p) => p.bytes === cacheLimit)?.label ?? "Custom"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {CACHE_PRESETS.map((preset) => (
              <button
                key={preset.bytes}
                onClick={() => applyLimit(preset.bytes)}
                className={`px-1.5 py-1 text-[10px] rounded-md transition-colors duration-100
                  ${cacheLimit === preset.bytes
                    ? "bg-white/20 text-white font-medium"
                    : "bg-white/5 text-white/55 hover:bg-white/12 hover:text-white/80"
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-white/30 mt-1.5 leading-snug">
            Oldest torrent data is deleted when this limit is exceeded.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
