import { useRef, useState } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label?: string;
}

/** Generic horizontal slider with pointer-capture drag. Stepped + clamped. */
export default function RangeSlider({ value, min, max, step, onChange, label }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const valueToPct = (v: number) =>
    Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));

  const xToValue = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const raw = min + pct * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.min(max, Math.max(min, stepped));
  };

  const pct = valueToPct(value);

  const defaultStep = step || (max - min) * 0.01;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next = value;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = Math.min(max, value + defaultStep);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = Math.max(min, value - defaultStep);
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    const stepped = Math.round(next / step) * step;
    onChange(Math.min(max, Math.max(min, stepped)));
  };

  return (
    <div
      ref={trackRef}
      tabIndex={0}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="relative h-4 flex items-center cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--np-accent)] rounded"
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onChange(xToValue(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging) onChange(xToValue(e.clientX));
      }}
      onPointerUp={() => setDragging(false)}
    >
      <div className="w-full h-[3px] rounded-full bg-white/20 relative">
        <div
          className="absolute inset-y-0 left-0 bg-white/85 rounded-full"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md pointer-events-none"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
    </div>
  );
}
