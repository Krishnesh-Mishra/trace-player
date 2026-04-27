import { RotateCcw, RotateCw } from "lucide-react";

/** Circular-arrow icon with a small "10" overlay (YouTube-style ±10 s skip). */
export default function Seek10Icon({ direction }: { direction: "back" | "forward" }) {
  const Arrow = direction === "back" ? RotateCcw : RotateCw;
  return (
    <div className="relative w-4 h-4">
      <Arrow className="w-4 h-4" strokeWidth={2.2} />
      <span
        className="absolute inset-0 flex items-center justify-center
                   text-[7px] font-bold leading-none tracking-tight"
        style={{ marginTop: 1 }}
      >
        10
      </span>
    </div>
  );
}
