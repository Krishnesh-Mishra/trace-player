// Lazy on-hover thumbnail extraction.
//
// One headless mpv worker, two reactive paths — neither pre-extracts:
//
//   1. `request_dense_window` (hover): render N tiles in `[t-radius, t+radius]`
//      and stream them as `mpv:thumbnail-tile` events. Old jobs are cancelled
//      when a new one arrives — the frontend keeps an LRU of received tiles.
//
//   2. `request_exact_frame` (cursor still ~120 ms): pixel-precise single
//      frame at the requested timestamp. Same event type as dense.
//
// `start_thumbnail_job` no longer pre-extracts a baseline sprite. It simply
// loads the file in the headless mpv so dense / exact requests have a seek
// target, plus opportunistically emits any legacy cached sprite that still
// happens to live under %TEMP%/trace-player-thumbs/.
//
// Memory: only transient per-tile JPEGs (~5 KB each) cross IPC; the JS-side
// LRU caps total memory at a few MB. Disk: zero new writes; the legacy
// cache directory drains via TTL pruning.

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose, Engine as _};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ImageReader, RgbImage};
use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Emitter};

use crate::player::{MpvEvent, Player};

static THUMB_COUNTER: AtomicU64 = AtomicU64::new(0);

const TILE_W: u32 = 160;
const TILE_H: u32 = 90;
const DEFER_BEFORE_START: Duration = Duration::from_millis(1500);
const FILE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_DIR_NAME: &str = "trace-player-thumbs";
// Bump when read_cached_layout's expectations change. Legacy caches with a
// matching version may still be emitted as a fully-filled sprite on load.
const CACHE_VERSION: u32 = 3;
const CACHE_TTL_DAYS: u64 = 30;

#[derive(Serialize, Clone)]
pub struct ThumbnailReady {
    pub b64: String,
    pub count: u32,  // total tiles the sprite is sized for
    pub filled: u32, // number of tiles actually rendered so far
    pub cols: u32,
    pub rows: u32,
    pub tile_width: u32,
    pub tile_height: u32,
}

#[derive(Serialize, Clone)]
pub struct ThumbnailTile {
    pub t: f64,
    pub b64: String,
    pub tile_width: u32,
    pub tile_height: u32,
}

// Module-level synchronization. Both baseline and dense jobs run on the
// shared headless mpv (`thumbnailer` Arc<Player>); WORKER_LOCK makes their
// seek+screenshot steps mutually exclusive at per-tile granularity so
// hover requests aren't blocked by the entire baseline pass.
static WORKER_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
// Active dense-window cancel flag. Submitting a new dense request flips
// the previous flag so the displaced job bails before its next tile.
static DENSE_TOKEN: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
// Independent cancel slot for one-shot exact-frame requests. Kept separate
// so a fresh dense window request doesn't kill an in-flight exact frame
// (and vice versa) — each replaces only its own predecessor.
static EXACT_TOKEN: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

fn worker_lock() -> &'static Mutex<()> {
    WORKER_LOCK.get_or_init(|| Mutex::new(()))
}

fn dense_slot() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    DENSE_TOKEN.get_or_init(|| Mutex::new(None))
}

fn exact_slot() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    EXACT_TOKEN.get_or_init(|| Mutex::new(None))
}

/// Cancel any in-flight dense-window job (called when a new file is loaded
/// or a fresher hover request arrives).
fn cancel_active_dense() {
    if let Ok(mut slot) = dense_slot().lock() {
        if let Some(prev) = slot.take() {
            prev.store(true, Ordering::Relaxed);
        }
    }
}

fn cancel_active_exact() {
    if let Ok(mut slot) = exact_slot().lock() {
        if let Some(prev) = slot.take() {
            prev.store(true, Ordering::Relaxed);
        }
    }
}

pub fn start_thumbnail_job(app: AppHandle, thumb: Arc<Player>, path: String) {
    // A new file invalidates any in-flight dense job for the old file.
    cancel_active_dense();
    cancel_active_exact();
    crate::np_info!("thumb", "start_thumbnail_job path={} (lazy mode)", path);

    thread::spawn(move || {
        // Defer so the main player's first ~second of I/O is unimpeded.
        thread::sleep(DEFER_BEFORE_START);

        // Sweep stale caches from prior versions (we no longer write new
        // ones — kept here so old %TEMP% entries do drain over time).
        let _ = prune_old_cache();

        let fp = match file_fingerprint(&path) {
            Some(f) => f,
            None => {
                crate::np_warn!("thumb", "fingerprint failed for {}", path);
                return;
            }
        };
        let key = format!("{}_v{}", fp, CACHE_VERSION);
        let cache_path = cache_root().join(format!("{key}.jpg"));

        // Legacy cache hit (sprite from a previous version that DID
        // pre-extract). Emit it as fully-filled — free instant preview —
        // then load the file in the thumbnailer so dense / exact requests
        // can seek on it. New files no longer create cache entries: the
        // sprite is purely lazy now, populated by request_dense_window
        // on hover, with the JS-side LRU as the only persistence layer.
        if cache_path.exists() {
            if let Ok(bytes) = fs::read(&cache_path) {
                if let Some(meta) = read_cached_layout(&bytes) {
                    crate::np_info!(
                        "thumb",
                        "legacy cache HIT key={} count={} (no new caches written)",
                        key,
                        meta.count
                    );
                    let b64 = general_purpose::STANDARD.encode(&bytes);
                    let _ = app.emit(
                        "mpv:thumbnails-ready",
                        ThumbnailReady {
                            b64,
                            count: meta.count,
                            filled: meta.count,
                            cols: meta.cols,
                            rows: meta.rows,
                            tile_width: TILE_W,
                            tile_height: TILE_H,
                        },
                    );
                }
            }
        }

        // Always load the file in the thumbnailer mpv so dense / exact
        // requests have something to seek on. No baseline extraction —
        // hover requests do all the work on demand.
        if let Ok(_g) = worker_lock().lock() {
            if let Err(e) = thumb.load(&path) {
                crate::np_err!("thumb", "thumbnailer load failed: {e}");
                return;
            }
            if let Err(e) = wait_for_load(&thumb) {
                crate::np_err!("thumb", "thumbnailer wait_for_load: {e}");
            }
        }
    });
}

/// Public entry point for hover requests. Cancels any prior dense job,
/// installs a fresh cancel token, and spawns a worker that renders
/// `density` tiles centered on `t_center`.
pub fn request_dense_window(
    app: AppHandle,
    thumb: Arc<Player>,
    t_center: f64,
    radius: f64,
    density: u32,
) {
    if !t_center.is_finite() || radius <= 0.0 || density == 0 {
        return;
    }
    let radius = radius.min(120.0);
    let density = density.min(60).max(1);
    crate::np_debug!(
        "thumb",
        "dense window request t={:.3} radius={:.1} density={}",
        t_center,
        radius,
        density
    );

    // Swap in our cancel token; flip the previous one so its job exits.
    let token = Arc::new(AtomicBool::new(false));
    {
        let mut slot = match dense_slot().lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        if let Some(prev) = slot.take() {
            prev.store(true, Ordering::Relaxed);
            crate::np_debug!("thumb", "dense window: cancelled prior job");
        }
        *slot = Some(token.clone());
    }

    thread::spawn(move || {
        let started = std::time::Instant::now();
        let tmp_root = std::env::temp_dir().join("trace-player-thumb-tmp");
        // Best-effort cleanup of leftover tiles from previous runs
        if let Ok(entries) = std::fs::read_dir(&tmp_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map(|e| e == "jpg").unwrap_or(false) {
                    let _ = std::fs::remove_file(p);
                }
            }
        }
        let _ = fs::create_dir_all(&tmp_root);
        let tid = format!("{:?}", std::thread::current().id()).replace(['(', ')', ' ', '\"'], "");
        let seq = THUMB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp_tile = tmp_root.join(format!(
            "tile-{}-{}-{}-dense.jpg",
            std::process::id(),
            seq,
            tid
        ));

        let duration = thumb.get_property_f64("duration").unwrap_or(0.0);
        if !duration.is_finite() || duration <= 0.0 {
            crate::np_warn!("thumb", "dense window: no duration, abort");
            return;
        }

        let step = (2.0 * radius) / density as f64;
        let start = (t_center - radius).max(0.0);
        let mut emitted: u32 = 0;
        let mut skipped: u32 = 0;

        for i in 0..density {
            if token.load(Ordering::Relaxed) {
                break;
            }
            let t = (start + (i as f64 + 0.5) * step).clamp(0.0, duration.max(0.0));

            // Skip frames outside the file (radius can extend past EOF).
            if t > duration {
                continue;
            }

            let img = match extract_one_frame(&thumb, t, &tmp_tile, &token) {
                Some(i) => i,
                None => {
                    skipped += 1;
                    continue;
                }
            };
            if token.load(Ordering::Relaxed) {
                break;
            }
            if let Some(bytes) = encode_jpeg(&img, 70) {
                let b64 = general_purpose::STANDARD.encode(&bytes);
                let _ = app.emit(
                    "mpv:thumbnail-tile",
                    ThumbnailTile {
                        t,
                        b64,
                        tile_width: TILE_W,
                        tile_height: TILE_H,
                    },
                );
                emitted += 1;
            }
        }

        let _ = fs::remove_file(&tmp_tile);
        let cancelled = token.load(Ordering::Relaxed);
        crate::np_info!(
            "thumb",
            "dense window done: emitted={} skipped={} cancelled={} elapsed={}ms",
            emitted,
            skipped,
            cancelled,
            started.elapsed().as_millis()
        );

        // If our token is still installed, clear the slot.
        if let Ok(mut slot) = dense_slot().lock() {
            if let Some(cur) = slot.as_ref() {
                if Arc::ptr_eq(cur, &token) {
                    *slot = None;
                }
            }
        }
    });
}

/// Render exactly one frame at time `t` and emit it as a `mpv:thumbnail-tile`
/// event. Used for pixel-precise hover preview: the frontend asks for the
/// frame at the cursor's exact time after the user has held the cursor still
/// for ~120 ms. Each new request cancels the prior one — its own slot,
/// independent from dense-window jobs.
pub fn request_exact_frame(app: AppHandle, thumb: Arc<Player>, t: f64) {
    if !t.is_finite() || t < 0.0 {
        crate::np_warn!("thumb", "request_exact_frame: invalid t={t}");
        return;
    }
    crate::np_debug!("thumb", "exact frame request t={:.3}", t);

    let token = Arc::new(AtomicBool::new(false));
    {
        let mut slot = match exact_slot().lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        if let Some(prev) = slot.take() {
            prev.store(true, Ordering::Relaxed);
        }
        *slot = Some(token.clone());
    }

    thread::spawn(move || {
        let started = std::time::Instant::now();
        let tmp_root = std::env::temp_dir().join("trace-player-thumb-tmp");
        // Best-effort cleanup of leftover tiles from previous runs
        if let Ok(entries) = std::fs::read_dir(&tmp_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map(|e| e == "jpg").unwrap_or(false) {
                    let _ = std::fs::remove_file(p);
                }
            }
        }
        let _ = fs::create_dir_all(&tmp_root);
        let tid = format!("{:?}", std::thread::current().id()).replace(['(', ')', ' ', '\"'], "");
        let seq = THUMB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp_tile = tmp_root.join(format!(
            "tile-{}-{}-{}-exact.jpg",
            std::process::id(),
            seq,
            tid
        ));

        let duration = thumb.get_property_f64("duration").unwrap_or(0.0);
        if !duration.is_finite() || duration <= 0.0 {
            crate::np_warn!("thumb", "exact frame: no duration, abort");
            return;
        }
        let t_clamped = t.clamp(0.0, duration);

        if token.load(Ordering::Relaxed) {
            return;
        }

        match extract_one_frame(&thumb, t_clamped, &tmp_tile, &token) {
            Some(img) => {
                if !token.load(Ordering::Relaxed) {
                    if let Some(bytes) = encode_jpeg(&img, 78) {
                        let b64 = general_purpose::STANDARD.encode(&bytes);
                        let _ = app.emit(
                            "mpv:thumbnail-tile",
                            ThumbnailTile {
                                t: t_clamped,
                                b64,
                                tile_width: TILE_W,
                                tile_height: TILE_H,
                            },
                        );
                        crate::np_info!(
                            "thumb",
                            "exact frame delivered t={:.3} elapsed={}ms",
                            t_clamped,
                            started.elapsed().as_millis()
                        );
                    }
                }
            }
            None => {
                crate::np_debug!(
                    "thumb",
                    "exact frame skipped (cancelled or extract failed) t={:.3}",
                    t_clamped
                );
            }
        }

        let _ = fs::remove_file(&tmp_tile);

        if let Ok(mut slot) = exact_slot().lock() {
            if let Some(cur) = slot.as_ref() {
                if Arc::ptr_eq(cur, &token) {
                    *slot = None;
                }
            }
        }
    });
}

/// Single seek+screenshot under WORKER_LOCK. Returns the resized RGB tile
/// or None on any failure. Honors `cancel` between the lock acquire and
/// the actual mpv work so a stale dense job exits before doing more I/O.
fn extract_one_frame(
    thumb: &Player,
    t: f64,
    tmp_tile: &PathBuf,
    cancel: &Arc<AtomicBool>,
) -> Option<RgbImage> {
    let _g = worker_lock().lock().ok()?;
    if cancel.load(Ordering::Relaxed) {
        return None;
    }

    let t_str = format!("{:.3}", t);
    // Silent variant: dense / baseline jobs frequently race with file
    // unloads and playlist transitions, where the seek legitimately fails.
    // Logging every miss here floods the dev console (50+ errors / hover).
    if thumb.command_silent(&["seek", &t_str, "absolute"]).is_err() {
        return None;
    }
    wait_for_seek(thumb, Duration::from_millis(800));
    if cancel.load(Ordering::Relaxed) {
        return None;
    }

    let tmp_str = tmp_tile.to_str()?;
    if thumb.screenshot_to_file(tmp_str).is_err() {
        return None;
    }
    load_and_normalize(tmp_tile)
}

/// Block on the thumbnailer's event pump until FILE_LOADED arrives (or we
/// time out). Caller must already hold WORKER_LOCK.
fn wait_for_load(thumb: &Player) -> Result<(), String> {
    let deadline = std::time::Instant::now() + FILE_LOAD_TIMEOUT;
    loop {
        if std::time::Instant::now() > deadline {
            return Err("thumbnailer file-load timeout".to_string());
        }
        match thumb.wait_event(0.5) {
            MpvEvent::FileLoaded => return Ok(()),
            MpvEvent::EndFile { .. } => {
                return Err("thumbnailer end-of-file before load".to_string())
            }
            MpvEvent::Shutdown => return Err("thumbnailer shut down".to_string()),
            _ => continue,
        }
    }
}

/// Drain the event queue until PLAYBACK_RESTART (seek complete) or timeout.
fn wait_for_seek(thumb: &Player, timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        let remaining = deadline
            .saturating_duration_since(std::time::Instant::now())
            .as_secs_f64();
        if remaining <= 0.0 {
            return;
        }
        match thumb.wait_event(remaining.min(0.2)) {
            MpvEvent::PlaybackRestart => return,
            MpvEvent::Shutdown | MpvEvent::EndFile { .. } => return,
            _ => continue,
        }
    }
}

const LIB_THUMB_W: u32 = 320;
const LIB_THUMB_H: u32 = 180;

pub fn generate_persistent_thumb(
    thumb: &Player,
    source_path: &str,
    dest_path: &std::path::Path,
) -> Result<(), String> {
    crate::np_info!("thumb", "gen start: {}", source_path);
    let _g = worker_lock()
        .lock()
        .map_err(|e| { crate::np_err!("thumb", "worker lock: {e}"); format!("worker lock: {e}") })?;

    crate::np_info!("thumb", "loading file in thumbnailer");
    thumb.load(source_path).map_err(|e| { crate::np_err!("thumb", "load failed: {e}"); format!("load: {e}") })?;
    wait_for_load(thumb).map_err(|e| { crate::np_err!("thumb", "wait_for_load failed: {e}"); e })?;

    let duration = thumb.get_property_f64("duration").unwrap_or(0.0);
    if !duration.is_finite() || duration <= 0.0 {
        crate::np_err!("thumb", "bad duration: {duration}");
        return Err("no duration".to_string());
    }

    let seek_to = duration * 0.5;
    crate::np_info!("thumb", "seeking to {:.1}s (duration={:.1}s)", seek_to, duration);
    let t_str = format!("{:.3}", seek_to);
    thumb
        .command_silent(&["seek", &t_str, "absolute"])
        .map_err(|e| { crate::np_err!("thumb", "seek failed: {e}"); format!("seek: {e}") })?;
    wait_for_seek(thumb, Duration::from_secs(10));

    let tmp_root = std::env::temp_dir().join("trace-player-thumb-tmp");
    let _ = fs::create_dir_all(&tmp_root);
    let tmp_file = tmp_root.join(format!("lib-{}.png", std::process::id()));
    let tmp_str = tmp_file.to_str().ok_or("bad tmp path")?;

    crate::np_info!("thumb", "taking screenshot to {}", tmp_str);
    thumb
        .screenshot_to_file(tmp_str)
        .map_err(|e| { crate::np_err!("thumb", "screenshot failed: {e}"); format!("screenshot: {e}") })?;

    let file_len = fs::metadata(&tmp_file).map(|m| m.len()).unwrap_or(0);
    crate::np_info!("thumb", "screenshot file size: {} bytes", file_len);
    if file_len == 0 {
        let _ = fs::remove_file(&tmp_file);
        return Err("screenshot produced empty file".to_string());
    }

    let img = ImageReader::open(&tmp_file)
        .map_err(|e| { crate::np_err!("thumb", "open screenshot: {e}"); format!("open screenshot: {e}") })?
        .decode()
        .map_err(|e| { crate::np_err!("thumb", "decode screenshot: {e}"); format!("decode screenshot: {e}") })?;
    let resized = img.resize_exact(LIB_THUMB_W, LIB_THUMB_H, FilterType::Lanczos3);
    let rgb = resized.to_rgb8();

    let jpeg_bytes = encode_jpeg(&rgb, 80).ok_or("jpeg encode failed")?;

    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(dest_path, &jpeg_bytes).map_err(|e| format!("write thumb: {e}"))?;
    let _ = fs::remove_file(&tmp_file);

    crate::np_info!("thumb", "saved to {:?}", dest_path);
    Ok(())
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub width: i64,
    pub height: i64,
    pub video_count: usize,
    pub audio_count: usize,
    pub subtitle_count: usize,
}

pub fn probe_media_info(thumb: &Player, source_path: &str) -> Result<MediaInfo, String> {
    let _g = worker_lock()
        .lock()
        .map_err(|e| format!("worker lock: {e}"))?;

    thumb.load(source_path).map_err(|e| format!("load: {e}"))?;
    wait_for_load(thumb)?;

    let width = thumb.get_int_prop("video-params/w").unwrap_or(0);
    let height = thumb.get_int_prop("video-params/h").unwrap_or(0);

    let track_json = thumb
        .get_property_string("track-list")
        .unwrap_or_else(|| "[]".to_string());

    let (mut video_count, mut audio_count, mut subtitle_count) = (0usize, 0, 0);
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&track_json) {
        if let Some(arr) = parsed.as_array() {
            for entry in arr {
                match entry.get("type").and_then(|v| v.as_str()) {
                    Some("video") => video_count += 1,
                    Some("audio") => audio_count += 1,
                    Some("sub") => subtitle_count += 1,
                    _ => {}
                }
            }
        }
    }

    crate::np_info!(
        "probe",
        "{}x{}, {} video, {} audio, {} sub",
        width, height, video_count, audio_count, subtitle_count
    );

    Ok(MediaInfo {
        width,
        height,
        video_count,
        audio_count,
        subtitle_count,
    })
}

fn load_and_normalize(path: &PathBuf) -> Option<RgbImage> {
    let img = ImageReader::open(path).ok()?.decode().ok()?;
    let resized = img.resize_exact(TILE_W, TILE_H, FilterType::Lanczos3);
    Some(resized.to_rgb8())
}

fn encode_jpeg(sprite: &RgbImage, quality: u8) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(sprite.width() as usize * sprite.height() as usize / 4);
    let mut enc = JpegEncoder::new_with_quality(Cursor::new(&mut buf), quality);
    enc.encode_image(sprite).ok()?;
    Some(buf)
}

struct CachedLayout {
    count: u32,
    cols: u32,
    rows: u32,
}

fn read_cached_layout(jpeg_bytes: &[u8]) -> Option<CachedLayout> {
    let dim = ImageReader::new(Cursor::new(jpeg_bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    let cols = dim.0 / TILE_W;
    let rows = dim.1 / TILE_H;
    if cols == 0 || rows == 0 {
        return None;
    }
    Some(CachedLayout {
        count: cols * rows,
        cols,
        rows,
    })
}

fn cache_root() -> PathBuf {
    std::env::temp_dir().join(CACHE_DIR_NAME)
}

fn file_fingerprint(path: &str) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut hasher = Sha1::new();
    hasher.update(path.as_bytes());
    hasher.update(b":");
    hasher.update(mtime.to_le_bytes());
    hasher.update(b":");
    hasher.update(size.to_le_bytes());
    let digest = hasher.finalize();
    Some(hex::encode(&digest[..8]))
}

fn prune_old_cache() -> std::io::Result<()> {
    let root = cache_root();
    if !root.exists() {
        return Ok(());
    }
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(CACHE_TTL_DAYS * 24 * 3600))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in fs::read_dir(&root)?.flatten() {
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(())
}
