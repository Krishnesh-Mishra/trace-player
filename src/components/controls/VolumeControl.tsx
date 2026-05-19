import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Volume1, Volume2, VolumeX } from "lucide-react";

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeX className="w-4 h-4" />;
  if (volume < 50) return <Volume1 className="w-4 h-4" />;
  return <Volume2 className="w-4 h-4" />;
}

function VolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const getPercent = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next = value;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = Math.min(130, value + 5);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = Math.max(0, value - 5);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 130;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(next);
  };

  return (
    <div
      ref={trackRef}
      tabIndex={0}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={130}
      aria-valuenow={value}
      aria-label="Volume"
      className="relative w-20 h-4 flex items-center cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--np-accent)] rounded"
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onChange(getPercent(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging) onChange(getPercent(e.clientX));
      }}
      onPointerUp={() => setDragging(false)}
    >
      <div className="w-full h-[3px] rounded-full bg-white/20">
        <motion.div
          className="h-full bg-white/80 rounded-full"
          animate={{ width: `${value}%` }}
          transition={{ type: "spring", stiffness: 600, damping: 50 }}
        />
      </div>
    </div>
  );
}

interface Props {
  volume: number;
  muted: boolean;
  onMuteToggle: () => void;
  onVolumeChange: (v: number) => void;
}

export default function VolumeControl({ volume, muted, onMuteToggle, onVolumeChange }: Props) {
  const effectiveVolume = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-2">
      <motion.button
        className="w-8 h-8 flex items-center justify-center text-white/70
                   hover:text-white rounded-lg hover:bg-white/10 cursor-pointer
                   transition-colors duration-100"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.88 }}
        onClick={onMuteToggle}
        title="Mute (M)"
      >
        <VolumeIcon volume={volume} muted={muted} />
      </motion.button>
      <VolumeSlider value={effectiveVolume} onChange={onVolumeChange} />
    </div>
  );
}
