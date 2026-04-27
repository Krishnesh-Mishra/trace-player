import { motion } from "framer-motion";

interface Props {
  enabled: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
}

/** Animated track + thumb toggle switch. */
export default function Toggle({ enabled, onToggle, size = "sm" }: Props) {
  const trackW = size === "md" ? 36 : 32;
  const trackH = size === "md" ? 20 : 18;
  const thumb = size === "md" ? 16 : 14;
  const offset = (trackH - thumb) / 2;
  const onLeft = trackW - thumb - offset;

  return (
    <button
      onClick={(e) => {
        // When this Toggle is rendered inside a ToggleRow, the row already
        // owns an onClick that calls onToggle — propagation would fire it
        // a second time and the state would flip back. Stop here.
        e.stopPropagation();
        onToggle();
      }}
      className={`shrink-0 relative rounded-full cursor-pointer transition-colors duration-150 ${
        enabled ? "bg-white/85" : "bg-white/20"
      }`}
      style={{ width: trackW, height: trackH }}
      aria-pressed={enabled}
    >
      <motion.span
        className={`absolute rounded-full ${enabled ? "bg-black" : "bg-white"}`}
        style={{ width: thumb, height: thumb, top: offset }}
        animate={{ left: enabled ? onLeft : offset }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </button>
  );
}
