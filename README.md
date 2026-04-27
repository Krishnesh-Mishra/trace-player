# Trace Player

A modern desktop video player built with **Tauri 2 + React + libmpv**. Native rendering via mpv, a transparent React overlay for a frosted-glass UI, and a small, contract-stable command surface.

The decode/render path is delegated entirely to mpv — Trace Player never reimplements decoding. The UI is event-driven (no polling, no `setInterval`) and gets all live state through Tauri events emitted by a dedicated mpv-event thread.

---

## Features

### Playback
- Open `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.m4v`, `.ts`, `.flv`, `.wmv`
- Hardware-accelerated video output (`vo=gpu`, `hwdec=auto`)
- Play / pause
- ±10 second skip
- Seek to any position by dragging the timeline (commit-on-release with seek-target reconciliation — no rubber-banding back to pre-seek frames)
- Variable playback speed: 0.25× / 0.5× / 0.75× / 1× / 1.25× / 1.5× / 1.75× / 2×
- Volume slider (0–100) with mute toggle and adaptive volume icon
- Live time / duration display
- **A-B loop** — press `[` to mark A, `]` to mark B, `\` to clear; uses mpv's built-in `ab-loop` state machine
- **Chapter navigation** — `,` / `.` jump to previous/next chapter; chapter markers shown on the timeline (gap, triangle, bar, or single-bar style, configurable)
- **Loop mode** — three-state cycle: off → loop file → loop playlist (press `R` or click the loop button); persists across sessions
- **Screenshot** — captures the current video frame (no OSD/subs); configurable output directory; press `S` or click the camera button

### Playlist
- Queue multiple files from the file dialog or via "Open with"
- Playlist side-panel with drag-to-reorder, remove, clear, and shuffle
- Playlist count badge on the playlist button
- Play any item directly by clicking it in the panel
- Next / prev track (`N` / `P` keys)
- Loop playlist mode (toggle in the panel or via the loop cycle button)
- Auto-advance: per-file state (audio FX, subtitle style, image params, perf profile) is re-applied on every playlist transition

### Track selection
- **Audio track** picker — populated from mpv's `track-list`, with "Auto" + every embedded track (lang / title / codec where available)
- **Subtitle** picker — "Off", "Auto", and every embedded subtitle stream

### Audio
- **Mono audio** toggle — downmixes stereo to mono via a `lavfi` pan filter
- **Dynamic Audio (AGC)** — automatic gain controller that nudges mpv's `volume` to keep the source RMS inside a configurable dB target band (`-30 dB`–`-6 dB` by default); uses a labeled `astats` filter read by a background tick thread; restores user volume when disabled
- **Normalize** — single-pass `loudnorm` filter targeting −16 LUFS / −1.5 dBTP
- **Night Mode** — `acompressor` (threshold −21 dB, ratio 4:1) to tame loud peaks for quiet listening
- **Pitch correction** — mpv's `audio-pitch-correction` property (on by default; disabling gives the "chipmunk / slow-down" effect at non-1× speeds)
- **Audio delay** — sync offset from −2000 ms to +2000 ms
- All audio effects rebuild the `af` chain atomically in a single backend call

### Subtitles
- Embedded subtitle track picker (Off / Auto / per-stream)
- **Subtitle style panel** (side-panel, slides in from right):
  - Font family, size, color
  - Border size and color
  - Shadow offset
  - Bottom margin
  - Bold toggle
  - Vertical alignment: top / center / bottom
- **Subtitle delay** — sync offset slider; persists across sessions

### Video
- **Image adjustments**: brightness, contrast, saturation, gamma, hue (each −100–+100)
- **Aspect ratio override**: Auto (file original), 16:9, 4:3, 21:9, Fill (crop letterbox bars via `panscan=1`)
- **Zoom** — continuous zoom via mpv `video-zoom`
- **Rotation** — 0° / 90° / 180° / 270°
- **HDR mode**:
  - Auto — pass HDR if display supports it, else tone-map
  - Passthrough — send HDR signal directly
  - Tone Map — always convert HDR → SDR with full color
  - SDR Only — force standard dynamic range
  - Live HDR badge on the control bar showing detected format (HDR10 / HLG / DV)
- **Upscaling profiles**: Off (bilinear), Low (EWA Lanczos), Medium (neural shader), High (max-quality neural shader)
- **Frame interpolation**: Off, Smooth (light blend), Cinematic (stronger blend)
- **VSync** toggle
- **Exclusive fullscreen** (Windows / D3D11) — bypasses DWM so VSync isn't compositor-gated; takes effect on next fullscreen entry
- **Performance profile**:
  - Auto — switches between Battery Saver and Balanced as the system power state changes
  - Battery Saver — minimum GPU use
  - Balanced — good quality / modest power draw
  - Best Quality — neural upscaler + cinematic interpolation
  - Custom — manual control; touching any individual knob auto-promotes to Custom
- **Pipeline info** readout (Settings → Performance) — shows active VO, GPU context, hwdec, scalers, shader count, resolution, FPS, colorspace

### Timeline
- **Hybrid frame previews** — two-layer thumbnail pipeline scales from short clips to 100-hour files without exploding memory:
  - **Sparse baseline** — background thumbnailer emits a progressive sprite-atlas (~150 tiles regardless of duration) on file load; cached to disk so reopens are ~50 ms (`mpv:thumbnails-ready`)
  - **Dense hover window** — when the cursor settles on the bar (120 ms idle debounce), the backend renders ~30 extra tiles in a ±30 s window around the cursor and streams them as individual `mpv:thumbnail-tile` events; new requests cancel the previous in-flight job
  - **Frontend LRU** — dense tiles bucketed at 250 ms granularity, capped at 300 entries (~1.5 MB heap); evicted oldest-first
  - **Resolution priority** — exact dense bucket → nearest dense within ±0.5 s → baseline sprite tile → timestamp-only
  - Single shared headless mpv worker; baseline + dense interleave on a per-tile lock so a hover request never waits for the whole atlas
- Floating timestamp tooltip always shown; thumbnail shown once its tile is extracted
- Chapter markers with four style options: gap (default), triangle, bar, single-bar

### UI & Appearance
- Frosted-glass control bar with backdrop blur, mounting-blur entrance, spring physics
- Animated cogwheel settings menu (rotates 60°), drop-up with directional slide between sub-pages
- Animated check-mark on the selected option in every list
- Auto-hide controls — always visible when paused, hides 2 s after last mouse move during playback, hides instantly when the cursor leaves the window; cursor hides with the controls
- Hovering the control bar, or opening the settings menu or any side panel, pauses the auto-hide timer
- Custom thin scrollbar (white-on-dark, applied app-wide)
- Click the video to play / pause · double-click to toggle fullscreen
- Error toast for any backend command failure; click to dismiss
- Animated empty state on launch
- **Appearance settings** (Settings → Appearance):
  - Control bar width: Small (compact, essentials only), Large (70 vw, all controls), Full (edge-to-edge)
  - Seek bar height: Small / Medium / Large / X-Large
  - Chapter marker style: Gap / Triangle / Bar / Single-Bar
  - Accent color: White / Blue / Emerald / Pink / Amber (applied as a CSS custom property to the timeline fill, loop button, A-B button, and playlist active row)
- Persistent settings — all preferences (subtitle style/delay, image params, video state, perf profile, HDR, upscaling, interpolation, VSync, exclusive fullscreen, audio FX, appearance, loop mode, screenshot dir) are saved to `trace-player-settings.json` via `tauri-plugin-store` and restored on next launch
- **"Open with" / second-instance forwarding** — Windows passes the file path to the already-running instance via a Tauri event; the player loads it immediately

### Keyboard shortcuts
| Key | Action |
|----|----|
| `Space` / `K` | Play / pause |
| `←` / `J` | Back 10 seconds |
| `→` / `L` | Forward 10 seconds |
| `↑` / `↓` | Volume ±5 |
| `M` | Mute toggle |
| `F` | Fullscreen toggle |
| `Esc` | Exit fullscreen |
| `S` | Screenshot |
| `[` / `]` | Cycle A-B loop (set A, then B, then clear) |
| `\` | Clear A-B loop immediately |
| `,` | Previous chapter |
| `.` | Next chapter |
| `N` | Next playlist item |
| `P` | Previous playlist item |
| `R` | Cycle loop mode (off → file → playlist) |
| `0`–`9` | Seek to 0% – 90% |

Keyboard input is ignored when an `<input>` / `<textarea>` is focused.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri webview (transparent)                                  │
│   React + Tailwind v4 + Framer Motion                        │
│   ControlBar overlay — z-30                                  │
│   Click overlay (play/pause + dblclick fullscreen) — z-10    │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼ invoke()           ▲ listen()
┌──────────────────────────────────────────────────────────────┐
│ Tauri Rust backend                                           │
│   commands.rs   ─── Tauri command handlers (set_volume, …)   │
│   events.rs     ─── mpv_wait_event thread → app.emit("mpv:*")│
│   player.rs     ─── raw libmpv FFI (Player + Sync)           │
│   state.rs      ─── AppState { Option<Arc<Player>> }         │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼ FFI
┌──────────────────────────────────────────────────────────────┐
│ libmpv-2.dll   (renders directly into the Tauri HWND)        │
└──────────────────────────────────────────────────────────────┘
```

**Threading.** `mpv_handle*` is documented as thread-safe per-handle, with one exception: only a single thread may call `mpv_wait_event`. Trace Player respects that — the `Player` is `unsafe impl Sync`, held as `Option<Arc<Player>>` (no `Mutex`), and the dedicated event-loop thread is the sole caller of `wait_event`. Command handlers issue `set_property` / `command` from arbitrary threads concurrently.

**Event emission.** Each observed property gets its own named Tauri event so the webview's `listen` filter does the dispatch in native code (cheap). The frontend never polls.

| Event | Payload | Source |
|---|---|---|
| `mpv:time-pos` | `f64` | `time-pos` observer |
| `mpv:duration` | `f64` | `duration` observer |
| `mpv:pause` | `bool` | `pause` observer |
| `mpv:volume` | `f64` | `volume` observer |
| `mpv:speed` | `f64` | `speed` observer |
| `mpv:tracks` | `{ audio: Track[], subtitle: Track[] }` | re-query of `track-list` on `FILE_LOADED` and on `track-list` change |
| `mpv:eof` | `()` | `END_FILE` |
| `mpv:seekable` | `bool` | `seekable` observer |
| `mpv:core-idle` | `bool` | `core-idle` observer |
| `mpv:idle-active` | `bool` | `idle-active` observer |
| `mpv:file-loaded` | `String` (file path) | `FILE_LOADED` — triggers per-file state re-apply + thumbnailer |
| `mpv:chapters` | `{ title: string \| null, time: number }[]` | re-query of `chapter-list` on `FILE_LOADED` |
| `mpv:playlist` | `PlaylistItem[]` | re-query of `playlist` property on change |
| `mpv:thumbnails-ready` | `{ b64, count, filled, cols, rows, tile_width, tile_height }` | headless thumbnailer thread (progressive baseline atlas) |
| `mpv:thumbnail-tile` | `{ t, b64, tile_width, tile_height }` | dense hover-window worker (per-tile, cancellable) |
| `mpv:hdr-info` | `{ format, primaries, gamma, matrix }` | re-query of video params on `FILE_LOADED` |
| `mpv:power-state` | `bool` (on battery) | system power-state polling thread |
| `mpv:perf-applied` | `ResolvedPerf` | Auto-profile re-applied when battery state flips |
| `mpv:cli-file` | `String` (file path) | "Open with" / second-instance forward |

**Seek race handling.** Timeline drag updates only the visual scrubber. On pointer-up the seek is committed via `invoke("seek")` and a `seekTargetRef` is set to the target seconds. The `mpv:time-pos` listener ignores incoming values until they land within 0.5 s of the target — so the scrubber doesn't snap back to pre-seek frames during demux/decode latency.

---

## Tauri commands

### Core playback
| Command | Args | Returns |
|---|---|---|
| `load_file` | `path: String` | `()` |
| `play` | — | `()` |
| `pause` | — | `()` |
| `seek` | `seconds: f64, mode: "absolute" \| "relative"` | `()` |
| `set_volume` | `volume: f64` | `()` |
| `set_mute` | `muted: bool` | `()` |
| `set_speed` | `speed: f64` | `()` |

### Tracks
| Command | Args | Returns |
|---|---|---|
| `set_audio_track` | `trackId: String` (`"auto"` / numeric) | `()` |
| `set_subtitle_track` | `trackId: String` (`"no"` / `"auto"` / numeric) | `()` |
| `get_tracks` | — | `TrackList { audio, subtitle }` |

### Subtitles
| Command | Args | Returns |
|---|---|---|
| `set_subtitle_style` | `style: SubtitleStyle` | `()` |
| `set_subtitle_delay` | `delayMs: f64` | `()` |

### Audio FX
| Command | Args | Returns |
|---|---|---|
| `set_audio_fx` | `mono, dynamicEnabled, minDb, maxDb, normalize, nightMode, pitchCorrection, audioDelayMs` | `()` |

### Video adjustments
| Command | Args | Returns |
|---|---|---|
| `set_image_params` | `params: { brightness, contrast, saturation, gamma, hue }` | `()` |
| `set_aspect` | `ratio: "auto" \| "16:9" \| "4:3" \| "21:9" \| "fill"` | `()` |
| `set_zoom` | `zoom: f64` | `()` |
| `set_rotate` | `degrees: 0 \| 90 \| 180 \| 270` | `()` |

### HDR / Upscaling / Performance
| Command | Args | Returns |
|---|---|---|
| `set_hdr_mode` | `mode: "auto" \| "passthrough" \| "tone_map" \| "sdr"` | `()` |
| `set_upscaling` | `profile: "off" \| "low" \| "medium" \| "high"` | `()` |
| `set_interpolation` | `mode: "off" \| "smooth" \| "cinematic"` | `()` |
| `set_vsync` | `enabled: bool` | `()` |
| `set_exclusive_fullscreen` | `enabled: bool` | `()` |
| `set_perf_profile` | `profile: "auto" \| "battery_saver" \| "balanced" \| "best_quality" \| "custom"` | `ResolvedPerf \| null` |
| `get_pipeline_info` | — | `PipelineInfo` |

### Screenshot
| Command | Args | Returns |
|---|---|---|
| `take_screenshot` | — | `()` |
| `set_screenshot_dir` | `path: String` | `()` |

### A-B loop & chapters
| Command | Args | Returns |
|---|---|---|
| `ab_loop_cycle` | — | `{ a: f64 \| null, b: f64 \| null }` |
| `ab_loop_clear` | — | `()` |
| `chapter_seek` | `delta: i64` | `()` |

### Loop
| Command | Args | Returns |
|---|---|---|
| `set_loop_file` | `enabled: bool` | `()` |
| `set_loop_playlist` | `enabled: bool` | `()` |

### Playlist
| Command | Args | Returns |
|---|---|---|
| `playlist_add` | `path: String` | `()` |
| `playlist_add_many` | `paths: Vec<String>` | `()` |
| `playlist_remove` | `idx: u32` | `()` |
| `playlist_play_index` | `idx: u32` | `()` |
| `playlist_clear` | — | `()` |
| `playlist_next` | — | `()` |
| `playlist_prev` | — | `()` |
| `playlist_move` | `from: u32, to: u32` | `()` |
| `playlist_shuffle` | — | `()` |
| `get_playlist` | — | `PlaylistItem[]` |

### Thumbnails
| Command | Args | Returns |
|---|---|---|
| `start_thumbnailing` | `path: String` | `()` |
| `request_thumb_window` | `t: f64, radius: f64, density: u32` | `()` |

---

## Stack

- **Frontend:** React 19, Vite 7, TypeScript 5.8, Tailwind CSS v4, Framer Motion 12, Lucide-React
- **Backend:** Tauri 2, Rust 2021, raw libmpv FFI (no `libmpv-rs` crate), serde / serde_json, `tauri-plugin-store` (persistent settings), `tauri-plugin-dialog` (file picker)
- **Engine:** libmpv 2.x via `libmpv-2.dll` (loaded at runtime through the import library)

---

## Build prerequisites (Windows)

1. **Rust GNU toolchain** (the MSVC linker can't consume the MinGW `libmpv.dll.a` import library):
   ```sh
   rustup toolchain install stable-x86_64-pc-windows-gnu
   cd src-tauri
   rustup override set stable-x86_64-pc-windows-gnu
   ```
2. **libmpv files** — placed in `src-tauri/assets/`:
   - `libmpv-2.dll` (runtime DLL, loaded next to the binary)
   - `libmpv.dll.a` (MinGW import library, used at link time)
   - `include/mpv/*.h` (for reference; not required by `build.rs`)
3. **Node 20+** and **npm**.

`build.rs` adds `src-tauri/assets` to the linker search path and links against `mpv`.

## Running

```sh
npm install
npm run tauri dev
```

Production build:

```sh
npm run tauri build
```

---

## Project layout

```
media-player/
├── src/                          — React app
│   ├── App.tsx                   — top-level state, mpv event subscriptions, keyboard handling
│   ├── components/
│   │   ├── ControlBar.tsx        — frosted-glass bar (re-exports types, composes controls)
│   │   ├── PlaylistPanel.tsx     — slide-in playlist side panel
│   │   ├── SubtitleSettingsPanel.tsx — slide-in subtitle style panel
│   │   ├── DevTester.tsx         — dev-only command tester
│   │   ├── types.ts              — shared types + constants (Track, ImageParams, etc.)
│   │   └── controls/
│   │       ├── Timeline.tsx      — seek bar + thumbnail hover + chapter markers
│   │       ├── VolumeControl.tsx — volume slider + mute button
│   │       ├── PlaybackButtons.tsx — play/pause + skip buttons
│   │       └── settings/
│   │           ├── SettingsMenu.tsx       — animated cog drop-up, page router
│   │           └── pages/                — one file per settings page
│   ├── index.css                 — Tailwind import + custom scrollbar
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                — Tauri builder, HWND attach, command registration
│   │   ├── player.rs             — libmpv FFI + Player wrapper (Send + Sync)
│   │   ├── state.rs              — AppState { Option<Arc<Player>>, AgcState, PerfState, … }
│   │   ├── commands.rs           — all Tauri command handlers
│   │   ├── events.rs             — mpv property observation loop + event emission
│   │   ├── perf.rs               — performance profile resolver + mpv knob applicators
│   │   ├── thumbnailer.rs        — headless mpv instance → baseline sprite-atlas + on-hover dense window (cancellable, lock-serialized)
│   │   └── agc.rs                — automatic gain control tick thread
│   ├── assets/                   — libmpv-2.dll, libmpv.dll.a, include/
│   ├── capabilities/default.json
│   ├── tauri.conf.json           — transparent: true window
│   ├── build.rs                  — links against mpv from src-tauri/assets/
│   └── Cargo.toml
└── package.json
```

---

## Roadmap (not yet implemented)

- **External subtitle file load** (`sub-add` for `.srt` / `.ass`) — drag-and-drop or file dialog
- **Frame-step** (single frame advance/back) via mpv `frame-step` / `frame-back-step`
- **Remember last-played position per file** — resume playback from where you left off
- **macOS layer-based embedding** — currently only Windows (HWND) and Linux (X11 XID) are wired
