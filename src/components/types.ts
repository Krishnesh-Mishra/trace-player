// Types shared across ControlBar, SettingsMenu, and the various page components.

export type Track = {
  id: number;
  title?: string;
  lang?: string;
  codec?: string;
  selected: boolean;
};

export type DynamicAudioState = {
  enabled: boolean;
  minDb: number; // typically -50..-10
  maxDb: number; // typically -20..0
};

/**
 * Sprite-atlas frame previews for the timeline. Backend extracts N tiles in
 * a `cols × rows` grid; `filled` grows as tiles arrive (progressive emit).
 * Hovering past `filled` falls back to timestamp-only.
 */
export type ThumbnailSheet = {
  src: string;        // data:image/jpeg;base64,...
  count: number;      // total tiles the grid is sized for
  filled: number;     // how many tiles are actually rendered
  cols: number;
  rows: number;
  tileWidth: number;  // px
  tileHeight: number; // px
};

/**
 * Per-timestamp dense thumbnail received from the on-hover backend job.
 * Frontend stores these in an LRU map keyed by quantized time bucket so
 * pixel-level cursor jitter doesn't re-request the same frame.
 */
export type ThumbnailTile = {
  t: number;          // seconds
  src: string;        // data:image/jpeg;base64,...
};

// Quantize a hover timestamp to a 250ms bucket. Two cursor positions in the
// same bucket reuse the same dense tile.
export const DENSE_BUCKET_S = 0.25;
export function denseBucket(t: number): number {
  return Math.round(t / DENSE_BUCKET_S) * DENSE_BUCKET_S;
}
// Hard cap on the dense LRU. ~5 KB/tile × 300 ≈ 1.5 MB string heap.
export const DENSE_LRU_MAX = 300;

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type SettingsPage =
  | "main"
  | "speed"
  | "audio_main"
  | "audio_track"
  | "audio_fx"
  | "audio_device"
  | "dynamic"
  | "subtitles"
  | "video_main"
  | "video_appearance"
  | "video_image"
  | "video_adjust"
  | "video_quality"
  | "video_hdr"
  | "video_upscaling"
  | "video_interp"
  | "video_source"
  | "performance"
  | "appearance";


/** Archive extensions that map to the lazy-extract playlist flow. */
export const ARCHIVE_EXTS = ["zip", "7z", "rar"] as const;

/** Local video extensions accepted by the file picker. */
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

export type AudioDevice = {
  name: string;
  description: string;
};

// ── Phase 5e: Image Adjustments ─────────────────────────────────────────────
export type ImageParams = {
  brightness: number; // -100..100
  contrast: number;
  saturation: number;
  gamma: number;
  hue: number;
};

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
  hue: 0,
};

// ── Phase 5b-mini: Aspect / Zoom / Rotate ───────────────────────────────────
export type AspectRatio = "auto" | "16:9" | "4:3" | "21:9" | "fill";

export type VideoState = {
  aspect: AspectRatio;
  zoom: number; // mpv video-zoom: -1 = 0.5x, 0 = 1x, +1 = 2x
  rotate: 0 | 90 | 180 | 270;
};

export const DEFAULT_VIDEO_STATE: VideoState = {
  aspect: "auto",
  zoom: 0,
  rotate: 0,
};

export const ASPECT_OPTIONS: { value: AspectRatio; label: string; desc: string }[] = [
  { value: "auto", label: "Auto", desc: "Use the file's original aspect" },
  { value: "16:9", label: "16:9", desc: "Widescreen TVs / monitors" },
  { value: "4:3", label: "4:3", desc: "Old TV / monitor format" },
  { value: "21:9", label: "21:9", desc: "Ultra-wide cinematic" },
  { value: "fill", label: "Fill", desc: "Crop letterbox bars to fill the screen" },
];

// ── Phase 5b/5d/5f: HDR / Upscaling / Interp / Performance ──────────────────

export type HdrMode = "auto" | "passthrough" | "tone_map" | "sdr";
export type UpscalingProfile = "off" | "low" | "medium" | "high";
export type InterpolationMode = "off" | "smooth" | "cinematic";
export type PerfProfileName =
  | "auto"
  | "battery_saver"
  | "balanced"
  | "best_quality"
  | "custom";

export type EqBands = [number, number, number, number, number, number, number, number, number, number];

export type EqState = {
  enabled: boolean;
  bands: EqBands; // dB, clamped -12..+12, in EQ_BAND_FREQS order
};

// ISO standard 10-band frequencies, Hz.
export const EQ_BAND_FREQS: readonly number[] = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const DEFAULT_EQ: EqState = {
  enabled: false,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export type AudioFxState = {
  normalize: boolean;
  nightMode: boolean;
  pitchCorrection: boolean;
  audioDelayMs: number;  // -2000..+2000
  eq: EqState;
};

export const DEFAULT_AUDIO_FX: AudioFxState = {
  normalize: false,
  nightMode: false,
  pitchCorrection: true,    // mpv's recommended default
  audioDelayMs: 0,
  eq: DEFAULT_EQ,
};

export const HDR_OPTIONS: { value: HdrMode; label: string; desc: string }[] = [
  { value: "auto", label: "Auto", desc: "Pass HDR if your display supports it, else tone-map" },
  { value: "passthrough", label: "Passthrough", desc: "Send HDR signal directly to display (HDR display only)" },
  { value: "tone_map", label: "Tone Map", desc: "Always convert HDR → SDR with full color" },
  { value: "sdr", label: "SDR Only", desc: "Force standard dynamic range" },
];

export const UPSCALING_OPTIONS: { value: UpscalingProfile; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "Cheapest scaler, lowest GPU use" },
  { value: "low", label: "Low", desc: "Sharp built-in scaler, any GPU" },
  { value: "medium", label: "Medium", desc: "Neural upscaler — needs decent GPU" },
  { value: "high", label: "High", desc: "Maximum neural quality — high-end GPU" },
];

export const INTERPOLATION_OPTIONS: { value: InterpolationMode; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "Native frame rate, no smoothing" },
  { value: "smooth", label: "Smooth", desc: "Light frame blending, low GPU cost" },
  { value: "cinematic", label: "Cinematic", desc: "Stronger smoothing, more GPU" },
];

export const PERF_OPTIONS: { value: PerfProfileName; label: string; desc: string }[] = [
  { value: "auto", label: "Auto", desc: "Switches with battery state" },
  { value: "battery_saver", label: "Battery Saver", desc: "Minimum GPU use, longest runtime" },
  { value: "balanced", label: "Balanced", desc: "Good quality, modest power draw" },
  { value: "best_quality", label: "Best Quality", desc: "Neural upscaler + interpolation" },
  { value: "custom", label: "Custom", desc: "Don't touch — I'm tuning manually" },
];

export type ResolvedPerf = {
  effective: string;
  upscaling: UpscalingProfile;
  interpolation: InterpolationMode;
  hdrMode: HdrMode;
  vsync: boolean;
};

export type HdrInfo = {
  format: "HDR10" | "HLG" | "DV" | "SDR";
  primaries: string;
  gamma: string;
  matrix: string;
};

export type Chapter = {
  title: string | null;
  time: number;
};

// ── Phase 6: Playlist + Loop ────────────────────────────────────────────────

export type PlaylistItem = {
  index: number;
  filename: string;
  title: string | null;
  current: boolean;
};

/** Cyclic loop mode driven by the dedicated loop button on the bar. */
export type LoopMode = "off" | "file" | "playlist";

// ── Phase 6: Appearance ─────────────────────────────────────────────────────

/**
 * Width + control density of the floating ControlBar.
 *  - small: current ~max-w-2xl, only essentials shown (play/skip/volume/
 *           settings/fullscreen). Play/pause sits at the left.
 *  - large: 70vw container, every control shown, play/pause centered
 *           between the secondary control groups.
 *  - full:  edge-to-edge (with a small breathing-room gap), every control
 *           shown, play/pause centered.
 */
export type BarSize = "small" | "large" | "full";
export type SeekBarSize = "small" | "medium" | "large" | "xlarge";
export type ChapterMarkerStyle = "gap" | "triangle" | "bar" | "single-bar";
export type AccentColor = "white" | "blue" | "emerald" | "pink" | "amber";

export type AppearanceState = {
  barSize: BarSize;
  seekBarSize: SeekBarSize;
  chapterMarkers: ChapterMarkerStyle;
  accent: AccentColor;
};

export const DEFAULT_APPEARANCE: AppearanceState = {
  barSize: "small",
  seekBarSize: "medium",
  chapterMarkers: "gap",
  accent: "white",
};

/**
 * Tailwind-ish hex values keyed by AccentColor. Applied as a CSS custom
 * property `--np-accent` on the document root so any component (Timeline
 * fill, A-B loop button highlight, hover halos) can reference the same
 * value without prop-threading.
 */
export const ACCENT_PALETTE: Record<AccentColor, { hex: string; soft: string; label: string }> = {
  white:   { hex: "#ffffff", soft: "rgba(255,255,255,0.18)", label: "White" },
  blue:    { hex: "#60a5fa", soft: "rgba(96,165,250,0.22)",  label: "Blue" },
  emerald: { hex: "#34d399", soft: "rgba(52,211,153,0.22)",  label: "Emerald" },
  pink:    { hex: "#f472b6", soft: "rgba(244,114,182,0.22)", label: "Pink" },
  amber:   { hex: "#fbbf24", soft: "rgba(251,191,36,0.22)",  label: "Amber" },
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

export const APPEARANCE_CHAPTER_OPTIONS: { value: ChapterMarkerStyle; label: string }[] = [
  { value: "gap", label: "Gap" },
  { value: "triangle", label: "Triangle" },
  { value: "bar", label: "Bar" },
  { value: "single-bar", label: "Single Bar" },
];

/**
 * Live snapshot of mpv's rendering pipeline. Frontend pulls this on settings
 * pages so users can see what's actually applied (e.g. "VO: gpu (no HDR)" or
 * "Shaders: 0 loaded — Medium fell back to Low").
 */
export type PipelineInfo = {
  vo: string;
  gpu_context: string;
  gpu_api: string;
  hwdec: string;
  scale: string;
  cscale: string;
  glsl_shader_count: number;
  video_w: number | null;
  video_h: number | null;
  video_fps: number | null;
  colorspace: string;
  gamma: string;
  primaries: string;
  interpolation: boolean;
  video_sync: string;
  target_colorspace_hint: string;
};

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
