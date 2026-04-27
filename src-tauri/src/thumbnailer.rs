// Background thumbnail extraction (hybrid baseline + on-hover dense window).
//
// Two layers share one headless mpv worker:
//
//   1. Baseline (`start_thumbnail_job`): a sparse sprite atlas covering the
//      whole file, ~150 tiles regardless of duration. Persisted to disk so
//      reopening a file is ~50 ms. Progressive emit every 10 tiles via
//      `mpv:thumbnails-ready`.
//
//   2. Dense window (`request_dense_window`): on hover, render N tiles in
//      `[t-radius, t+radius]` and stream them as individual events
//      (`mpv:thumbnail-tile`). Old jobs are cancelled when a new one comes
//      in — the frontend keeps an LRU of received tiles.
//
// Both layers serialize on a per-tile `WORKER_LOCK` so a hover request can
// interleave between baseline tiles instead of waiting for the whole atlas.
// Memory is bounded: baseline = constant tile count, dense = transient
// per-tile JPEGs (~5 KB) the frontend caches and evicts.
//
// Cache: per-file sha1 of (path + mtime + size) keys a JPEG sprite under
// %TEMP%/trace-player-thumbs/. CACHE_VERSION invalidates on layout changes.

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose, Engine as _};
use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, GenericImage, ImageReader, RgbImage,
};
use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Emitter};

use crate::player::{MpvEvent, Player};

const TILE_W: u32 = 160;
const TILE_H: u32 = 90;
const COLS: u32 = 10;
const DEFER_BEFORE_START: Duration = Duration::from_millis(1500);
const FILE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_DIR_NAME: &str = "trace-player-thumbs";
// Bump when the baseline tile-count formula changes so old caches are
// re-derived with the new density.
const CACHE_VERSION: u32 = 3;
const CACHE_TTL_DAYS: u64 = 30;
const PROGRESSIVE_EMIT_EVERY: u32 = 10;

// Hybrid pipeline: target ~240 baseline tiles for any file longer than ~30
// minutes, scaling down to ~20 for short clips so we don't oversample a
// 30-second file. 240 keeps the worst-case "displayed-frame minus cursor"
// gap to ~duration/(2·240) — under 30 s for a 4-hour movie, vs. the prior
// ~1-minute gap at 150 tiles.
const BASELINE_TARGET: u32 = 240;
const BASELINE_MIN: u32 = 20;
const BASELINE_MIN_INTERVAL_S: f64 = 8.0;

#[derive(Serialize, Clone)]
pub struct ThumbnailReady {
    pub b64: String,
    pub count: u32,       // total tiles the sprite is sized for
    pub filled: u32,      // number of tiles actually rendered so far
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
    crate::np_info!("thumb", "start_thumbnail_job path={}", path);

    thread::spawn(move || {
        // Defer so the main player's first ~second of I/O is unimpeded.
        thread::sleep(DEFER_BEFORE_START);

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

        // Cache hit: emit the cached sprite as fully-filled and skip
        // extraction. The thumbnailer mpv still needs to load the file
        // (so dense-window requests can use it) — do that after emitting.
        if cache_path.exists() {
            if let Ok(bytes) = fs::read(&cache_path) {
                if let Some(meta) = read_cached_layout(&bytes) {
                    crate::np_info!(
                        "thumb",
                        "cache HIT key={} count={} cols={} rows={}",
                        key, meta.count, meta.cols, meta.rows
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
                    // Still load the file in the thumbnailer mpv so
                    // request_dense_window has something to seek on.
                    if let Ok(_g) = worker_lock().lock() {
                        let _ = thumb.load(&path);
                        let _ = wait_for_load(&thumb);
                    }
                    return;
                }
            }
        }

        crate::np_info!("thumb", "cache MISS key={}, extracting baseline", key);
        if let Err(e) = extract_baseline(&app, &thumb, &path, &cache_path) {
            crate::np_err!("thumb", "baseline extraction failed: {e}");
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
        t_center, radius, density
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
        let _ = fs::create_dir_all(&tmp_root);
        let tid = format!("{:?}", std::thread::current().id())
            .replace(['(', ')', ' ', '\"'], "");
        let tmp_tile = tmp_root.join(format!(
            "tile-{}-{}-dense.jpg",
            std::process::id(),
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
            emitted, skipped, cancelled, started.elapsed().as_millis()
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
        let _ = fs::create_dir_all(&tmp_root);
        let tid = format!("{:?}", std::thread::current().id())
            .replace(['(', ')', ' ', '\"'], "");
        let tmp_tile = tmp_root.join(format!(
            "tile-{}-{}-exact.jpg",
            std::process::id(),
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
                            t_clamped, started.elapsed().as_millis()
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

fn extract_baseline(
    app: &AppHandle,
    thumb: &Player,
    path: &str,
    cache_path: &PathBuf,
) -> Result<(), String> {
    // File load is exclusive — dense jobs must wait until mpv has the file
    // before they try to seek on it.
    {
        let _g = worker_lock()
            .lock()
            .map_err(|e| format!("worker lock poisoned: {e}"))?;
        thumb.load(path)?;
        wait_for_load(thumb)?;
    }

    let duration = thumb
        .get_property_f64("duration")
        .ok_or_else(|| "no duration".to_string())?;
    if !duration.is_finite() || duration <= 0.0 {
        return Err("invalid duration".to_string());
    }

    let count = adaptive_count(duration);
    let cols = COLS;
    let rows = count.div_ceil(cols);

    let mut sprite = RgbImage::new(cols * TILE_W, rows * TILE_H);

    let temp_root = std::env::temp_dir().join("trace-player-thumb-tmp");
    let _ = fs::create_dir_all(&temp_root);
    let tmp_tile = temp_root.join(format!("tile-{}-baseline.jpg", std::process::id()));
    // Baseline runs without a cancel token (the active dense job is what
    // gets cancelled, not vice versa) — pass a never-cancelled flag.
    let no_cancel = Arc::new(AtomicBool::new(false));

    for i in 0..count {
        // +0.5 centers the tile in its 1/count slice; avoids the cold-open
        // black frame at i=0 and the EOF tail at i=count-1.
        let t = ((i as f64 + 0.5) / count as f64) * duration;

        let tile = match extract_one_frame(thumb, t, &tmp_tile, &no_cancel) {
            Some(img) => img,
            None => continue,
        };

        let dx = (i % cols) * TILE_W;
        let dy = (i / cols) * TILE_H;
        let _ = sprite.copy_from(&tile, dx, dy);

        let filled = i + 1;
        let last = filled == count;
        if last || filled % PROGRESSIVE_EMIT_EVERY == 0 {
            if let Some(bytes) = encode_jpeg(&sprite, 75) {
                let b64 = general_purpose::STANDARD.encode(&bytes);
                let _ = app.emit(
                    "mpv:thumbnails-ready",
                    ThumbnailReady {
                        b64,
                        count,
                        filled,
                        cols,
                        rows,
                        tile_width: TILE_W,
                        tile_height: TILE_H,
                    },
                );

                // Persist on the final emit only — partial sprites aren't
                // worth caching.
                if last {
                    if let Some(parent) = cache_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let _ = fs::write(cache_path, &bytes);
                }
            }
        }
    }

    let _ = fs::remove_file(&tmp_tile);
    Ok(())
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
            MpvEvent::EndFile => return Err("thumbnailer end-of-file before load".to_string()),
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
            MpvEvent::Shutdown | MpvEvent::EndFile => return,
            _ => continue,
        }
    }
}

/// Hybrid baseline density: target ~150 tiles for normal-length files,
/// scale down for very short clips to avoid oversampling, floor at 20 so
/// the sprite is still useful for tiny files.
fn adaptive_count(duration_seconds: f64) -> u32 {
    let by_interval = (duration_seconds / BASELINE_MIN_INTERVAL_S).ceil() as u32;
    BASELINE_TARGET
        .min(by_interval.max(BASELINE_MIN))
        .max(1)
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
