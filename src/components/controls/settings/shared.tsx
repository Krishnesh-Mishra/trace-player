import { motion } from "framer-motion";
import { Check, ChevronLeft } from "lucide-react";
import Toggle from "../../ui/Toggle";

// ── shared animation config for page slides ──────────────────────────────────

export const pageVariants = {
  enter: (dir: number) => ({ x: dir * 24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: -dir * 24, opacity: 0 }),
};

export const pageTransition = { duration: 0.18, ease: "easeInOut" as const };

// ── small reusable rows ──────────────────────────────────────────────────────

export function BackHeader({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full flex items-center gap-2 px-3 py-2.5
                 text-xs text-white/50 hover:text-white/80
                 border-b border-white/8 cursor-pointer
                 transition-colors duration-100"
      onClick={onClick}
    >
      <ChevronLeft className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Selectable row with optional description that *only* appears on row hover.
 * The button + description share one rounded background so the whole hovered
 * area highlights together — no orphan tiny text below the row.
 */
export function TrackOption({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="group rounded-lg hover:bg-white/10 transition-colors duration-100">
      <motion.button
        className="w-full flex items-center justify-between px-3 py-2
                   text-sm text-white/90 cursor-pointer"
        whileTap={{ scale: 0.97 }}
        onClick={onClick}
      >
        <span className="truncate text-left">{label}</span>
        {selected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
          >
            <Check className="w-3.5 h-3.5 text-white/70 shrink-0" />
          </motion.div>
        )}
      </motion.button>
      {description && (
        <p
          className="px-3 pb-1.5 text-[9px] text-white/50 leading-snug
                     overflow-hidden
                     max-h-12 opacity-100
                     transition-[max-height,opacity] duration-150"
        >
          {description}
        </p>
      )}
    </div>
  );
}

/** Compact diagnostic row (label · value) for pipeline-info panels. */
export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[10px] py-0.5">
      <span className="text-white/45">{label}</span>
      <span className="text-white/80 tabular-nums truncate ml-2 max-w-[60%] text-right">
        {value || "—"}
      </span>
    </div>
  );
}

export function ToggleRow({
  label,
  description,
  enabled,
  onToggle,
  inline,
}: {
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
  inline?: boolean;
}) {
  // Outer is a `<div role="button">` rather than a real `<button>` because
  // it contains the `<Toggle>` component, which is itself a `<button>` —
  // and HTML doesn't allow nested buttons (React 19 emits a hydration
  // error). Clicking the inner Toggle stops propagation so onToggle
  // doesn't fire twice (Toggle's own handler + this row's bubble).
  return (
    <div
      role="button"
      tabIndex={0}
      className={`w-full flex items-center justify-between gap-2 cursor-pointer ${
        inline ? "" : "px-3 py-2.5 rounded-lg hover:bg-white/10"
      } text-sm text-white/90 transition-colors duration-100`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="flex flex-col items-start min-w-0">
        <span className="truncate">{label}</span>
        {description && (
          <span className="text-[9px] text-white/40 leading-tight mt-0.5 text-left">
            {description}
          </span>
        )}
      </span>
      <Toggle enabled={enabled} onToggle={onToggle} />
    </div>
  );
}
