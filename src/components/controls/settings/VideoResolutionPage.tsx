import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { BackHeader, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  /** null = "Auto" (let yt-dlp pick best). Otherwise mpv's `ytdl-format`
   *  string that bounds the height. */
  current: string | null;
  onChange: (format: string | null) => void;
  onBack: () => void;
}

// (label, ytdl-format string). Each preset tries muxed single-file FIRST
// (smaller HTTP set + faster first frame on YouTube/Hotstar/etc.), falling
// back to bestvideo+bestaudio dual-stream when no muxed format is available
// at that height. null format = clear (Auto / yt-dlp default).
const OPTIONS: { label: string; sub: string; value: string | null }[] = [
  { label: "Auto (best available)", sub: "yt-dlp picks the best format", value: null },
  {
    label: "1080p",
    sub: "≤ 1080p — muxed if available, else dual-stream",
    value: "best[height<=1080]/bestvideo[height<=1080]+bestaudio",
  },
  {
    label: "720p",
    sub: "≤ 720p — fastest start for most YouTube videos",
    value: "best[height<=720]/bestvideo[height<=720]+bestaudio",
  },
  {
    label: "480p",
    sub: "≤ 480p — low data, instant start",
    value: "best[height<=480]/bestvideo[height<=480]+bestaudio",
  },
  {
    label: "360p",
    sub: "≤ 360p — minimal bandwidth",
    value: "best[height<=360]/bestvideo[height<=360]+bestaudio",
  },
  { label: "Audio only", sub: "Best audio stream, no video", value: "bestaudio" },
];

export default function VideoResolutionPage({
  direction,
  current,
  onChange,
  onBack,
}: Props) {
  return (
    <motion.div
      key="video_resolution"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Resolution" onClick={onBack} />
      <div className="px-2 pt-1 pb-2">
        <div className="text-[10px] text-white/45 px-1 pb-2 leading-snug">
          For YouTube, Hotstar, and other yt-dlp-handled URLs. Applies to the
          next video you open. Direct files / torrents play at their native
          resolution.
        </div>
        <div className="flex flex-col gap-0.5">
          {OPTIONS.map((o) => {
            const active = current === o.value;
            return (
              <button
                key={o.label}
                onClick={() => onChange(o.value)}
                className="w-full flex items-start justify-between px-3 py-2
                           text-sm text-white/90 rounded-lg hover:bg-white/10
                           cursor-pointer transition-colors duration-100"
              >
                <span className="flex flex-col items-start text-left">
                  <span>{o.label}</span>
                  <span className="text-[9px] text-white/40 mt-0.5">{o.sub}</span>
                </span>
                {active && (
                  <Check
                    className="w-3.5 h-3.5 mt-1"
                    style={{ color: "var(--np-accent)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
