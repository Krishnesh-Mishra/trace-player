// Types shared across ControlBar, AppearancePanel, AppContextMenu, Timeline.

export type Track = {
  id: number;
  title?: string;
  lang?: string;
  codec?: string;
  selected: boolean;
};

export type ThumbnailSheet = {
  src: string;
  count: number;
  filled: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
};

export type ThumbnailTile = {
  t: number;
  src: string;
};

export const DENSE_BUCKET_S = 0.25;
export function denseBucket(t: number): number {
  return Math.round(t / DENSE_BUCKET_S) * DENSE_BUCKET_S;
}
export const DENSE_LRU_MAX = 300;

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const LOCAL_VIDEO_EXTS = [
  "mp4",
  "mkv",
  "avi",
  "mov",
  "webm",
  "m4v",
  "ts",
  "flv",
  "wmv",
  "mpg",
  "mpeg",
  "ogv",
  "3gp",
  "m2ts",
  "mts",
] as const;

export type Chapter = {
  title: string | null;
  time: number;
};

// ── Appearance ──────────────────────────────────────────────────────────────

export type BarSize = "small" | "large" | "full";
export type SeekBarSize = "small" | "medium" | "large" | "xlarge";
export type ChapterMarkerStyle = "gap" | "triangle" | "bar" | "single-bar";

export type AppearanceState = {
  barSize: BarSize;
  seekBarSize: SeekBarSize;
  chapterMarkers: ChapterMarkerStyle;
};

export const DEFAULT_APPEARANCE: AppearanceState = {
  barSize: "small",
  seekBarSize: "medium",
  chapterMarkers: "gap",
};

export const SEEK_BAR_HEIGHT_PX: Record<SeekBarSize, number> = {
  small: 2,
  medium: 3,
  large: 5,
  xlarge: 7,
};

export const APPEARANCE_BARSIZE_OPTIONS: { value: BarSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "large", label: "Large" },
  { value: "full", label: "Full" },
];

export const APPEARANCE_SEEKBAR_OPTIONS: { value: SeekBarSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "X-Large" },
];

export function fmtTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function trackLabel(t: Track): string {
  const parts: string[] = [];
  if (t.title) parts.push(t.title);
  if (t.lang) parts.push(`(${t.lang})`);
  if (parts.length === 0) parts.push(`Track ${t.id}`);
  return parts.join(" ");
}
