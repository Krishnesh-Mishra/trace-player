import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fmtTime, denseBucket, DENSE_BUCKET_S } from "../types";
import type {
  ThumbnailSheet,
  Chapter,
  SeekBarSize,
  ChapterMarkerStyle,
} from "../types";
import { SEEK_BAR_HEIGHT_PX } from "../types";
import { log } from "../../lib/log";

interface Props {
  progressRef: React.RefObject<number>; // 0..100, updated at 10Hz
  duration: number; // seconds
  onSeek: (progress: number) => void;
  onSeekCommit: (progress: number) => void;
  thumbnails: ThumbnailSheet | null;
  denseThumbs?: Map<number, string>;
  onHoverWindow?: (t: number) => void;
  chapters?: Chapter[];
  size?: SeekBarSize;
  markerStyle?: ChapterMarkerStyle;
  showThumbnails?: boolean;
}

// Idle period before we ask the backend for a dense window. Short enough to
// feel responsive on stationary hovers, long enough to avoid firing on every
// pixel of a continuous drag-by motion.
const HOVER_DEBOUNCE_MS = 120;
// When the cursor falls between two dense buckets, accept a tile within this
// many seconds — beyond that we'd rather show the baseline frame than a
// visibly mistimed dense one.
//
// Dense window is requested as `radius=30, density=30`, giving a 2-second
// step between tiles. The cursor can therefore be up to 1 s from the nearest
// dense tile; tolerance must exceed that or ~50% of cursor positions miss
// the dense match and fall back to the much-coarser baseline (the bug that
// produced the "preview is minutes off" complaint on long files).
const DENSE_NEAREST_TOLERANCE_S = 1.5;

/**
 * Timeline scrubber with split contract:
 * - `onSeek` fires continuously while dragging — visual preview only.
 * - `onSeekCommit` fires once on pointer-up — actual mpv seek.
 * Hover anywhere on the bar shows a floating timestamp tooltip; if the
 * sprite atlas has arrived, a frame preview floats above it.
 */
export default function Timeline({
  progressRef,
  duration,
  onSeek,
  onSeekCommit,
  thumbnails,
  denseThumbs,
  onHoverWindow,
  chapters,
  size = "medium",
  markerStyle = "gap",
  showThumbnails = true,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbDotRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  // Read progressRef at ~60fps and update DOM directly (no React re-render).
  const rafRef = useRef<number>(0);
  useEffect(() => {
    let active = true;
    const tick = () => {
      if (!active) return;
      const p = progressRef.current;
      if (fillRef.current) fillRef.current.style.width = `${p}%`;
      if (thumbDotRef.current) thumbDotRef.current.style.left = `calc(${p}% - 6px)`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [progressRef]);

  // Debounce dense-window requests — fire only when the cursor has been
  // still for HOVER_DEBOUNCE_MS. The backend cancels its previous job on a
  // new request, so over-firing is correctness-safe but wastes mpv seeks.
  const hoverDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
    };
  }, []);
  const scheduleHoverWindow = useCallback(
    (t: number) => {
      if (!onHoverWindow) return;
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
      hoverDebounceRef.current = setTimeout(() => {
        log.debug("timeline", `hover settle, request frames at t=${t.toFixed(3)}s`);
        onHoverWindow(t);
      }, HOVER_DEBOUNCE_MS);
    },
    [onHoverWindow]
  );

  const getPercent = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    const p = getPercent(e.clientX);
    log.info("timeline", `drag-start pct=${p.toFixed(2)}%`);
    onSeek(p);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const p = getPercent(e.clientX);
    setHoverPct(p);
    if (dragging) onSeek(p);
    if (duration > 0) scheduleHoverWindow((p / 100) * duration);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragging) {
      const p = getPercent(e.clientX);
      log.info("timeline", `drag-end pct=${p.toFixed(2)}% (commit)`);
      onSeek(p);
      onSeekCommit(p);
    }
    setDragging(false);
  };

  const progress = progressRef.current;
  const tooltipPct = dragging ? progress : hoverPct ?? 0;
  const tooltipTime = (tooltipPct / 100) * duration;
  const showTooltip = (hovered || dragging) && duration > 0;

  // Frame resolution: prefer the dense (per-timestamp) tile if one is in
  // cache for this hover position; otherwise fall back to the baseline
  // sprite tile; otherwise show the timestamp-only tooltip.
  //
  // Dense tiles arrive sized identically to sprite tiles, so we render them
  // through a plain <img> with the same width/height for visual continuity.
  // Gate the expensive nearest-neighbor search on showTooltip — no point
  // computing thumbnail lookup when the tooltip isn't visible.
  const tileW = thumbnails?.tileWidth ?? 160;
  const tileH = thumbnails?.tileHeight ?? 90;

  const { thumbStyle, denseSrc } = useMemo(() => {
    let thumbStyle: React.CSSProperties | null = null;
    let denseSrc: string | null = null;
    if (!showTooltip) return { thumbStyle, denseSrc };

    if (denseThumbs && denseThumbs.size > 0 && duration > 0) {
      const exactKey = denseBucket(tooltipTime);
      const exact = denseThumbs.get(exactKey);
      if (exact) {
        denseSrc = exact;
      } else {
        // Walk neighboring buckets within tolerance for a near match.
        let best: { dt: number; src: string } | null = null;
        const maxSteps = Math.ceil(DENSE_NEAREST_TOLERANCE_S / DENSE_BUCKET_S);
        for (let step = 1; step <= maxSteps; step++) {
          const offset = step * DENSE_BUCKET_S;
          const a = denseThumbs.get(exactKey + offset);
          if (a) {
            best = { dt: offset, src: a };
            break;
          }
          const b = denseThumbs.get(exactKey - offset);
          if (b) {
            best = { dt: offset, src: b };
            break;
          }
        }
        if (best) denseSrc = best.src;
      }
    }

    if (!denseSrc && thumbnails && thumbnails.count > 0) {
      const tileIdx = Math.min(
        thumbnails.count - 1,
        Math.max(0, Math.floor((tooltipPct / 100) * thumbnails.count))
      );
      if (tileIdx < thumbnails.filled) {
        const col = tileIdx % thumbnails.cols;
        const row = Math.floor(tileIdx / thumbnails.cols);
        thumbStyle = {
          width: thumbnails.tileWidth,
          height: thumbnails.tileHeight,
          backgroundImage: `url(${thumbnails.src})`,
          backgroundPosition: `-${col * thumbnails.tileWidth}px -${row * thumbnails.tileHeight}px`,
          backgroundSize: `${thumbnails.cols * thumbnails.tileWidth}px ${thumbnails.rows * thumbnails.tileHeight}px`,
        };
      }
    }

    return { thumbStyle, denseSrc };
  }, [showTooltip, tooltipPct, tooltipTime, duration, denseThumbs, thumbnails]);

  const trackHeight = SEEK_BAR_HEIGHT_PX[size];
  // Markers within the first ~1% of duration are intro-bumpers, not real
  // navigation points; skip them so they don't visually merge with the
  // start of the bar. Same for markers near the very end.
  const markers = (chapters ?? []).filter(
    (c) => duration > 0 && c.time > duration * 0.005 && c.time < duration * 0.998
  );

  return (
    <div
      ref={trackRef}
      className="relative h-4 flex items-center cursor-pointer group select-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setHoverPct(null);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        className="w-full rounded-full bg-[var(--np-selected)] relative overflow-visible transition-[height] duration-150"
        style={{ height: trackHeight }}
      >
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${progress}%`,
            background: "var(--np-accent)",
          }}
        />

        {/* Chapter markers — rendered above the fill, below the thumb. */}
        {duration > 0 &&
          markers.map((c, i) => {
            const pct = (c.time / duration) * 100;
            return (
              <ChapterMarker
                key={`${i}-${c.time}`}
                pct={pct}
                style={markerStyle}
                trackHeight={trackHeight}
                title={c.title || `Chapter ${i + 1}`}
              />
            );
          })}
      </div>

      <AnimatePresence>
        {(hovered || dragging) && (
          <motion.div
            ref={thumbDotRef}
            key="thumb"
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-md pointer-events-none"
            style={{
              left: `calc(${progress}% - 6px)`,
              background: "var(--np-accent)",
            }}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.12 }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTooltip && (
          <motion.div
            key="tooltip"
            className="absolute -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1"
            style={{
              left: `${tooltipPct}%`,
              bottom: "calc(100% + 6px)",
            }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.1 }}
          >
            {showThumbnails && denseSrc ? (
              <img
                src={denseSrc}
                alt=""
                className="rounded-md overflow-hidden  shadow-xl bg-black/60 block"
                style={{ width: tileW, height: tileH }}
                draggable={false}
              />
            ) : (
              showThumbnails && thumbStyle && (
                <div
                  className="rounded-md overflow-hidden  shadow-xl bg-black/60"
                  style={thumbStyle}
                />
              )
            )}
            <div
              className="px-1.5 py-0.5 text-[10px] tabular-nums
                         bg-black/85 text-white rounded shadow-lg
                         "
            >
              {fmtTime(tooltipTime)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Per-marker render. The four styles are positioned to read cleanly against
 * any track height:
 *  - gap:        a 2px notch cut out of the bar (background-colored sliver)
 *  - bar:        a thin vertical bar across the full track height
 *  - single-bar: a slightly thicker bar overshooting the top of the track
 *  - triangle:   a downward chevron sitting just below the track
 */
function ChapterMarker({
  pct,
  style,
  trackHeight,
  title,
}: {
  pct: number;
  style: ChapterMarkerStyle;
  trackHeight: number;
  title: string;
}) {
  const common = `absolute pointer-events-auto`;
  if (style === "gap") {
    return (
      <div
        className={`${common} top-0 h-full bg-[var(--np-overlay-heavy)]`}
        style={{ left: `calc(${pct}% - 1px)`, width: 2 }}
        title={title}
      />
    );
  }
  if (style === "bar") {
    return (
      <div
        className={`${common} top-0 h-full`}
        style={{
          left: `calc(${pct}% - 0.5px)`,
          width: 1,
          background: "rgba(255,255,255,0.65)",
        }}
        title={title}
      />
    );
  }
  if (style === "single-bar") {
    const overshoot = Math.max(2, Math.floor(trackHeight * 0.6));
    return (
      <div
        className={`${common}`}
        style={{
          left: `calc(${pct}% - 1px)`,
          top: -overshoot / 2,
          width: 2,
          height: trackHeight + overshoot,
          background: "var(--np-accent)",
          borderRadius: 1,
        }}
        title={title}
      />
    );
  }
  // triangle — small ▼ above the bar
  return (
    <div
      className={`${common}`}
      style={{
        left: `calc(${pct}% - 3px)`,
        top: -4,
        width: 0,
        height: 0,
        borderLeft: "3px solid transparent",
        borderRight: "3px solid transparent",
        borderTop: "4px solid var(--np-accent)",
      }}
      title={title}
    />
  );
}
