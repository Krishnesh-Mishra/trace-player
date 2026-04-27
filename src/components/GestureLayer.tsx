import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Pointer = { id: number; x: number; y: number; t: number };

type Gesture =
  | { kind: "idle" }
  | { kind: "pending"; start: Pointer }
  | { kind: "vswipe"; side: "left" | "right"; lastY: number; baseValue: number }
  | { kind: "hswipe"; basePct: number; lastX: number; startX: number }
  | { kind: "pinch"; baseDist: number; baseZoom: number };

interface Props {
  enabled: boolean;
  duration: number;
  brightness: number; // -100..+100
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

const TAP_MS = 250;
const DOUBLE_TAP_MS = 280;
const MOVE_THRESHOLD_PX = 8;
const DECIDE_MS = 80;

/**
 * Pointer-event gesture layer for touch / pen / mouse. Mounts as the click
 * overlay over the mpv video region. Decides between gestures within the
 * first ~80ms / 8px of pointer movement; from there a single gesture owns
 * the pointer until release.
 *
 * Gestures:
 *   • Tap (no movement) — play/pause
 *   • Double-tap left/right third — seek ±10s
 *   • Vertical swipe right half — volume (1px = 0.5%)
 *   • Vertical swipe left half — brightness (1px = 0.3 units)
 *   • Horizontal swipe (single pointer) — scrub timeline
 *   • Two-finger pinch — video zoom
 */
export default function GestureLayer({
  enabled,
  duration,
  brightness,
  zoom,
  volume,
  onPlayPause,
  onSeekRelative,
  onVolumeChange,
  onBrightnessChange,
  onSeekAbsolutePct,
  onZoomChange,
  onDoubleClickFullscreen,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, Pointer>>(new Map());
  const gesture = useRef<Gesture>({ kind: "idle" });
  const lastTapRef = useRef<{ t: number; x: number } | null>(null);
  const seekRipple = useRef(0);

  const [overlay, setOverlay] = useState<{
    kind: "volume" | "brightness" | "scrub" | "zoom" | null;
    value: number; // raw display value
    pct: number;
  }>({ kind: null, value: 0, pct: 0 });

  const [seekFx, setSeekFx] = useState<{ id: number; side: "left" | "right" } | null>(
    null
  );

  // Auto-clear overlay after a short idle.
  useEffect(() => {
    if (!overlay.kind) return;
    const t = setTimeout(() => setOverlay({ kind: null, value: 0, pct: 0 }), 600);
    return () => clearTimeout(t);
  }, [overlay]);

  if (!enabled) return null;

  const dist = (a: Pointer, b: Pointer) => Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: React.PointerEvent) => {
    elRef.current?.setPointerCapture(e.pointerId);
    const p: Pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 1) {
      gesture.current = { kind: "pending", start: p };
    } else if (pointers.current.size === 2) {
      const arr = Array.from(pointers.current.values());
      gesture.current = {
        kind: "pinch",
        baseDist: dist(arr[0], arr[1]),
        baseZoom: zoom,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;

    const g = gesture.current;
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const arr = Array.from(pointers.current.values());
      const d = dist(arr[0], arr[1]);
      if (g.baseDist > 0) {
        const ratio = d / g.baseDist;
        const next = Math.max(0.5, Math.min(5, g.baseZoom * ratio));
        onZoomChange(next);
        setOverlay({
          kind: "zoom",
          value: next,
          pct: ((next - 0.5) / 4.5) * 100,
        });
      }
      return;
    }

    if (g.kind === "pending") {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (Math.abs(dx) < MOVE_THRESHOLD_PX && Math.abs(dy) < MOVE_THRESHOLD_PX) {
        if (Date.now() - g.start.t < DECIDE_MS) return;
      }
      const rect = elRef.current!.getBoundingClientRect();
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical: side decides volume vs brightness.
        const side: "left" | "right" =
          g.start.x - rect.left < rect.width / 2 ? "left" : "right";
        gesture.current = {
          kind: "vswipe",
          side,
          lastY: p.y,
          baseValue: side === "right" ? volume : brightness,
        };
      } else {
        const basePct = ((g.start.x - rect.left) / rect.width) * 100;
        gesture.current = {
          kind: "hswipe",
          basePct: Math.max(0, Math.min(100, basePct)),
          lastX: p.x,
          startX: g.start.x,
        };
      }
      return;
    }

    if (g.kind === "vswipe") {
      const rect = elRef.current!.getBoundingClientRect();
      const dy = g.lastY - p.y; // up = positive
      g.lastY = p.y;
      if (g.side === "right") {
        const next = Math.max(0, Math.min(100, volume + dy * 0.5));
        onVolumeChange(Math.round(next));
        setOverlay({ kind: "volume", value: Math.round(next), pct: next });
      } else {
        const next = Math.max(-100, Math.min(100, brightness + dy * 0.3));
        onBrightnessChange(Math.round(next));
        setOverlay({
          kind: "brightness",
          value: Math.round(next),
          pct: ((next + 100) / 200) * 100,
        });
      }
      void rect; // keep ref'd for type-narrow check above
      return;
    }

    if (g.kind === "hswipe") {
      const rect = elRef.current!.getBoundingClientRect();
      const pct = ((p.x - rect.left) / rect.width) * 100;
      const clamped = Math.max(0, Math.min(100, pct));
      onSeekAbsolutePct(clamped);
      setOverlay({
        kind: "scrub",
        value: (clamped / 100) * duration,
        pct: clamped,
      });
      return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);

    const g = gesture.current;
    if (g.kind === "pending" && p) {
      // No movement — treat as a tap or double-tap.
      const dt = Date.now() - g.start.t;
      if (dt < TAP_MS) {
        const last = lastTapRef.current;
        const now = Date.now();
        if (last && now - last.t < DOUBLE_TAP_MS) {
          const rect = elRef.current!.getBoundingClientRect();
          const xPctLast = (last.x - rect.left) / rect.width;
          const xPctNow = (p.x - rect.left) / rect.width;
          // Both taps must land in the same outer-third zone.
          if (xPctNow < 0.33 && xPctLast < 0.33) {
            onSeekRelative(-10);
            seekRipple.current++;
            setSeekFx({ id: seekRipple.current, side: "left" });
            lastTapRef.current = null;
            gesture.current = { kind: "idle" };
            return;
          }
          if (xPctNow > 0.67 && xPctLast > 0.67) {
            onSeekRelative(10);
            seekRipple.current++;
            setSeekFx({ id: seekRipple.current, side: "right" });
            lastTapRef.current = null;
            gesture.current = { kind: "idle" };
            return;
          }
          // Fell in the middle — treat as a fullscreen toggle (mouse-style dbl-click).
          if (e.pointerType === "mouse") {
            onDoubleClickFullscreen();
            lastTapRef.current = null;
            gesture.current = { kind: "idle" };
            return;
          }
        }
        lastTapRef.current = { t: now, x: p.x };
        // Defer single-tap action so a 2nd tap within DOUBLE_TAP_MS can supersede it.
        setTimeout(() => {
          if (
            lastTapRef.current &&
            lastTapRef.current.t === now &&
            Date.now() - now >= DOUBLE_TAP_MS
          ) {
            onPlayPause();
            lastTapRef.current = null;
          }
        }, DOUBLE_TAP_MS + 10);
      }
    }

    if (pointers.current.size < 2 && gesture.current.kind === "pinch") {
      gesture.current = { kind: "idle" };
    }
    if (pointers.current.size === 0) {
      gesture.current = { kind: "idle" };
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = { kind: "idle" };
  };

  return (
    <div
      ref={elRef}
      className="absolute inset-0 z-10 cursor-pointer touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Seek ripple */}
      <AnimatePresence>
        {seekFx && (
          <motion.div
            key={seekFx.id}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.4, transition: { duration: 0.4 } }}
            transition={{ duration: 0.15 }}
            onAnimationComplete={() => setSeekFx(null)}
            className={`absolute top-1/2 ${
              seekFx.side === "left" ? "left-[15%]" : "right-[15%]"
            } -translate-y-1/2 w-24 h-24 rounded-full bg-white/12 backdrop-blur-sm
              flex items-center justify-center pointer-events-none border border-white/20`}
          >
            <span className="text-white text-sm font-medium">
              {seekFx.side === "left" ? "« 10s" : "10s »"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gesture overlay (volume / brightness / scrub / zoom) */}
      <AnimatePresence>
        {overlay.kind && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.18 } }}
            className="absolute top-12 left-1/2 -translate-x-1/2 pointer-events-none
                       px-4 py-2.5 rounded-xl bg-black/55 backdrop-blur-md border border-white/15
                       flex items-center gap-3 min-w-[200px]"
          >
            <span className="text-[11px] uppercase tracking-wider text-white/60 w-16">
              {overlay.kind}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-white/15 relative">
              <div
                className="absolute inset-y-0 left-0 bg-white rounded-full"
                style={{ width: `${overlay.pct}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-white/90 w-12 text-right">
              {overlay.kind === "volume"
                ? `${Math.round(overlay.value)}%`
                : overlay.kind === "brightness"
                ? overlay.value > 0
                  ? `+${Math.round(overlay.value)}`
                  : `${Math.round(overlay.value)}`
                : overlay.kind === "zoom"
                ? `${overlay.value.toFixed(2)}×`
                : fmtTime(overlay.value)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
