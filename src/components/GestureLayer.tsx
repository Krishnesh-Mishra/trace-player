import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Pointer = {
  id: number;
  x: number; // current
  y: number;
  sx: number; // start
  sy: number;
  t: number;
};

interface Props {
  enabled: boolean;
  duration: number;
  brightness: number;
  zoom: number;
  volume: number;
  onPlayPause: () => void;
  onSeekRelative: (delta: number) => void;
  onVolumeChange: (v: number) => void;
  onBrightnessChange: (b: number) => void;
  onSeekAbsolutePct: (pct: number) => void;
  onZoomChange: (z: number) => void;
  onDoubleClickFullscreen: () => void;
}

// A pointer that moves less than this on press→release counts as a tap.
// Generous on purpose — real clicks routinely jitter by a few pixels even
// when the user means "click, not drag."
const TAP_MOVE_PX = 12;
const TAP_MS = 350;
const DOUBLE_TAP_MS = 280;
const SEEK_STEP_S = 10;

const dist = (a: Pointer, b: Pointer) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Click/tap gesture layer over the video. Single tap toggles play/pause;
 * double-tap on the outer thirds seeks ±10s; double-tap in the middle (mouse)
 * toggles fullscreen. Pinch zoom kept for touch. No swipe/drag gestures —
 * they used to fire on any click with a few pixels of movement, which read
 * as "the video gets dragged" instead of pausing.
 */
export default function GestureLayer({
  enabled,
  zoom,
  onPlayPause,
  onSeekRelative,
  onZoomChange,
  onDoubleClickFullscreen,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, Pointer>>(new Map());
  const pinchBase = useRef<{ dist: number; zoom: number } | null>(null);
  const lastTapRef = useRef<{ t: number; x: number } | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekRipple = useRef(0);

  const [seekFx, setSeekFx] = useState<{
    id: number;
    side: "left" | "right";
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  // Auto-clear the seek indicator after a short visible duration so it
  // fades out instead of lingering on screen.
  useEffect(() => {
    if (!seekFx) return;
    const t = setTimeout(() => setSeekFx(null), 600);
    return () => clearTimeout(t);
  }, [seekFx]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      elRef.current?.setPointerCapture(e.pointerId);
      const p: Pointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        sx: e.clientX,
        sy: e.clientY,
        t: Date.now(),
      };
      pointers.current.set(e.pointerId, p);

      if (pointers.current.size === 2 && e.pointerType !== "mouse") {
        const arr = Array.from(pointers.current.values());
        pinchBase.current = { dist: dist(arr[0], arr[1]), zoom };
      }
    },
    [zoom]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = pointers.current.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;

      if (
        pointers.current.size === 2 &&
        pinchBase.current &&
        e.pointerType !== "mouse"
      ) {
        const arr = Array.from(pointers.current.values());
        const d = dist(arr[0], arr[1]);
        if (pinchBase.current.dist > 0) {
          const ratio = d / pinchBase.current.dist;
          const next = Math.max(0.5, Math.min(5, pinchBase.current.zoom * ratio));
          onZoomChange(next);
        }
      }
    },
    [onZoomChange]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const p = pointers.current.get(e.pointerId);
      pointers.current.delete(e.pointerId);

      if (pointers.current.size < 2) pinchBase.current = null;
      if (!p) return;

      // Was a tap? Compare against captured start (p.sx/p.sy).
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      const dt = Date.now() - p.t;
      if (moved > TAP_MOVE_PX || dt > TAP_MS) return;

      // It's a tap. Decide single vs double using the saved last tap.
      const last = lastTapRef.current;
      const now = Date.now();
      const rect = elRef.current!.getBoundingClientRect();
      const xFrac = (e.clientX - rect.left) / rect.width;

      if (last && now - last.t < DOUBLE_TAP_MS) {
        // Double-tap. Cancel deferred single tap.
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapRef.current = null;

        if (xFrac < 0.33) {
          onSeekRelative(-SEEK_STEP_S);
          seekRipple.current++;
          setSeekFx({
            id: seekRipple.current,
            side: "left",
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
          return;
        }
        if (xFrac > 0.67) {
          onSeekRelative(SEEK_STEP_S);
          seekRipple.current++;
          setSeekFx({
            id: seekRipple.current,
            side: "right",
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
          return;
        }
        if (e.pointerType === "mouse") {
          onDoubleClickFullscreen();
          return;
        }
        // Middle double-tap on touch: fall through to play/pause behavior.
      }

      // Single tap candidate — defer so a second tap can supersede.
      lastTapRef.current = { t: now, x: e.clientX };
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        if (lastTapRef.current && lastTapRef.current.t === now) {
          onPlayPause();
          lastTapRef.current = null;
        }
      }, DOUBLE_TAP_MS + 10);
    },
    [onPlayPause, onSeekRelative, onDoubleClickFullscreen]
  );

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
  }, []);

  if (!enabled) return null;

  return (
    <div
      ref={elRef}
      className="absolute inset-0 z-10 cursor-pointer touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Seek indicator — ripple + arrow + label */}
      <AnimatePresence>
        {seekFx && (
          <motion.div
            key={seekFx.id}
            className="absolute pointer-events-none"
            style={{
              left: seekFx.side === "left" ? "12%" : "auto",
              right: seekFx.side === "right" ? "12%" : "auto",
              top: "50%",
              transform: "translateY(-50%)",
            }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1, transition: { duration: 0.25 } }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative w-32 h-32 flex items-center justify-center">
              <motion.div
                className="absolute inset-0 rounded-full bg-[var(--np-overlay-heavy)] backdrop-blur-md"
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 1, opacity: 0.55 }}
                exit={{ scale: 1.25, opacity: 0 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
              <div className="relative flex flex-col items-center gap-1">
                <div className="flex items-center gap-0.5 text-[var(--np-text)]">
                  {seekFx.side === "left" ? (
                    <>
                      <Triangle dir="left" />
                      <Triangle dir="left" />
                      <Triangle dir="left" />
                    </>
                  ) : (
                    <>
                      <Triangle dir="right" />
                      <Triangle dir="right" />
                      <Triangle dir="right" />
                    </>
                  )}
                </div>
                <span className="text-[var(--np-text)] text-xs font-semibold tracking-wide">
                  {SEEK_STEP_S} seconds
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Triangle({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
      {dir === "left" ? (
        <path d="M9 1L1 6L9 11V1Z" />
      ) : (
        <path d="M1 1L9 6L1 11V1Z" />
      )}
    </svg>
  );
}
