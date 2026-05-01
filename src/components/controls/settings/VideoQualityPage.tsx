import { motion } from "framer-motion";
import { ChevronRight, Sun, Sparkles, Wind } from "lucide-react";
import type { SettingsPage } from "../../types";
import { BackHeader, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  onNavigate: (p: SettingsPage) => void;
  onBack: () => void;
}

const ENTRIES: {
  page: SettingsPage;
  icon: React.ReactNode;
  label: string;
  desc: string;
}[] = [
  {
    page: "video_hdr",
    icon: <Sun className="w-3.5 h-3.5 text-white/60 mt-0.5" />,
    label: "HDR",
    desc: "How HDR signals are sent to your display",
  },
  {
    page: "video_upscaling",
    icon: <Sparkles className="w-3.5 h-3.5 text-white/60 mt-0.5" />,
    label: "Upscaling",
    desc: "Sharper detail on lower-res videos",
  },
  {
    page: "video_interp",
    icon: <Wind className="w-3.5 h-3.5 text-white/60 mt-0.5" />,
    label: "Frame Smoothing",
    desc: "Smooth out motion + VSync",
  },
];

export default function VideoQualityPage({ direction, onNavigate, onBack }: Props) {
  return (
    <motion.div
      key="video_quality"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Quality" onClick={onBack} />
      <div className="px-1 py-1">
        {ENTRIES.map((e) => (
          <button
            key={e.page}
            className="w-full flex items-center justify-between px-3 py-2.5
                       text-sm text-white/90 rounded-lg hover:bg-white/10 cursor-pointer
                       transition-colors duration-100"
            onClick={() => onNavigate(e.page)}
          >
            <span className="flex items-start gap-2">
              {e.icon}
              <span className="flex flex-col items-start">
                <span>{e.label}</span>
                <span className="text-[9px] text-white/40 mt-0.5">{e.desc}</span>
              </span>
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-white/50 shrink-0" />
          </button>
        ))}
      </div>
    </motion.div>
  );
}
