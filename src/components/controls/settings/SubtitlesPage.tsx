import { motion } from "framer-motion";
import { Sliders, FileText } from "lucide-react";
import { type Track, trackLabel } from "../../types";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  subtitleTracks: Track[];
  selectedSubId: string;
  onSubtitleTrackChange: (id: string) => void;
  onOpenSubtitlePanel: () => void;
  onLoadSubtitle: () => void;
  onClose: () => void;
  onBack: () => void;
}

export default function SubtitlesPage({
  direction,
  subtitleTracks,
  selectedSubId,
  onSubtitleTrackChange,
  onOpenSubtitlePanel,
  onLoadSubtitle,
  onClose,
  onBack,
}: Props) {
  return (
    <motion.div
      key="subtitles"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Subtitles" onClick={onBack} />
      <div className="px-1 py-1 max-h-56 overflow-y-auto">
        <button
          className="w-full flex items-center justify-between px-3 py-2
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => {
            onOpenSubtitlePanel();
            onClose();
          }}
        >
          <span className="flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Customize Style…
          </span>
        </button>
        <button
          className="w-full flex items-center justify-between px-3 py-2
                     text-sm text-[var(--np-text)] rounded-lg hover:bg-[var(--np-hover)] cursor-pointer
                     transition-colors duration-100"
          onClick={() => {
            onLoadSubtitle();
            onClose();
          }}
        >
          <span className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-[var(--np-text-secondary)]" />
            Load subtitle file…
          </span>
        </button>
        <div className="my-1 border-t border-[var(--np-divider)] mx-2" />

        <TrackOption
          label="Off"
          selected={selectedSubId === "no"}
          onClick={() => {
            onSubtitleTrackChange("no");
            onClose();
          }}
        />
        <TrackOption
          label="Auto"
          selected={selectedSubId === "auto"}
          onClick={() => {
            onSubtitleTrackChange("auto");
            onClose();
          }}
        />
        {subtitleTracks.map((t) => (
          <TrackOption
            key={`s-${t.id}`}
            label={trackLabel(t)}
            selected={selectedSubId === String(t.id)}
            onClick={() => {
              onSubtitleTrackChange(String(t.id));
              onClose();
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
