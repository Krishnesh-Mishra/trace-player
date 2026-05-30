import { motion } from "framer-motion";
import { Globe, FolderOpen, Clock } from "lucide-react";
import { BackHeader, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  onLocal: () => void;
  onNetwork: () => void;
  onRecent: () => void;
  onBack: () => void;
}

const ENTRIES: {
  id: "local" | "network" | "recent";
  icon: React.ReactNode;
  label: string;
  desc: string;
}[] = [
  {
    id: "local",
    icon: <FolderOpen className="w-4 h-4 text-[var(--np-text-secondary)]" />,
    label: "Local file",
    desc: "Open a video file from disk",
  },
  {
    id: "network",
    icon: <Globe className="w-4 h-4 text-[var(--np-text-secondary)]" />,
    label: "Network URL",
    desc: "HTTP / HTTPS / RTSP / RTMP / MMS stream",
  },
  {
    id: "recent",
    icon: <Clock className="w-4 h-4 text-[var(--np-text-secondary)]" />,
    label: "Recent",
    desc: "Recently opened sources",
  },
];

export default function VideoSourcePage({
  direction,
  onLocal,
  onNetwork,
  onRecent,
  onBack,
}: Props) {
  const handlers: Record<"local" | "network" | "recent", () => void> = {
    local: onLocal,
    network: onNetwork,
    recent: onRecent,
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
                       text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                       transition-colors duration-100"
          >
            <span className="mt-0.5">{e.icon}</span>
            <span className="flex flex-col items-start text-left">
              <span>{e.label}</span>
              <span className="text-[9px] text-[var(--np-text-tertiary)] mt-0.5">{e.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
