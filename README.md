# Trace Player

A modern desktop video player built with **Tauri 2 + React + libmpv**. Native rendering via mpv, a transparent React overlay for a frosted-glass UI, and full torrent streaming + download management.

The decode/render path is delegated entirely to mpv — Trace Player never reimplements decoding. The UI is event-driven (no polling, no `setInterval`) and gets all live state through Tauri events emitted by a dedicated mpv-event thread.

---

## Features

### Playback
- Open `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.m4v`, `.ts`, `.flv`, `.wmv`
- Hardware-accelerated video output (`vo=gpu`, `hwdec=auto`)
- Play / pause, ±10 s skip, seek to any position (commit-on-release with seek-target reconciliation)
- Variable playback speed: 0.25× – 2×
- Volume slider (0–100) with mute toggle and adaptive icon
- **Frame step** — advance or back one frame at a time (`<` / `>`)
- **A-B loop** — `[` to mark A, `]` to mark B, `\` to clear
- **Chapter navigation** — `,` / `.` jump to previous/next chapter; configurable chapter markers on the timeline
- **Loop mode** — three-state cycle: off → loop file → loop playlist (press `R`)
- **Screenshot** — capture the current video frame; configurable output directory (`S`)
- **Jump to time** dialog (`G`) — seek to an exact timestamp
- **Force redraw** (`V`) — recovery command that forces mpv to re-render

### Torrent Streaming & Downloads
- **Stream torrents** directly from magnet links — no need to wait for a full download
- **Per-file selection** — browse files inside a torrent and pick individual videos to stream or download
- **Download manager** with real-time progress, speed, peer count, and ETA
- **Pause / resume / cancel** individual downloads
- **Play downloaded files** directly from disk without re-connecting to the torrent
- **Resume partial downloads** — re-add the magnet and pick up where you left off
- **Download properties** dialog — name, size, progress, state, file index, magnet link with copy button
- **Context menus** on downloads for play, resume, properties, and remove actions
- **Configurable torrent settings** — cache limit, upload/download speed limits, max connections
- Powered by **rqbit** (spawned as a sidecar HTTP API)

### Library
A full-screen modal (`B` to open) with four tabs:

- **Local** — browse folders, pin favourites, view recent files
- **Explore** — auto-scan common directories (Documents, Videos, Downloads) for video files; thumbnail grid with lazy loading
- **Torrents** — paste a magnet link, browse the file list, stream or download individual files
- **Downloads** — active downloads with progress bars and completed downloads with one-click playback

### Archive Support
- Open `.zip`, `.7z`, and `.rar` archives containing video files
- Lazy extraction with LRU eviction — only the selected file is extracted, previous extractions are cleaned up

### Audio
- **Audio track** picker — every embedded audio stream (lang / title / codec)
- **Audio device** selector — switch output device without restarting
- **10-band equalizer** — per-band dB gains via `firequalizer` (zero-phase)
- **Mono audio** toggle — downmix stereo to mono
- **Dynamic Audio (AGC)** — automatic gain control with configurable dB target band
- **Normalize** — `loudnorm` filter targeting −16 LUFS
- **Night Mode** — `acompressor` (threshold −21 dB, ratio 4:1) for quiet listening
- **Pitch correction** toggle
- **Audio delay** — sync offset ±2000 ms
- All audio effects rebuild the `af` chain atomically in a single backend call

### Subtitles
- Embedded subtitle track picker (Off / Auto / per-stream)
- **Load external subtitles** from file (`.srt`, `.ass`, etc.)
- **Subtitle style panel**: font family, size, color, border, shadow, margin, bold, alignment
- **Subtitle delay** slider

### Video
- **Image adjustments**: brightness, contrast, saturation, gamma, hue, sharpness
- **Aspect ratio**: Auto, 16:9, 4:3, 21:9, Fill (panscan)
- **Zoom** and **rotation** (0° / 90° / 180° / 270°)
- **Deinterlace** toggle
- **HDR mode**: Auto, Passthrough, Tone Map, SDR Only — live HDR badge (HDR10 / HLG / DV)
- **Upscaling profiles**: Off (bilinear), Low (EWA Lanczos), Medium (FSRCNNX neural shader), High (max-quality neural + KrigBilateral)
- **Frame interpolation**: Off, Smooth, Cinematic
- **VSync** toggle
- **Exclusive fullscreen** (Windows / D3D11) — bypasses DWM compositor
- **Performance profiles**: Auto (battery-aware), Battery Saver, Balanced, Best Quality, Custom
- **Pipeline info** readout — active VO, GPU context, hwdec, scalers, shader count, resolution, FPS, colorspace
- **Media info** dialog (`I`) — format, codec, bitrate, resolution, frame rate, and more

### Picture-in-Picture
- Toggle PiP mode with `F8`
- Persistent window size and position across sessions

### Gesture Support
Touch and trackpad gestures via a transparent overlay:
- **Tap** — play / pause
- **Double-tap left/right** — seek ±10 s
- **Vertical swipe (right half)** — volume control
- **Vertical swipe (left half)** — brightness control
- **Horizontal swipe** — scrub timeline
- **Two-finger pinch** — zoom
- Real-time overlay feedback for all gestures

### Timeline
- **Hybrid frame previews** — two-layer thumbnail pipeline:
  - **Sparse baseline** — progressive sprite-atlas (~150 tiles) generated on file load; cached to disk
  - **Dense hover window** — ~30 extra tiles in a ±30 s window around the cursor, streamed on demand
  - **Frontend LRU** — dense tiles at 250 ms granularity, capped at 300 entries
- Floating timestamp tooltip; thumbnail shown once extracted
- Chapter markers with four styles: gap, triangle, bar, single-bar

### Playlist
- Queue files from the file dialog, drag-and-drop, or "Open with"
- Side-panel with drag-to-reorder, remove, clear, and shuffle / unshuffle
- Auto-advance with per-file state re-apply (audio FX, subtitles, image params, perf profile)

### UI & Appearance
- **Custom title bar** — thin, theme-aware bar with drag-to-move, minimize, maximize/restore, and close buttons (no native OS decorations)
- **6 themes**: Dark Translucent, Dark Solid, Light Translucent, Light Solid, OLED Black, Sepia — applied via CSS custom properties (`--np-*`)
- Frosted-glass control bar with backdrop blur, mounting-blur entrance, spring physics
- Animated cogwheel settings menu with directional slide between sub-pages
- Auto-hide controls — visible when paused, hidden 2 s after last mouse move during playback
- Custom thin scrollbar (app-wide)
- Click video to play/pause, double-click to toggle fullscreen
- Error toast for backend command failures
- **Control bar width**: Small, Large, Full
- **Seek bar height**: Small, Medium, Large, X-Large
- **Accent color**: White, Blue, Emerald, Pink, Amber
- Persistent settings via `tauri-plugin-store` — all preferences restored on next launch

### Windows Integration
- **System Media Transport Controls (SMTC)** — lock screen, volume flyout, Game Bar, and media key support
- **Taskbar thumb-bar** — Previous / Play-Pause / Next buttons on the taskbar thumbnail
- **File associations** — `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.m4v`, `.ts`, `.flv`, `.wmv`, `.torrent`
- **"Open with" / second-instance forwarding** — file path forwarded to the running instance

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Space` / `K` | Play / pause |
| `←` / `J` | Back 10 s |
| `→` / `L` | Forward 10 s |
| `↑` / `↓` | Volume ±5 |
| `M` | Mute toggle |
| `F` | Fullscreen toggle |
| `Esc` | Exit fullscreen |
| `S` | Screenshot |
| `[` / `]` | Cycle A-B loop |
| `\` | Clear A-B loop |
| `,` / `.` | Previous / next chapter |
| `N` / `P` | Next / previous playlist item |
| `R` | Cycle loop mode |
| `G` | Jump to time |
| `I` | Media info |
| `B` | Open library |
| `V` | Force video redraw |
| `F8` | Toggle Picture-in-Picture |
| `<` / `>` | Frame step backward / forward |
| `0`–`9` | Seek to 0%–90% |

Keyboard input is ignored when an `<input>` / `<textarea>` is focused.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri webview (transparent)                                  │
│   React + Tailwind v4 + Framer Motion + HeroUI               │
│   Custom title bar — z-80                                    │
│   ControlBar overlay — z-30                                  │
│   Gesture overlay — z-10                                     │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼ invoke()           ▲ listen()
┌──────────────────────────────────────────────────────────────┐
│ Tauri Rust backend                                           │
│   commands.rs   ─── 79+ Tauri command handlers               │
│   events.rs     ─── mpv_wait_event → app.emit("mpv:*")      │
│   player.rs     ─── raw libmpv FFI (Player + Sync)           │
│   streaming.rs  ─── rqbit sidecar management + torrent API   │
│   archive.rs    ─── zip/7z/rar lazy extraction + LRU cache   │
│   thumbnailer.rs─── baseline atlas + dense hover thumbnails  │
│   agc.rs        ─── automatic gain control tick thread        │
│   perf.rs       ─── performance profile resolver              │
│   state.rs      ─── AppState (player, AGC, perf, torrents)   │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼ FFI
┌──────────────────────────────────────────────────────────────┐
│ libmpv-2.dll   (renders directly into the Tauri HWND)        │
│ rqbit.exe      (torrent client sidecar, HTTP API)            │
└──────────────────────────────────────────────────────────────┘
```

**Threading.** `mpv_handle*` is thread-safe per-handle, with one exception: only a single thread may call `mpv_wait_event`. The `Player` is `unsafe impl Sync`, held as `Option<Arc<Player>>` (no `Mutex`), and the dedicated event-loop thread is the sole caller of `wait_event`.

**Event emission.** Each observed property gets its own named Tauri event. The frontend never polls.

**Seek race handling.** Timeline drag updates only the visual scrubber. On pointer-up the seek is committed and a `seekTargetRef` is set. The `mpv:time-pos` listener ignores values until they land within 0.5 s of the target.

---

## Stack

- **Frontend:** React 19, Vite 7, TypeScript 5.8, Tailwind CSS v4, Framer Motion 12, HeroUI, Lucide-React
- **Backend:** Tauri 2, Rust 2021, raw libmpv FFI, serde, `tauri-plugin-store`, `tauri-plugin-dialog`, `tauri-plugin-sql` (SQLite)
- **Engine:** libmpv 2.x via `libmpv-2.dll`
- **Torrents:** rqbit (sidecar process with HTTP API)
- **Archives:** zip (pure Rust), sevenz-rust (pure Rust), unrar (vendored C lib)
- **Shaders:** FSRCNNX (neural upscaler), KrigBilateral (chroma reconstruction)

---

## Build Prerequisites (Windows)

1. **Rust GNU toolchain** (the MSVC linker can't consume the MinGW `libmpv.dll.a` import library):
   ```sh
   rustup toolchain install stable-x86_64-pc-windows-gnu
   cd src-tauri
   rustup override set stable-x86_64-pc-windows-gnu
   ```
2. **libmpv files** in `src-tauri/assets/`:
   - `libmpv-2.dll` (runtime DLL)
   - `libmpv.dll.a` (MinGW import library)
3. **rqbit.exe** in `src-tauri/assets/` (torrent sidecar binary)
4. **Node 20+** and **npm**

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

## Project Layout

```
trace-player/
├── src/                              — React app
│   ├── App.tsx                       — top-level state, events, keyboard, gestures
│   ├── components/
│   │   ├── TitleBar.tsx              — custom title bar (drag, minimize, maximize, close)
│   │   ├── ControlBar.tsx            — frosted-glass control bar
│   │   ├── GestureLayer.tsx          — touch/trackpad gesture overlay
│   │   ├── PlaylistPanel.tsx         — slide-in playlist side panel
│   │   ├── SubtitleSettingsPanel.tsx  — subtitle style panel
│   │   ├── ContextMenu.tsx           — reusable context menu component
│   │   ├── library/
│   │   │   ├── LibraryModal.tsx      — full-screen library (Local, Torrents, Explore, Downloads)
│   │   │   ├── LibraryExploreView.tsx— auto-scan + video grid with thumbnails
│   │   │   └── DownloadsView.tsx     — download manager (progress, context menus, properties)
│   │   ├── controls/
│   │   │   ├── Timeline.tsx          — seek bar + thumbnails + chapter markers
│   │   │   ├── VolumeControl.tsx     — volume slider + mute
│   │   │   ├── PlaybackButtons.tsx   — play/pause + skip
│   │   │   └── settings/
│   │   │       ├── SettingsMenu.tsx  — animated cog drop-up
│   │   │       └── pages/            — 18+ settings pages (audio, video, EQ, HDR, etc.)
│   │   └── types.ts                  — shared types + constants
│   ├── index.css                     — Tailwind + themes + scrollbar
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                    — Tauri builder, HWND attach, migrations
│   │   ├── player.rs                 — libmpv FFI wrapper
│   │   ├── state.rs                  — AppState
│   │   ├── commands.rs               — 79+ Tauri command handlers
│   │   ├── events.rs                 — mpv event loop + Tauri event emission
│   │   ├── streaming.rs              — rqbit sidecar + torrent API
│   │   ├── archive.rs                — zip/7z/rar lazy extraction
│   │   ├── perf.rs                   — performance profiles
│   │   ├── thumbnailer.rs            — thumbnail generation (baseline + dense)
│   │   └── agc.rs                    — automatic gain control
│   ├── assets/                       — libmpv-2.dll, libmpv.dll.a, rqbit.exe
│   ├── resources/shaders/            — FSRCNNX, KrigBilateral GLSL shaders
│   ├── migrations/                   — SQLite migrations (downloads table, etc.)
│   ├── capabilities/default.json
│   ├── tauri.conf.json
│   ├── build.rs
│   └── Cargo.toml
└── package.json
```

---

By Krishnesh Mishra
