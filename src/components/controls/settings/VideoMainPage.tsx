import { motion } from "framer-motion";
import { ChevronRight, Globe, Palette, Settings2 } from "lucide-react";
import type { SettingsPage } from "../../types";
import { BackHeader, ToggleRow, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  deinterlace: boolean;
  onDeinterlaceToggle: () => void;
  onNavigate: (p: SettingsPage) => void;
  onBack: () => void;
}

export default function VideoMainPage({
  direction,
  deinterlace,
  onDeinterlaceToggle,
  onNavigate,
  onBack,
}: Props) {
  return (
    <motion.div
      key="video_main"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Video" onClick={onBack} />

      <div className="px-1 py-1">
        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-white/90 rounded-lg hover:bg-white/10 cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("video_source")}
        >
          <span className="flex items-start gap-2">
            <Globe className="w-3.5 h-3.5 text-white/60 mt-0.5" />
            <span className="flex flex-col items-start">
              <span>Source</span>
              <span className="text-[9px] text-white/40 mt-0.5">
                Local file, magnet, .torrent, stream, archive
              </span>
            </span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-white/50 shrink-0" />
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-white/90 rounded-lg hover:bg-white/10 cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("video_appearance")}
        >
          <span className="flex items-start gap-2">
            <Palette className="w-3.5 h-3.5 text-white/60 mt-0.5" />
            <span className="flex flex-col items-start">
              <span>Appearance</span>
              <span className="text-[9px] text-white/40 mt-0.5">
                Image adjustments, aspect, zoom & rotate
              </span>
            </span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-white/50 shrink-0" />
        </button>

        <button
          className="w-full flex items-center justify-between px-3 py-2.5
                     text-sm text-white/90 rounded-lg hover:bg-white/10 cursor-pointer
                     transition-colors duration-100"
          onClick={() => onNavigate("video_quality")}
        >
          <span className="flex items-start gap-2">
            <Settings2 className="w-3.5 h-3.5 text-white/60 mt-0.5" />
            <span className="flex flex-col items-start">
              <span>Quality</span>
              <span className="text-[9px] text-white/40 mt-0.5">
                HDR, upscaling, frame smoothing
              </span>
            </span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-white/50 shrink-0" />
        </button>

        <div className="border-t border-white/8 mt-1 pt-1">
          <ToggleRow
            label="Deinterlace"
            description="Remove combing artifacts from interlaced video"
            enabled={deinterlace}
            onToggle={onDeinterlaceToggle}
          />
        </div>
      </div>
    </motion.div>
  );
}
