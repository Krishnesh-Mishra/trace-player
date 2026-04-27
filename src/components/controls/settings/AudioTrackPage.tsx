import { motion } from "framer-motion";
import { type Track, trackLabel } from "../../types";
import { BackHeader, TrackOption, pageVariants, pageTransition } from "./shared";

interface Props {
  direction: number;
  audioTracks: Track[];
  selectedAudioId: string;
  onAudioTrackChange: (id: string) => void;
  onClose: () => void;
  onBack: () => void;
}

export default function AudioTrackPage({
  direction,
  audioTracks,
  selectedAudioId,
  onAudioTrackChange,
  onClose,
  onBack,
}: Props) {
  return (
    <motion.div
      key="audio_track"
      custom={direction}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
    >
      <BackHeader label="Audio Track" onClick={onBack} />
      <div className="px-1 py-1 max-h-56 overflow-y-auto">
        <TrackOption
          label="Auto"
          selected={selectedAudioId === "auto"}
          onClick={() => {
            onAudioTrackChange("auto");
            onClose();
          }}
        />
        {audioTracks.map((t) => (
          <TrackOption
            key={`a-${t.id}`}
            label={trackLabel(t)}
            selected={selectedAudioId === String(t.id)}
            onClick={() => {
              onAudioTrackChange(String(t.id));
              onClose();
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
