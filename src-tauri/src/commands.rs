use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::archive;
use crate::perf::{self, PerfProfile, ResolvedPerf};
use crate::player::Player;
use crate::state::{AppState, PipGeometry};
use crate::streaming::{self, AddedTorrent, StreamingSession};
use crate::thumbnailer;

/// Simple in-memory cache for torrent metadata (Fix B26). Keyed by magnet URI;
/// avoids re-downloading metadata when the same magnet is resolved multiple
/// times (e.g. user opens library modal, cancels, re-opens).
static TORRENT_META_CACHE: std::sync::LazyLock<Mutex<HashMap<String, Vec<TorrentVideoInfo>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    pub font: String,
    pub size: i64,
    pub color: String,
    pub border_size: f64,
    pub border_color: String,
    pub shadow_offset: f64,
    pub margin_y: i64,
    pub bold: bool,
    pub align_y: String, // "top" | "center" | "bottom"
}

#[derive(Serialize, Clone)]
pub struct Track {
    pub id: i64,
    pub title: Option<String>,
    pub lang: Option<String>,
    pub codec: Option<String>,
    pub selected: bool,
}

#[derive(Serialize, Clone)]
pub struct TrackList {
    pub audio: Vec<Track>,
    pub subtitle: Vec<Track>,
}

/// Parse mpv's `track-list` JSON into split audio/subtitle vectors.
pub fn parse_track_list(json: &str) -> TrackList {
    let mut audio = Vec::new();
    let mut subtitle = Vec::new();

    let parsed: Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return TrackList { audio, subtitle },
    };

    let arr = match parsed.as_array() {
        Some(a) => a,
        None => return TrackList { audio, subtitle },
    };

    for entry in arr.iter().take(512) {
        let kind = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if kind != "audio" && kind != "sub" {
            continue;
        }
        let id = entry.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let title = entry
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let lang = entry
            .get("lang")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let codec = entry
            .get("codec")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let selected = entry
            .get("selected")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let track = Track {
            id,
            title,
            lang,
            codec,
            selected,
        };
        if kind == "audio" {
            audio.push(track);
        } else {
            subtitle.push(track);
        }
    }

    TrackList { audio, subtitle }
}

fn player_ref<'a>(state: &'a State<'_, AppState>) -> Result<&'a Player, String> {
    state
        .player
        .as_ref()
        .map(|arc| arc.as_ref())
        .ok_or_else(|| "Player not initialized".to_string())
}

#[tauri::command]
pub fn load_file(path: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::np_info!("cmd", "load_file path={}", path);
    // Local file replaces whatever was playing — stop previous torrents so
    // they don't keep downloading in the background, and drop any open
    // archive's bookkeeping so its cache_dir can be reclaimed.
    drop_previous_sources(state.inner());
    player_ref(&state)?.load(&path)
}

#[tauri::command]
pub fn play(state: State<'_, AppState>) -> Result<(), String> {
    crate::np_info!("cmd", "play");
    player_ref(&state)?.play()
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> Result<(), String> {
    crate::np_info!("cmd", "pause");
    player_ref(&state)?.pause()
}

#[tauri::command]
pub fn seek(seconds: f64, mode: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::np_debug!("cmd", "seek seconds={:.3} mode={}", seconds, mode);
    let player = player_ref(&state)?;

    // For active torrent streams: pre-announce the seek position so rqbit
    // can reprioritize piece downloads before mpv's own range request lands.
    // We calculate the target byte offset from (seek_time / duration) * file_size
    // and send a tiny Range GET to rqbit's streaming endpoint. rqbit elevates
    // pieces covering that range; without this it continues sequential
    // download from wherever it was, causing multi-minute stalls on far seeks.
    let active_item = state.active_torrent.lock().ok().and_then(|g| g.clone());
    if let Some(ref active) = active_item {
        let duration = player.get_property_f64("duration").unwrap_or(0.0);
        let current_pos = player.get_property_f64("time-pos").unwrap_or(0.0);
        // Resolve absolute target time from whatever seek mode the caller used.
        let target_secs = match mode.as_str() {
            "relative" => (current_pos + seconds).max(0.0),
            "absolute-percent" => seconds.clamp(0.0, 100.0) / 100.0 * duration,
            _ => seconds.max(0.0),
        };
        if duration > 1.0 {
            // Look up the stream URL + file size for the currently-playing file.
            let file_info = state.torrent_video_files.lock().ok().and_then(|files| {
                files
                    .iter()
                    .find(|(idx, _, _)| *idx == active.file_idx)
                    .map(|(_, url, size)| (url.clone(), *size))
            });
            if let Some((stream_url, file_size)) = file_info {
                if file_size > 0 {
                    // 4 MiB window starting at the seek byte offset. Large
                    // enough that rqbit downloads a meaningful head-start chunk
                    // (typically a few seconds of 1080p H.264).
                    let byte_start = ((target_secs / duration) * file_size as f64) as u64;
                    let byte_end = (byte_start + 4_194_304).min(file_size - 1);
                    crate::np_debug!(
                        "rqbit",
                        "seek prefetch bytes={byte_start}-{byte_end} target={target_secs:.2}s"
                    );
                    std::thread::spawn(move || {
                        let http = ureq::AgentBuilder::new()
                            .timeout_connect(std::time::Duration::from_secs(3))
                            .timeout_read(std::time::Duration::from_secs(5))
                            .build();
                        let range = format!("bytes={byte_start}-{byte_end}");
                        let _ = http.get(&stream_url).set("Range", &range).call();
                    });
                }
            }
        }
    }

    player.seek(seconds, &mode)
}

/// Track the user's intended volume. When AGC is off, push it to mpv directly.
/// When AGC is on, the AGC tick reads `user_volume` and applies the combined
/// (user × AGC-correction) value on its next loop.
#[tauri::command]
pub fn set_volume(volume: f64, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut params = state.agc.params.lock().unwrap_or_else(|e| {
            eprintln!("[cmd] agc params lock poisoned in set_volume, recovering");
            e.into_inner()
        });
        params.user_volume = volume;
    }
    if !state.agc.enabled.load(Ordering::Relaxed) {
        player_ref(&state)?.set_volume(volume)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_mute(muted: bool, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_mute(muted)
}

#[tauri::command]
pub fn set_speed(speed: f64, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_speed(speed)
}

#[tauri::command]
pub fn set_audio_track(track_id: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_audio_track(&track_id)
}

#[tauri::command]
pub fn set_subtitle_track(track_id: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_sub_track(&track_id)
}

#[tauri::command]
pub fn get_tracks(state: State<'_, AppState>) -> Result<TrackList, String> {
    let p = player_ref(&state)?;
    let json = p
        .get_property_string("track-list")
        .unwrap_or_else(|| "[]".to_string());
    Ok(parse_track_list(&json))
}

/// Combined audio-filter state. Mono is a real filter (`pan`). Dynamic Audio
/// is NOT a filter — it's an automatic gain controller that nudges mpv's
/// `volume` property based on the source's measured RMS. The only filter we
/// add for AGC is a labeled `astats`, which the AGC poll thread reads.
///
/// `min_db` / `max_db` define the target band: when the source RMS goes below
/// `min_db`, AGC boosts; when it exceeds `max_db`, AGC cuts.
#[tauri::command]
pub fn set_audio_filters(
    mono: bool,
    dynamic_enabled: bool,
    min_db: f64,
    max_db: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut filters: Vec<String> = Vec::new();
    if mono {
        // Wrap in lavfi[] — pan's `|` is otherwise eaten by mpv's filter
        // chain parser as a (legacy) graph-alternative separator and the
        // whole `af` write fails with PROPERTY_FORMAT.
        filters.push("lavfi=[pan=mono|c0=0.5*c0+0.5*c1]".to_string());
    }
    if dynamic_enabled {
        // Labeled so the AGC thread can read its metadata via
        // `af-metadata/agcstats/...`. length=0.04 → ~40 ms windows for fast
        // tracking of sudden peaks (shouts, explosions).
        filters.push("lavfi=[astats=metadata=1:reset=1:length=0.04]@agcstats".to_string());
    }
    let chain = filters.join(",");
    player_ref(&state)?.set_audio_filter(&chain)?;

    // Update AGC controller. Reset the smoothed gain whenever AGC turns off so
    // the next enable starts from unity.
    let user_vol = {
        let mut params = state
            .agc
            .params
            .lock()
            .map_err(|e| format!("agc lock: {e}"))?;
        params.min_db = min_db;
        params.max_db = max_db;
        if !dynamic_enabled {
            params.agc_gain_db = 0.0;
        }
        params.user_volume
    };
    state.agc.enabled.store(dynamic_enabled, Ordering::Relaxed);

    // When AGC turns off, restore mpv volume to the user's slider position
    // (it may currently sit at a boosted/cut value from the last AGC tick).
    if !dynamic_enabled {
        player_ref(&state)?.set_volume(user_vol)?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_subtitle_style(style: SubtitleStyle, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_subtitle_style(
        &style.font,
        style.size,
        &style.color,
        style.border_size,
        &style.border_color,
        style.shadow_offset,
        style.margin_y,
        style.bold,
        &style.align_y,
    )
}

#[tauri::command]
pub fn set_subtitle_delay(delay_ms: f64, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_subtitle_delay(delay_ms / 1000.0)
}

/// Kick off background thumbnail extraction for the given file. Returns
/// immediately. The thumbnailer thread emits `mpv:thumbnails-ready` events
/// progressively as tiles fill in.
#[tauri::command]
pub fn start_thumbnailing(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let thumb = state
        .thumbnailer
        .as_ref()
        .ok_or_else(|| "Thumbnailer not initialized".to_string())?
        .clone();
    thumbnailer::start_thumbnail_job(app, thumb, path);
    Ok(())
}

/// Hover-driven dense thumbnail window: render `density` extra tiles in
/// `[t-radius, t+radius]` and emit them as individual `mpv:thumbnail-tile`
/// events. A new request cancels the previous in-flight job.
#[tauri::command]
pub fn request_thumb_window(
    t: f64,
    radius: f64,
    density: u32,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let thumb = state
        .thumbnailer
        .as_ref()
        .ok_or_else(|| "Thumbnailer not initialized".to_string())?
        .clone();
    thumbnailer::request_dense_window(app, thumb, t, radius, density);
    Ok(())
}

/// Render exactly one frame at the requested time. Used by the timeline
/// hover after the cursor has been still for ~120 ms — gives a pixel-
/// precise preview of what's at that point in the file. Each call cancels
/// the prior exact-frame job.
#[tauri::command]
pub fn request_thumb_exact(
    t: f64,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let thumb = state
        .thumbnailer
        .as_ref()
        .ok_or_else(|| "Thumbnailer not initialized".to_string())?
        .clone();
    thumbnailer::request_exact_frame(app, thumb, t);
    Ok(())
}

// ── Phase 5e: Image Adjustments ─────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageParams {
    pub brightness: i64,
    pub contrast: i64,
    pub saturation: i64,
    pub gamma: i64,
    pub hue: i64,
}

#[tauri::command]
pub fn set_image_params(params: ImageParams, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    p.set_int_prop("brightness", params.brightness)?;
    p.set_int_prop("contrast", params.contrast)?;
    p.set_int_prop("saturation", params.saturation)?;
    p.set_int_prop("gamma", params.gamma)?;
    p.set_int_prop("hue", params.hue)?;
    Ok(())
}

// ── Phase 5b-mini: Aspect / Zoom / Rotate ───────────────────────────────────

/// `ratio` is one of: "auto" | "16:9" | "4:3" | "21:9" | "fill".
/// "fill" uses panscan=1 to crop letterboxes; everything else clears panscan.
#[tauri::command]
pub fn set_aspect(ratio: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    match ratio.as_str() {
        "auto" => {
            p.set_string_prop_pub("video-aspect-override", "-1")?;
            p.set_double_prop("panscan", 0.0)
        }
        "16:9" | "4:3" | "21:9" => {
            p.set_string_prop_pub("video-aspect-override", &ratio)?;
            p.set_double_prop("panscan", 0.0)
        }
        "fill" => {
            p.set_string_prop_pub("video-aspect-override", "-1")?;
            p.set_double_prop("panscan", 1.0)
        }
        _ => Err(format!("unknown aspect: {ratio}")),
    }
}

#[tauri::command]
pub fn set_zoom(zoom: f64, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_double_prop("video-zoom", zoom)
}

#[tauri::command]
pub fn set_rotate(degrees: i64, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_int_prop("video-rotate", degrees)
}

// ── Phase 5d-mini: Screenshot + A-B loop ────────────────────────────────────

#[tauri::command]
pub fn take_screenshot(state: State<'_, AppState>) -> Result<(), String> {
    // "video" = capture just the video frame, no OSD/subs. mpv writes to
    // the default screenshot-directory (Pictures on Windows).
    player_ref(&state)?.command(&["screenshot", "video"])
}

#[tauri::command]
pub fn set_ab_loop_a(seconds: Option<f64>, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    match seconds {
        Some(s) => p.set_string_prop_pub("ab-loop-a", &format!("{s}")),
        None => p.set_string_prop_pub("ab-loop-a", "no"),
    }
}

#[tauri::command]
pub fn set_ab_loop_b(seconds: Option<f64>, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    match seconds {
        Some(s) => p.set_string_prop_pub("ab-loop-b", &format!("{s}")),
        None => p.set_string_prop_pub("ab-loop-b", "no"),
    }
}

#[derive(Serialize)]
pub struct AbLoopState {
    pub a: Option<f64>,
    pub b: Option<f64>,
}

/// Cycle the A-B loop using mpv's built-in `ab-loop` command. mpv handles
/// the state machine: 1st call sets A, 2nd sets B, 3rd clears both. This
/// avoids the bug where setting A then B as separate property writes left
/// mpv in an inconsistent state. The current state is read back so the UI
/// can highlight the loop button correctly.
#[tauri::command]
pub fn ab_loop_cycle(state: State<'_, AppState>) -> Result<AbLoopState, String> {
    let p = player_ref(&state)?;
    p.command(&["ab-loop"])?;
    let parse = |s: Option<String>| -> Option<f64> {
        s.and_then(|v| if v == "no" { None } else { v.parse().ok() })
    };
    Ok(AbLoopState {
        a: parse(p.get_string_prop_pub("ab-loop-a")),
        b: parse(p.get_string_prop_pub("ab-loop-b")),
    })
}

#[tauri::command]
pub fn ab_loop_clear(state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    let _ = p.set_string_prop_pub("ab-loop-a", "no");
    let _ = p.set_string_prop_pub("ab-loop-b", "no");
    Ok(())
}

// ── Phase 5c: Audio FX (supersedes set_audio_filters) ────────────────────────

/// Combined audio state. Mono = pan filter. AGC = labeled astats + the AGC
/// thread. Normalize = single-pass loudnorm (-16 LUFS target). Night Mode =
/// acompressor with cinema-friendly defaults. Pitch correction = mpv's
/// audio-pitch-correction property. Audio delay = audio-delay property
/// (NOT a filter — needs exact ms placement against the video clock).
/// 10-band ISO frequencies for the EQ. Must match `EQ_BAND_FREQS` in types.ts.
const EQ_BAND_FREQS: [u32; 10] = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/// Build a `firequalizer` lavfi filter from 10 gain values (dB). Returns None
/// when all bands are flat — caller skips inserting the filter entirely so a
/// disabled EQ has zero CPU cost.
fn build_eq_filter(bands: &[f64; 10]) -> Option<String> {
    if bands.iter().all(|b| b.abs() < 0.05) {
        return None;
    }
    let entries: Vec<String> = EQ_BAND_FREQS
        .iter()
        .zip(bands.iter())
        .map(|(f, g)| format!("entry({f},{g:.2})"))
        .collect();
    Some(format!(
        "lavfi=[firequalizer=gain_entry='{}':zero_phase=on]",
        entries.join(";")
    ))
}

#[tauri::command]
pub fn set_audio_fx(
    mono: bool,
    dynamic_enabled: bool,
    min_db: f64,
    max_db: f64,
    normalize: bool,
    night_mode: bool,
    pitch_correction: bool,
    audio_delay_ms: f64,
    eq_enabled: bool,
    eq_bands: Vec<f64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let p = player_ref(&state)?;

    let mut filters: Vec<String> = Vec::new();
    if mono {
        // Wrap in lavfi[] — pan's `|` is otherwise eaten by mpv's filter
        // chain parser as a (legacy) graph-alternative separator and the
        // whole `af` write fails with PROPERTY_FORMAT.
        filters.push("lavfi=[pan=mono|c0=0.5*c0+0.5*c1]".to_string());
    }
    if normalize {
        filters.push("lavfi=[loudnorm=I=-16:LRA=11:TP=-1.5]".to_string());
    }
    if night_mode {
        filters.push(
            "lavfi=[acompressor=threshold=0.089:ratio=4:attack=5:release=50:makeup=2]".to_string(),
        );
    }
    // Insert EQ after compression so it shapes the post-compressed signal.
    if eq_enabled {
        if eq_bands.len() != 10 {
            eprintln!(
                "[cmd] set_audio_fx: expected 10 eq_bands, got {}",
                eq_bands.len()
            );
        }
        if eq_bands.len() == 10 {
            let mut bands = [0.0f64; 10];
            for (i, b) in eq_bands.iter().take(10).enumerate() {
                bands[i] = b.clamp(-12.0, 12.0);
            }
            if let Some(eq) = build_eq_filter(&bands) {
                filters.push(eq);
            }
        }
    }
    if dynamic_enabled {
        filters.push("lavfi=[astats=metadata=1:reset=1:length=0.04]@agcstats".to_string());
    }
    let chain = filters.join(",");
    p.set_audio_filter(&chain)?;

    // AGC controller bookkeeping (same logic as the old set_audio_filters).
    let user_vol = {
        let mut params = state
            .agc
            .params
            .lock()
            .map_err(|e| format!("agc lock: {e}"))?;
        params.min_db = min_db;
        params.max_db = max_db;
        if !dynamic_enabled {
            params.agc_gain_db = 0.0;
        }
        params.user_volume
    };
    state.agc.enabled.store(dynamic_enabled, Ordering::Relaxed);
    if !dynamic_enabled {
        p.set_volume(user_vol)?;
    }

    // Pitch correction + audio delay are properties, not filters.
    p.set_string_prop_pub(
        "audio-pitch-correction",
        if pitch_correction { "yes" } else { "no" },
    )?;
    p.set_double_prop("audio-delay", audio_delay_ms / 1000.0)?;

    Ok(())
}

// ── Phase 5b/5d: HDR / Upscaling / Interp / VSync (manual overrides) ─────────

#[tauri::command]
pub fn set_hdr_mode(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    perf::apply_hdr(p, &mode)
}

#[tauri::command]
pub fn set_upscaling(profile: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    let dir = state.perf.shader_dir_clone();
    perf::apply_upscaling(p, &profile, dir.as_ref())
}

#[tauri::command]
pub fn set_interpolation(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    perf::apply_interpolation(p, &mode)
}

#[tauri::command]
pub fn set_vsync(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    perf::apply_vsync(p, enabled)
}

/// Windows-only: enter D3D11 exclusive fullscreen on F11 / F-toggle. Bypasses
/// DWM so V-Sync isn't gated by the compositor's own refresh cadence (which
/// otherwise produces ~1-frame judder on high-refresh displays). On non-Win
/// builds this is a no-op write that mpv quietly drops.
///
/// mpv reads this on entering fullscreen, so toggling at runtime takes effect
/// the next time the user goes fullscreen — no restart needed. We also write
/// it as an init option so the very first fullscreen of the session honors
/// the user's saved preference.
#[tauri::command]
pub fn set_exclusive_fullscreen(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    // d3d11-exclusive-fs is gpu-next-aware but only meaningful when
    // gpu-context=d3d11 (which we force on Windows). Use the optional
    // path so non-Windows / non-d3d11 builds don't error.
    let _ = p.set_string_prop_pub("d3d11-exclusive-fs", if enabled { "yes" } else { "no" });
    Ok(())
}

// ── Phase 5f: Performance Profile (the umbrella) ─────────────────────────────

/// Apply a performance profile. When profile == "custom", returns null —
/// the user is hand-tuning individual knobs and we don't override. When
/// profile == "auto", returns the resolved profile (battery_saver or
/// balanced) so the frontend can mirror it into HDR/Upscaling/Interp state.
#[tauri::command]
pub fn set_perf_profile(
    profile: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolvedPerf>, String> {
    let pp = PerfProfile::from_str(&profile)
        .ok_or_else(|| format!("unknown perf profile: {profile}"))?;
    state.perf.set_profile(pp.as_str());
    let on_battery = state.perf.is_on_battery();
    let resolved = perf::resolve(pp, on_battery);
    if let Some(ref r) = resolved {
        let p = player_ref(&state)?;
        let dir = state.perf.shader_dir_clone();
        perf::apply(p, r, dir.as_ref())?;
    }
    Ok(resolved)
}

// ── Phase 5d: chapter navigation ────────────────────────────────────────────

#[tauri::command]
pub fn chapter_seek(delta: i64, state: State<'_, AppState>) -> Result<(), String> {
    let s = format!("{delta}");
    player_ref(&state)?.command(&["add", "chapter", &s])
}

// ── Files: screenshot directory ─────────────────────────────────────────────

#[tauri::command]
pub fn set_screenshot_dir(path: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_string_prop_pub("screenshot-directory", &path)
}

// ── Phase 6: loop + playlist ────────────────────────────────────────────────

/// Loop the current file. mpv's `loop-file` accepts "inf"/"no"/integer count.
#[tauri::command]
pub fn set_loop_file(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_string_prop_pub("loop-file", if enabled { "inf" } else { "no" })
}

/// Loop the entire playlist. Independent from loop-file — both can be on.
#[tauri::command]
pub fn set_loop_playlist(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_string_prop_pub("loop-playlist", if enabled { "inf" } else { "no" })
}

/// One-shot playlist shuffle (no toggle — mpv mutates the list in place).
/// Frontend tracks the "shuffled" boolean separately for UI display.
#[tauri::command]
pub fn playlist_shuffle(state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.command(&["playlist-shuffle"])
}

#[tauri::command]
pub fn playlist_unshuffle(state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.command(&["playlist-unshuffle"])
}

/// Append a single file. Use `playlist_add_many` for batches — it avoids the
/// per-call overhead of a JS round-trip per file.
#[tauri::command]
pub fn playlist_add(path: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.command(&["loadfile", &path, "append-play"])
}

#[tauri::command]
pub fn playlist_add_many(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    for path in paths {
        p.command(&["loadfile", &path, "append-play"])?;
    }
    Ok(())
}

#[tauri::command]
pub fn playlist_remove(idx: u32, state: State<'_, AppState>) -> Result<(), String> {
    let s = idx.to_string();
    player_ref(&state)?.command(&["playlist-remove", &s])
}

#[tauri::command]
pub fn playlist_play_index(idx: u32, state: State<'_, AppState>) -> Result<(), String> {
    let s = idx.to_string();
    player_ref(&state)?.command(&["playlist-play-index", &s])
}

#[tauri::command]
pub fn playlist_clear(state: State<'_, AppState>) -> Result<(), String> {
    // Clearing the playlist invalidates every torrent stream URL we'd
    // queued; tell rqbit to forget them so they stop downloading.
    drop_previous_sources(state.inner());
    player_ref(&state)?.command(&["playlist-clear"])
}

#[tauri::command]
pub fn playlist_next(state: State<'_, AppState>) -> Result<(), String> {
    // weak: don't loop back to start when at end (we own loop-playlist
    // separately so the user setting decides).
    player_ref(&state)?.command(&["playlist-next", "weak"])
}

#[tauri::command]
pub fn playlist_prev(state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.command(&["playlist-prev", "weak"])
}

#[tauri::command]
pub fn playlist_move(from: u32, to: u32, state: State<'_, AppState>) -> Result<(), String> {
    let f = from.to_string();
    let t = to.to_string();
    player_ref(&state)?.command(&["playlist-move", &f, &t])
}

#[derive(Serialize, Clone)]
pub struct PlaylistItem {
    pub index: u32,
    pub filename: String,
    pub title: Option<String>,
    pub current: bool,
}

/// Snapshot of mpv's playlist property. Used both as a Tauri command
/// (frontend-pulled refresh) and by the events module (push on change).
pub fn read_playlist(p: &Player) -> Vec<PlaylistItem> {
    let json = match p.get_string_prop_pub("playlist") {
        Some(s) => s,
        None => return Vec::new(),
    };
    let arr: Vec<Value> = serde_json::from_str::<Value>(&json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    arr.into_iter()
        .enumerate()
        .map(|(i, item)| PlaylistItem {
            index: i as u32,
            filename: item
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            title: item
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            current: item
                .get("current")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        })
        .collect()
}

#[tauri::command]
pub fn get_playlist(state: State<'_, AppState>) -> Result<Vec<PlaylistItem>, String> {
    let p = player_ref(&state)?;
    Ok(read_playlist(p))
}

/// Snapshot of every piece of mpv state the React UI mirrors. Called by
/// the frontend on mount so a Ctrl+R / WebView refresh can rehydrate
/// hasFile / isPlaying / time-pos / duration / playlist / tracks etc.
/// without the user having to reopen the file.
///
/// User-config (image params, audio FX, etc.) is persisted via tauri-
/// plugin-store on the frontend and rehydrates from there — those values
/// don't need to be in this payload. This is purely for transient state
/// that mpv owns and React would otherwise default-initialize wrong.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub path: String,
    pub paused: bool,
    pub time_pos: f64,
    pub duration: f64,
    pub volume: f64,
    pub speed: f64,
    pub playlist_pos: i64,
    pub playlist: Vec<PlaylistItem>,
    pub tracks: TrackList,
}

#[tauri::command]
pub fn get_player_state(state: State<'_, AppState>) -> Result<PlayerState, String> {
    let p = player_ref(&state)?;
    let path = p.get_string_prop_pub("path").unwrap_or_default();
    let paused = p.get_property_flag("pause").unwrap_or(true);
    let time_pos = p.get_property_f64("time-pos").unwrap_or(0.0);
    let duration = p.get_property_f64("duration").unwrap_or(0.0);
    let volume = p.get_property_f64("volume").unwrap_or(80.0);
    let speed = p.get_property_f64("speed").unwrap_or(1.0);
    let playlist_pos = p.get_int_prop("playlist-pos").unwrap_or(-1);
    let playlist = read_playlist(p);
    let tracks_json = p
        .get_property_string("track-list")
        .unwrap_or_else(|| "[]".to_string());
    let tracks = parse_track_list(&tracks_json);
    Ok(PlayerState {
        path,
        paused,
        time_pos,
        duration,
        volume,
        speed,
        playlist_pos,
        playlist,
        tracks,
    })
}

// ── External subtitle ────────────────────────────────────────────────────────

#[tauri::command]
pub fn load_subtitle(path: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.command(&["sub-add", &path, "select"])
}

// ── Frame step ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn frame_step(backward: bool, state: State<'_, AppState>) -> Result<(), String> {
    if backward {
        player_ref(&state)?.command(&["frame-back-step"])
    } else {
        player_ref(&state)?.command(&["frame-step"])
    }
}

// ── Video recovery ──────────────────────────────────────────────────────────
//
// Manual recovery for the rare state where time-pos advances and audio plays
// but the video pane is blank — symptom of a d3d11 swapchain or VO surface
// that's gotten out of sync after many pauses/seeks. `seek 0 exact` flushes
// the decoder and forces mpv to decode + present a fresh frame, which
// usually re-engages the swapchain. Bound to V on the frontend.
#[tauri::command]
pub fn force_redraw(state: State<'_, AppState>) -> Result<(), String> {
    crate::np_info!("cmd", "force_redraw");
    let p = player_ref(&state)?;
    if let Err(e) = p.command(&["seek", "0", "exact"]) {
        eprintln!("[cmd] force_redraw seek failed (ok): {e}");
    }
    Ok(())
}

// ── Deinterlace ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_deinterlace(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_string_prop_pub("deinterlace", if enabled { "yes" } else { "no" })
}

// ── Audio output device ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AudioDevice {
    pub name: String,
    pub description: String,
}

#[tauri::command]
pub fn get_audio_devices(state: State<'_, AppState>) -> Result<Vec<AudioDevice>, String> {
    let p = player_ref(&state)?;
    let json = p
        .get_string_prop_pub("audio-device-list")
        .unwrap_or_else(|| "[]".to_string());
    let arr: Vec<Value> = serde_json::from_str::<Value>(&json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    Ok(arr
        .into_iter()
        .map(|item| AudioDevice {
            name: item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("auto")
                .to_string(),
            description: item
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect())
}

#[tauri::command]
pub fn set_audio_device(name: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_string_prop_pub("audio-device", &name)
}

// ── Media info ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct MediaInfo {
    pub filename: String,
    pub path: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub container: String,
    pub video_w: Option<i64>,
    pub video_h: Option<i64>,
    pub video_fps: Option<f64>,
    pub video_bitrate: Option<i64>,
    pub audio_bitrate: Option<i64>,
    pub audio_channels: String,
    pub audio_sample_rate: Option<i64>,
    pub file_size: Option<i64>,
    pub duration: Option<f64>,
}

#[tauri::command]
pub fn get_media_info(state: State<'_, AppState>) -> Result<MediaInfo, String> {
    let p = player_ref(&state)?;
    let s = |name: &str| p.get_string_prop_pub(name).unwrap_or_default();
    Ok(MediaInfo {
        filename: s("media-title"),
        path: s("path"),
        video_codec: s("video-codec"),
        audio_codec: s("audio-codec"),
        container: s("file-format"),
        video_w: p.get_int_prop("video-params/w"),
        video_h: p.get_int_prop("video-params/h"),
        video_fps: p.get_property_f64("container-fps"),
        video_bitrate: p.get_int_prop("video-bitrate"),
        audio_bitrate: p.get_int_prop("audio-bitrate"),
        audio_channels: s("audio-params/channels"),
        audio_sample_rate: p.get_int_prop("audio-params/samplerate"),
        file_size: p.get_int_prop("file-size"),
        duration: p.get_property_f64("duration"),
    })
}

// ── Diagnostics: pipeline info ──────────────────────────────────────────────

/// Snapshot of the live mpv rendering pipeline. The frontend uses this to
/// show "VO: gpu-next | Active scaler: ewa_lanczossharp | Shaders: 2 loaded"
/// so the user can see whether HDR / Upscaling / shader-bundle features are
/// actually in effect.
#[derive(Serialize)]
pub struct PipelineInfo {
    pub vo: String,
    pub gpu_context: String,
    pub gpu_api: String,
    pub hwdec: String,
    pub scale: String,
    pub cscale: String,
    pub glsl_shader_count: usize,
    pub video_w: Option<i64>,
    pub video_h: Option<i64>,
    pub video_fps: Option<f64>,
    pub colorspace: String,
    pub gamma: String,
    pub primaries: String,
    pub interpolation: bool,
    pub video_sync: String,
    pub target_colorspace_hint: String,
}

#[tauri::command]
pub fn get_pipeline_info(state: State<'_, AppState>) -> Result<PipelineInfo, String> {
    let p = player_ref(&state)?;
    let s = |name: &str| p.get_string_prop_pub(name).unwrap_or_default();
    let glsl = s("glsl-shaders");
    let glsl_count = if glsl.is_empty() {
        0
    } else {
        glsl.split(';').filter(|s| !s.is_empty()).count()
    };
    Ok(PipelineInfo {
        vo: s("current-vo"),
        gpu_context: s("gpu-context"),
        gpu_api: s("gpu-api"),
        hwdec: s("hwdec-current"),
        scale: s("scale"),
        cscale: s("cscale"),
        glsl_shader_count: glsl_count,
        video_w: p.get_int_prop("video-params/w"),
        video_h: p.get_int_prop("video-params/h"),
        video_fps: p.get_property_f64("container-fps"),
        colorspace: s("video-params/colormatrix"),
        gamma: s("video-params/gamma"),
        primaries: s("video-params/primaries"),
        interpolation: p.get_property_flag("interpolation").unwrap_or(false),
        video_sync: s("video-sync"),
        target_colorspace_hint: s("target-colorspace-hint"),
    })
}

// ── Network sources: HTTP / RTSP / magnet / .torrent ────────────────────────

/// Open a network source. Detects scheme:
///   - magnet:                → spawn rqbit (lazy), POST magnet, mpv loadfile
///                              the http://127.0.0.1:<port>/torrents/.../stream/<idx> URL
///   - <path>.torrent         → read bytes, same as above
///   - http(s)/rtsp/rtmp/mms  → mpv loadfile the URL directly
/// `append=true` queues into the playlist; `false` replaces the current file.
// Async because the body can block for up to 120 s waiting on rqbit's
// initial-checksum phase (`set_only_files` retry loop). Tauri runs SYNC
// commands on the main thread, so a sync version of this would freeze the
// window with Windows' "Not Responding" dialog. Async commands run on the
// tokio runtime, leaving the Win32 message pump free to deliver paints
// and keep the loading overlay alive while we wait.
#[tauri::command]
pub async fn open_source(
    url: String,
    append: bool,
    file_index: Option<usize>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    crate::np_info!("cmd", "open_source url={} append={} file_index={:?}", url, append, file_index);
    let p = player_ref(&state)?;
    let mode = if append { "append-play" } else { "replace" };

    // NOTE: drop_previous_sources is intentionally deferred to the point where
    // we KNOW the new source is ready to play (just before loadfile). Dropping
    // eagerly would kill the currently-playing torrent stream if the new source
    // then fails to connect — leaving the user with nothing.

    let lower = url.to_ascii_lowercase();

    // Magnet
    if lower.starts_with("magnet:") {
        let _ = app.emit(
            "mpv:source-loading",
            SourceLoadingPayload {
                phase: "connect".into(),
                label: "Connecting to torrent…".into(),
                progress: None,
            },
        );
        let added = match ensure_streaming(&state, &app)?.add_magnet(&url) {
            Ok(a) => a,
            Err(e) => {
                let _ = app.emit("mpv:source-loading-done", ());
                return Err(e);
            }
        };
        if let Some(idx) = file_index {
            let video = added
                .videos
                .iter()
                .find(|v| v.idx == idx)
                .ok_or_else(|| format!("file index {} not found in torrent", idx))?;
            let single = AddedTorrent {
                id: added.id,
                info_hash: added.info_hash.clone(),
                name: added.name.clone(),
                videos: vec![video.clone()],
            };
            return load_torrent_into_playlist(&state, p, single, mode, &app);
        }
        return load_torrent_into_playlist(&state, p, added, mode, &app);
    }

    // .torrent file path
    if lower.ends_with(".torrent") && std::path::Path::new(&url).is_file() {
        let _ = app.emit(
            "mpv:source-loading",
            SourceLoadingPayload {
                phase: "connect".into(),
                label: "Connecting to torrent…".into(),
                progress: None,
            },
        );
        let bytes = std::fs::read(&url).map_err(|e| format!("read .torrent: {e}"))?;
        let added = match ensure_streaming(&state, &app)?.add_torrent_bytes(&bytes) {
            Ok(a) => a,
            Err(e) => {
                let _ = app.emit("mpv:source-loading-done", ());
                return Err(e);
            }
        };
        return load_torrent_into_playlist(&state, p, added, mode, &app);
    }

    // Direct streams — drop old sources immediately before handing the URL to
    // mpv, which replaces playback in the same command. The drop is safe here
    // because there's no async gap between drop and loadfile.
    let direct = [
        "http://", "https://", "rtsp://", "rtmp://", "rtmps://", "mms://", "file://",
    ]
    .iter()
    .any(|s| lower.starts_with(s));
    if direct {
        if !append {
            drop_previous_sources(state.inner());
        }
        return p.command(&["loadfile", &url, mode]);
    }

    Err(format!(
        "unsupported source: {url} — expected http(s)/rtsp/rtmp/mms URL, magnet:, or .torrent path"
    ))
}

/// Hand a fresh `AddedTorrent` to mpv as N playlist items. Blocks on
/// `set_only_files` for the first file until rqbit is past its
/// initial-checksum phase, then queues every video URL as a playlist entry.
/// The first item respects the caller's `mode` (replace vs append-play);
/// subsequent items are always append-play so we don't blow away the
/// freshly-loaded first item.
///
/// CRITICAL: we BLOCK on `set_only_files` here. rqbit returns 500 for
/// /update_only_files AND /stream/{idx} during its initial-checksum phase.
/// set_only_files retries internally on 500, so its success is the
/// "rqbit is now serving" gate before we issue loadfile.
fn load_torrent_into_playlist(
    state: &State<'_, AppState>,
    p: &Player,
    added: AddedTorrent,
    mode: &str,
    app: &AppHandle,
) -> Result<(), String> {
    if added.videos.is_empty() {
        let _ = app.emit("mpv:source-loading-done", ());
        return Err("torrent contained no playable video files".to_string());
    }
    crate::np_info!(
        "cmd",
        "torrent {} added: {} videos, queuing as playlist",
        added.id,
        added.videos.len()
    );

    // Temporarily put the new torrent in active_torrent (NOT torrent_ids yet)
    // so the stats poller can emit live speed/peers to the overlay during the
    // validation wait. We deliberately do NOT insert into torrent_ids here so
    // that if we later need to drop_previous_sources, forget_all_torrents
    // won't accidentally kill the torrent we just added.
    if let Ok(mut g) = state.active_torrent.lock() {
        *g = Some(crate::state::ActiveTorrentItem {
            torrent_id: added.id,
            file_idx: added.videos[0].idx,
            prev_idx: None,
        });
    }

    let _ = app.emit(
        "mpv:source-loading",
        SourceLoadingPayload {
            phase: "connect".into(),
            label: "Validating torrent pieces…".into(),
            progress: None,
        },
    );

    // Block until rqbit is past its initial-checksum phase. Returns Err after
    // 120 s — long enough for even multi-GB torrents. The caller must NOT have
    // called loadfile yet; if we bail here, the previous source is unaffected.
    // The SessionHandle performs HTTP without holding the streaming mutex.
    let first_idx = added.videos[0].idx;
    let handle = ensure_streaming(state, app)?;
    if let Err(e) = handle.set_only_files(added.id, &[first_idx]) {
        crate::np_err!("rqbit", "set_only_files initial failed: {e}");
        let _ = app.emit("mpv:source-loading-done", ());
        // Clear the temporary active_torrent pointer we set above.
        if let Ok(mut g) = state.active_torrent.lock() {
            *g = None;
        }
        // Forget the new torrent from rqbit so it stops consuming bandwidth.
        let _ = handle.forget(added.id);
        return Err(e);
    }

    let _ = app.emit(
        "mpv:source-loading",
        SourceLoadingPayload {
            phase: "buffer".into(),
            label: "Buffering video…".into(),
            progress: None,
        },
    );

    // New source is validated and ready to play. NOW it is safe to drop the
    // previous source: forget_all_torrents reads torrent_ids, which does NOT
    // yet contain added.id, so the old torrent(s) are forgotten but the new
    // one is untouched. archive_registry / active_archive_path are also reset.
    if mode == "replace" {
        drop_previous_sources(state.inner());
    }

    // Register the new torrent's metadata in state so the stats poller,
    // prefetch hook (handle_torrent_advance), and shutdown can all find it.
    if let Ok(mut ids) = state.torrent_ids.lock() {
        ids.insert(added.id);
    }
    if let Ok(mut g) = state.torrent_video_idxs.lock() {
        *g = added.videos.iter().map(|v| v.idx).collect();
    }
    if let Ok(mut g) = state.torrent_video_files.lock() {
        *g = added
            .videos
            .iter()
            .map(|v| (v.idx, v.stream_url.clone(), v.length))
            .collect();
    }

    // First file uses caller's mode (replace OR append-play); the rest always
    // append-play so they queue after the first regardless of mode.
    p.command(&["loadfile", &added.videos[0].stream_url, mode])?;
    for v in &added.videos[1..] {
        p.command(&["loadfile", &v.stream_url, "append-play"])?;
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TorrentVideoInfo {
    pub idx: usize,
    pub name: String,
    pub length: u64,
}

#[tauri::command]
pub async fn resolve_torrent_files(
    magnet: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<TorrentVideoInfo>, String> {
    app.emit("library:resolve-progress", "connecting").ok();
    crate::np_info!("resolve", "starting resolve for magnet");

    // Fix B26: check the torrent metadata cache first.
    {
        let cache = TORRENT_META_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cached) = cache.get(&magnet) {
            app.emit("library:resolve-progress", "done").ok();
            crate::np_info!("resolve", "cache hit, {} video(s)", cached.len());
            return Ok(cached.clone());
        }
    }

    let handle = ensure_streaming(&state, &app)?;
    let added = handle.add_magnet(&magnet)?;
    crate::np_info!("resolve", "add_magnet returned id={}, {} video(s)", added.id, added.videos.len());
    app.emit("library:resolve-progress", "fetching_metadata").ok();

    if let Ok(mut g) = state.resolving_torrent_id.lock() {
        *g = Some(added.id);
    }

    let videos: Vec<TorrentVideoInfo> = added
        .videos
        .iter()
        .map(|v| TorrentVideoInfo {
            idx: v.idx,
            name: v.name.clone(),
            length: v.length,
        })
        .collect();

    if let Ok(mut g) = state.resolving_torrent_id.lock() {
        *g = None;
    }

    let _ = handle.forget(added.id);

    // Store in cache for future lookups (Fix B26).
    {
        let mut cache = TORRENT_META_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        cache.insert(magnet.clone(), videos.clone());
    }

    app.emit("library:resolve-progress", "done").ok();
    crate::np_info!("resolve", "resolve complete, {} video(s) found", videos.len());
    Ok(videos)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTorrent {
    pub magnet: String,
    pub name: String,
    pub videos: Vec<TorrentVideoInfo>,
}

#[tauri::command]
pub async fn resolve_torrent_file(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ResolvedTorrent, String> {
    app.emit("library:resolve-progress", "connecting").ok();
    crate::np_info!("resolve", "reading .torrent file: {}", path);
    let bytes = std::fs::read(&path).map_err(|e| format!("read .torrent: {e}"))?;

    let handle = ensure_streaming(&state, &app)?;
    let added = handle.add_torrent_bytes(&bytes)?;
    crate::np_info!("resolve", "torrent file added id={}, {} video(s)", added.id, added.videos.len());
    app.emit("library:resolve-progress", "fetching_metadata").ok();

    if let Ok(mut g) = state.resolving_torrent_id.lock() {
        *g = Some(added.id);
    }

    let magnet = format!("magnet:?xt=urn:btih:{}", added.info_hash);
    let torrent_name = added.name;
    let videos: Vec<TorrentVideoInfo> = added
        .videos
        .iter()
        .map(|v| TorrentVideoInfo {
            idx: v.idx,
            name: v.name.clone(),
            length: v.length,
        })
        .collect();

    if let Ok(mut g) = state.resolving_torrent_id.lock() {
        *g = None;
    }

    let _ = handle.forget(added.id);

    // Cache by the derived magnet URI (Fix B26).
    {
        let mut cache = TORRENT_META_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        cache.insert(magnet.clone(), videos.clone());
    }

    app.emit("library:resolve-progress", "done").ok();
    crate::np_info!("resolve", "torrent file resolve complete, {} video(s)", videos.len());
    Ok(ResolvedTorrent {
        magnet,
        name: torrent_name,
        videos,
    })
}

#[tauri::command]
pub fn cancel_torrent_resolve(state: State<'_, AppState>) -> Result<(), String> {
    let id_to_forget = state
        .resolving_torrent_id
        .lock()
        .ok()
        .and_then(|mut g| g.take());
    if let Some(id) = id_to_forget {
        crate::np_info!("resolve", "cancelling resolve, forgetting torrent {}", id);
        // Extract handle then drop the lock before HTTP I/O.
        let handle = state
            .streaming
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|s| s.handle()));
        if let Some(h) = handle {
            let _ = h.forget(id);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_downloads(state: State<'_, AppState>) -> Result<Vec<crate::streaming::TorrentStats>, String> {
    let ids: Vec<u32> = state
        .torrent_ids
        .lock()
        .map_err(|e| format!("lock: {e}"))?
        .iter()
        .copied()
        .collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // Clone the handle out of the lock so HTTP GETs run lock-free.
    let handle = {
        let guard = state
            .streaming
            .lock()
            .map_err(|e| format!("streaming lock: {e}"))?;
        guard.as_ref().ok_or("no streaming session")?.handle()
    };
    let mut results = Vec::new();
    for id in ids {
        if let Ok(stats) = handle.get_stats(id) {
            results.push(stats);
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn pause_download(id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let handle = {
        let guard = state
            .streaming
            .lock()
            .map_err(|e| format!("lock: {e}"))?;
        guard.as_ref().ok_or("no streaming session")?.handle()
    };
    // HTTP POST runs outside the streaming lock.
    let url = format!("{}/torrents/{}/pause", handle.base_url, id);
    handle.http
        .post(&url)
        .send_string("")
        .map_err(|e| format!("rqbit POST pause: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn resume_download(id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let handle = {
        let guard = state
            .streaming
            .lock()
            .map_err(|e| format!("lock: {e}"))?;
        guard.as_ref().ok_or("no streaming session")?.handle()
    };
    let url = format!("{}/torrents/{}/start", handle.base_url, id);
    handle.http
        .post(&url)
        .send_string("")
        .map_err(|e| format!("rqbit POST start: {e}"))?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadResult {
    pub torrent_id: u32,
    pub file_length: u64,
}

#[tauri::command]
pub async fn start_download(
    magnet: String,
    file_index: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<StartDownloadResult, String> {
    let handle = ensure_streaming(&state, &app)?;
    let added = handle.add_magnet(&magnet)?;

    let mut all_wanted: Vec<usize> = Vec::new();
    if let Ok(mut map) = state.download_wanted_files.lock() {
        let entry = map.entry(added.id).or_default();
        if let Some(fi) = file_index {
            entry.insert(fi as usize);
        }
        all_wanted = entry.iter().copied().collect();
    }
    if !all_wanted.is_empty() {
        let _ = handle.set_only_files(added.id, &all_wanted);
    }

    if let Ok(mut ids) = state.torrent_ids.lock() {
        ids.insert(added.id);
    }

    let file_length = file_index
        .and_then(|fi| added.videos.iter().find(|v| v.idx == fi as usize))
        .map(|v| v.length)
        .unwrap_or(0);

    crate::np_info!("download", "started download torrent_id={} file_length={}", added.id, file_length);
    Ok(StartDownloadResult { torrent_id: added.id, file_length })
}

#[tauri::command]
pub fn stop_download(id: u32, file_index: Option<u32>, state: State<'_, AppState>) -> Result<(), String> {
    let handle = {
        let guard = state
            .streaming
            .lock()
            .map_err(|e| format!("lock: {e}"))?;
        guard.as_ref().map(|s| s.handle())
    };

    let mut remaining: Vec<usize> = Vec::new();
    if let Ok(mut map) = state.download_wanted_files.lock() {
        if let Some(fi) = file_index {
            if let Some(set) = map.get_mut(&id) {
                set.remove(&(fi as usize));
                remaining = set.iter().copied().collect();
            }
            if remaining.is_empty() {
                map.remove(&id);
            }
        } else {
            map.remove(&id);
        }
    }

    if remaining.is_empty() {
        if let Ok(mut ids) = state.torrent_ids.lock() {
            ids.remove(&id);
        }
        if let Some(h) = handle {
            let _ = h.forget(id);
        }
    } else if let Some(h) = handle {
        let _ = h.set_only_files(id, &remaining);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_torrent_file_path(
    magnet: String,
    file_index: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Option<String>, String> {
    let handle = ensure_streaming(&state, &app)?;
    let added = handle.add_magnet(&magnet)?;

    let session = crate::streaming::session_dir();
    let torrent_name = added.name;

    if let Some(fi) = file_index {
        if let Some(video) = added.videos.iter().find(|v| v.idx == fi as usize) {
            let path = session.join(&torrent_name).join(&video.name);
            if path.is_file() {
                return Ok(path.to_str().map(|s| s.to_string()));
            }
        }
    } else {
        let path = session.join(&torrent_name);
        if path.is_file() {
            return Ok(path.to_str().map(|s| s.to_string()));
        }
    }
    Ok(None)
}


/// Module-level flag for the torrent stats poller. The poller thread resets
/// this to `false` before exiting (after 60 s idle) so `ensure_streaming` can
/// re-spawn it for future torrents. Using a static avoids needing to send a
/// reference to the non-Arc `stats_poller_started` field across threads.
static STATS_POLLER_ALIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Ensure rqbit is running and return a lightweight `SessionHandle` that can
/// perform HTTP requests without holding the streaming mutex. The lock is
/// held only long enough to spawn the sidecar (if needed) and clone the
/// handle — all subsequent network I/O runs lock-free (Fix B27).
fn ensure_streaming(
    state: &State<'_, AppState>,
    app: &AppHandle,
) -> Result<streaming::SessionHandle, String> {
    let handle = {
        let mut guard = state
            .streaming
            .lock()
            .map_err(|e| format!("streaming lock: {e}"))?;
        if guard.is_none() {
            let exe = streaming::locate_rqbit().ok_or_else(|| {
                "rqbit.exe not found in bin/ — installer must place it next to NewPlayer.exe"
                    .to_string()
            })?;
            let upload_limit = state.upload_limit_bytes.load(Ordering::Relaxed);
            let download_limit = state.download_limit_bytes.load(Ordering::Relaxed);
            let session = StreamingSession::start(
                &exe,
                &streaming::session_dir(),
                app.clone(),
                upload_limit,
                download_limit,
            )?;
            *guard = Some(session);
        }
        guard.as_ref().unwrap().handle()
    }; // streaming guard dropped here — all subsequent I/O is lock-free
    // Kick off the stats poller so the LoadingSourceOverlay gets live
    // speed/peers/ETA every second. The poller thread resets
    // STATS_POLLER_ALIVE before exiting so it can be re-spawned for future
    // torrents (Fix 8).
    if !STATS_POLLER_ALIVE.swap(true, Ordering::AcqRel) {
        spawn_torrent_stats_poller(state, app);
    }
    Ok(handle)
}

/// Spawn a background thread that polls rqbit for live torrent stats once a
/// second and forwards them to the frontend as `mpv:torrent-stats`. The
/// active torrent (set by the events thread on file-loaded) is preferred;
/// when no torrent is currently loaded but one was just added (we're still
/// in the init phase before the first file-loaded event), we fall back to
/// the first registered torrent ID. That's how the overlay gets live data
/// during the validate-pieces window — exactly when the user most needs to
/// see "yes, something is happening, here's the speed".
fn spawn_torrent_stats_poller(state: &State<'_, AppState>, app: &AppHandle) {
    let app = app.clone();
    let streaming = state.streaming.clone();
    let active = state.active_torrent.clone();
    let torrent_ids = state.torrent_ids.clone();
    std::thread::spawn(move || {
        let mut idle_count = 0u32;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            // Pick the torrent to poll: active first, fall back to any registered.
            // Lock ordering: torrent_ids (2) before active_torrent (3) to
            // match the canonical order: streaming(1) > torrent_ids(2) >
            // active_torrent(3) > torrent_video_idxs(4) > torrent_video_files(5).
            let id_opt: Option<u32> = {
                let fallback_id = torrent_ids
                    .lock()
                    .ok()
                    .and_then(|g| g.iter().next().copied());
                let active_id = active
                    .lock()
                    .ok()
                    .and_then(|g| g.as_ref().map(|a| a.torrent_id));
                active_id.or(fallback_id)
            };
            if id_opt.is_none() {
                idle_count += 1;
                if idle_count > 60 {
                    // Reset so ensure_streaming can re-spawn a new poller
                    // for future torrents (Fix 8).
                    STATS_POLLER_ALIVE.store(false, Ordering::Release);
                    break;
                }
                continue;
            } else {
                idle_count = 0;
            }
            let Some(id) = id_opt else { continue };
            // Clone the base_url + http agent out of the streaming lock so the
            // actual HTTP GET happens without holding the mutex. The stats GET
            // typically takes ~10-30 ms locally, but under load it can stall;
            // holding the streaming lock during that time blocks add_magnet /
            // set_only_files callers.
            let stats_result = {
                let (base_url, http) = {
                    let guard = match streaming.lock() {
                        Ok(g) => g,
                        Err(_) => continue,
                    };
                    match guard.as_ref() {
                        Some(s) => (s.base_url().to_string(), s.http_agent()),
                        None => continue,
                    }
                }; // streaming guard dropped here
                // Perform the HTTP GET outside the lock.
                fetch_torrent_stats(&http, &base_url, id)
            };
            match stats_result {
                Ok(s) => {
                    let _ = app.emit("mpv:torrent-stats", s);
                }
                Err(e) => {
                    crate::np_debug!("rqbit", "stats poll failed: {e}");
                }
            }
        } // end loop
    });
}

/// Fetch torrent stats without holding the streaming lock. Uses the standalone
/// `streaming::fetch_stats` so the HTTP GET runs lock-free.
fn fetch_torrent_stats(
    http: &ureq::Agent,
    base_url: &str,
    id: u32,
) -> Result<streaming::TorrentStats, String> {
    streaming::fetch_stats(http, base_url, id)
}



/// Returns a window of up to `n` consecutive video file indices from the
/// torrent's video index list, starting at `file_idx`. Used by both
/// `handle_torrent_advance` (optimistic prefetch) and
/// `try_recover_torrent_load` (on-demand recovery after a skip).
fn torrent_sliding_window(state: &AppState, file_idx: usize, n: usize) -> Vec<usize> {
    state
        .torrent_video_idxs
        .lock()
        .ok()
        .map(|g| {
            let pos = g.iter().position(|&i| i == file_idx).unwrap_or(0);
            g[pos..].iter().take(n).copied().collect()
        })
        .unwrap_or_else(|| vec![file_idx])
}

/// Best-effort prefetch nudge for the torrent the player just advanced to.
/// Called from events.rs on FILE_LOADED. Marks the current + next 2 video
/// files as "wanted" in rqbit so they are downloaded in priority order.
/// The rest of the torrent is ignored until the user gets to it.
///
/// If the user skips past this window, events.rs EndFile error handler calls
/// try_recover_torrent_load to widen the window and issue a loadfile-replace.
pub fn handle_torrent_advance(state: &AppState, url: &str) {
    let Some((torrent_id, file_idx)) = streaming::parse_stream_url(url) else {
        // Not a torrent stream — clear active marker so prefetch doesn't
        // misfire on the next event.
        if let Ok(mut g) = state.active_torrent.lock() {
            *g = None;
        }
        return;
    };

    // Lock ordering: streaming (1) > torrent_ids (2) > active_torrent (3)
    // > torrent_video_idxs (4) > torrent_video_files (5).
    //
    // Clone the http agent + base_url out of the streaming lock so we can
    // run set_only_files without holding it (Fix 4: don't hold mutex across
    // network I/O that can block up to 120 s).
    let session_data = {
        let guard = match state.streaming.lock() {
            Ok(g) => g,
            Err(e) => {
                crate::np_warn!("rqbit", "streaming lock poisoned: {e}");
                return;
            }
        };
        guard
            .as_ref()
            .map(|s| (s.base_url().to_string(), s.http_agent()))
    }; // streaming guard dropped here

    // Track previous file for the active-torrent update below.
    let prev = state.active_torrent.lock().ok().and_then(|g| {
        g.as_ref()
            .and_then(|a| (a.torrent_id == torrent_id).then_some(a.file_idx))
    });

    // Mark the current video file plus the next two video files as wanted.
    let wanted: Vec<usize> = torrent_sliding_window(
        state, file_idx, 3, // current + next 2
    );

    // Update active item before issuing the rqbit call so a fast follow-up
    // event sees the right "prev_idx".
    if let Ok(mut g) = state.active_torrent.lock() {
        *g = Some(crate::state::ActiveTorrentItem {
            torrent_id,
            file_idx,
            prev_idx: prev,
        });
    }

    // Issue the set_only_files call without holding any lock. The HTTP
    // request can take significant time during rqbit's initial-checksum phase.
    if let Some((base_url, http)) = session_data {
        let url = format!("{}/torrents/{}/update_only_files", base_url, torrent_id);
        let body = serde_json::json!({ "only_files": wanted });
        if let Ok(body_bytes) = serde_json::to_vec(&body) {
            let result = http
                .post(&url)
                .set("Content-Type", "application/json")
                .send_bytes(&body_bytes);
            if let Err(e) = result {
                crate::np_warn!("rqbit", "prefetch set_only_files failed: {e}");
            }
        }
    }
}

/// Called from events.rs EndFile error handler when mpv fails to load a
/// torrent stream URL. This happens when the user skips to a video file that
/// isn't in the current "wanted" window and rqbit refuses the stream.
///
/// Recovery: widens the wanted window to include the skipped-to file, then
/// retries the load via `loadfile replace`. Shows a LoadingSourceOverlay so
/// the user sees progress while rqbit prioritizes the new window.
///
/// Returns `true` if recovery was attempted (caller should suppress the
/// normal mpv:eof error toast). Returns `false` for non-torrent URLs.
pub fn try_recover_torrent_load(state: &AppState, app: &AppHandle, failed_url: &str) -> bool {
    let Some((torrent_id, file_idx)) = streaming::parse_stream_url(failed_url) else {
        return false;
    };
    // Only recover the currently-playing torrent. During torrent switch, the
    // old torrent (T1) stays in torrent_ids while T2 initializes (120s wait),
    // so checking torrent_ids would recover T1's EndFile errors, re-arm the
    // overlay, and the overlay would never dismiss because T1 never plays again.
    let is_active = state
        .active_torrent
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|a| a.torrent_id == torrent_id))
        .unwrap_or(false);
    if !is_active {
        return false;
    }

    let wanted = torrent_sliding_window(state, file_idx, 3);
    let player = match state.player.as_ref() {
        Some(p) => p.clone(),
        None => return false,
    };
    // Extract a SessionHandle so the spawned thread can do HTTP without
    // holding the streaming lock.
    let handle = match state.streaming.lock().ok().and_then(|g| g.as_ref().map(|s| s.handle())) {
        Some(h) => h,
        None => return false,
    };
    let app2 = app.clone();
    let retry_url = failed_url.to_string();

    std::thread::spawn(move || {
        let _ = app2.emit(
            "mpv:source-loading",
            SourceLoadingPayload {
                phase: "buffer".into(),
                label: "Requesting pieces for this file…".into(),
                progress: None,
            },
        );
        match handle.set_only_files(torrent_id, &wanted) {
            Ok(_) => {
                // rqbit now accepts the stream; issue loadfile-replace.
                // LoadingSourceOverlay auto-dismisses on time-pos > 0.3.
                let _ = player.command(&["loadfile", &retry_url, "replace"]);
            }
            Err(_) => {
                let _ = app2.emit("mpv:source-loading-done", ());
            }
        }
    });
    true
}

/// Forget every torrent ID we've added in this session. Best-effort —
/// individual failures are logged. Called from app shutdown so rqbit's
/// session is empty when the sidecar process is killed.
///
/// Lock ordering: streaming (1) before torrent_ids (2). We acquire streaming
/// first, snapshot the IDs while still holding it, then issue the forget
/// calls. This prevents ABBA deadlocks with the stats poller and other paths
/// that also hold streaming while touching torrent_ids.
pub fn forget_all_torrents(state: &AppState) {
    // Lock ordering: streaming (1) before torrent_ids (2). Extract a handle
    // and snapshot IDs, then drop both locks before issuing HTTP forget calls.
    let handle = state
        .streaming
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|s| s.handle()));
    let ids: Vec<u32> = state
        .torrent_ids
        .lock()
        .ok()
        .map(|g| g.iter().copied().collect())
        .unwrap_or_default();
    // Both locks are dropped. HTTP I/O runs lock-free.
    if let Some(h) = handle {
        for id in &ids {
            let _ = h.forget(*id);
        }
    }
}

/// Drop every previously-loaded source so a new replace-mode load starts
/// from a clean slate:
///   - rqbit `forget` for every tracked torrent ID (stops their downloads)
///   - clear `state.torrent_ids` so the next add starts the set fresh
///   - clear `state.active_torrent` (the prefetch hook reads this)
///   - clear the archive registry + active_archive_path
///
/// Without this, opening a 2nd magnet/archive while a 1st was still going
/// leaves the 1st downloading in the background AND racing the new one
/// for rqbit's lock — which manifests as the new file showing endless
/// "loading" while the old torrent keeps eating bandwidth.
pub fn drop_previous_sources(state: &AppState) {
    // Lock ordering: streaming (1) > torrent_ids (2) > active_torrent (3)
    // > torrent_video_idxs (4) > torrent_video_files (5).
    // Use forget_all_torrents which respects the ordering and runs HTTP
    // calls outside all locks.
    forget_all_torrents(state);
    // Now clear state in canonical lock order. Each lock is acquired and
    // released independently (no nesting) so ordering is trivially safe.
    if let Ok(mut g) = state.torrent_ids.lock() {
        g.clear();
    }
    if let Ok(mut g) = state.active_torrent.lock() {
        *g = None;
    }
    if let Ok(mut g) = state.torrent_video_idxs.lock() {
        g.clear();
    }
    if let Ok(mut g) = state.torrent_video_files.lock() {
        g.clear();
    }
    if let Ok(mut g) = state.archive_registry.lock() {
        *g = crate::archive::ArchiveRegistry::new();
    }
    if let Ok(mut g) = state.active_archive_path.lock() {
        *g = None;
    }
    // Run cache eviction in the background after dropping sources so rqbit
    // is no longer writing to the session dir before we start deleting.
    let limit = state.cache_limit_bytes.load(Ordering::Relaxed);
    if limit > 0 {
        std::thread::spawn(move || streaming::run_cache_eviction(limit));
    }
}

/// Persist the user's torrent cache size limit and immediately run an
/// eviction pass against the session directory.
#[tauri::command]
pub fn set_torrent_cache_limit(state: State<'_, AppState>, bytes: u64) {
    state.cache_limit_bytes.store(bytes, Ordering::Relaxed);
    if bytes > 0 {
        std::thread::spawn(move || streaming::run_cache_eviction(bytes));
    }
}

#[tauri::command]
pub fn set_torrent_upload_limit(state: State<'_, AppState>, bytes: u64) {
    state.upload_limit_bytes.store(bytes, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_torrent_download_limit(state: State<'_, AppState>, bytes: u64) {
    state.download_limit_bytes.store(bytes, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_torrent_max_connections(_state: State<'_, AppState>, _count: u32) {
    // Max connections is stored frontend-side in the Tauri Store and applied
    // at the next rqbit spawn. No runtime change available via rqbit HTTP API.
}

// ── Archive sources: .zip / .7z / .rar ──────────────────────────────────────

/// Open an archive file, surface every video entry as a playlist item, and
/// extract entry 0 synchronously so playback can start immediately. Entry 1+
/// are extracted lazily — the events handler watches `mpv:file-loaded` for
/// archive-cache paths and kicks the next prefetch (and runs LRU eviction).
///
/// `append=true` queues into the existing playlist; `false` replaces it.
///
/// Async for the same reason as `open_source`: archive enumeration over a
/// multi-GB zip can take several seconds (the underlying crate reads the
/// whole central directory), and the first-entry extract is synchronous.
/// Running on the main thread would freeze the window during that wait.
#[tauri::command]
pub async fn open_archive(
    url: String,
    append: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    crate::np_info!("cmd", "open_archive path={} append={}", url, append);
    let p = player_ref(&state)?;
    let mode = if append { "append-play" } else { "replace" };

    // Same housekeeping as open_source: a replace-mode archive open should
    // stop any previously-running torrents and drop the prior archive
    // registry so its cache files become reclaimable.
    if !append {
        drop_previous_sources(state.inner());
    }

    let path = Path::new(&url);
    if !path.is_file() {
        return Err(format!("archive not found: {url}"));
    }

    // Open + enumerate (cheap: central directory only, no extraction).
    let handle = Arc::new(archive::open_archive(path)?);

    // Sync-extract entry 0 so the first loadfile resolves immediately. The
    // overlay covers the wait visually — we emit progress phases here.
    let _ = app.emit(
        "mpv:source-loading",
        SourceLoadingPayload {
            phase: "extract".into(),
            label: format!("Extracting {}", handle.entries[0].rel_path.display()),
            progress: None,
        },
    );
    let first_path = archive::ensure_entry(&handle, 0)?;
    {
        // Bind the first path so LRU never evicts what's about to play.
        if let Ok(mut s) = handle.active_paths.lock() {
            s.insert(first_path.clone());
        }
    }
    let _ = app.emit("mpv:source-loading-done", ());

    // Register so the events-side handlers can find the right archive when
    // mpv loads / fails-to-load a cache path.
    if let Ok(mut reg) = state.archive_registry.lock() {
        reg.register(handle.clone());
    }

    // First file uses caller's mode; rest queue with append-play. Same
    // pattern as the torrent path so user-visible behavior is consistent.
    p.command(&["loadfile", &path_to_mpv_string(&first_path), mode])?;
    for entry in handle.entries.iter().skip(1) {
        let p2 = handle.cache_dir.join(&entry.rel_path);
        p.command(&["loadfile", &path_to_mpv_string(&p2), "append-play"])?;
    }

    // Background prefetch of entry 1 so the natural advance is seamless.
    if handle.entries.len() > 1 {
        let bg = handle.clone();
        std::thread::spawn(move || {
            if let Err(e) = archive::ensure_entry(&bg, 1) {
                crate::np_warn!("archive", "prefetch idx=1 failed: {e}");
            }
        });
    }
    Ok(())
}

/// mpv-friendly stringification of a Path. Forward slashes for portability
/// (libavformat parses both, but `\` triggers the option-list parser if the
/// path lands inside a chained command).
fn path_to_mpv_string(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceLoadingPayload {
    pub phase: String, // "extract" | "connect" | "buffer"
    pub label: String,
    pub progress: Option<f64>, // 0..1, or null for indeterminate
}

/// Events-side helper, called from `mpv:file-loaded`. If the new path is
/// inside a registered archive, marks it as the active cache path,
/// removes the previous active marker, and kicks prefetch for the next
/// entry. Returns silently for non-archive paths.
pub fn handle_archive_advance(state: &AppState, path_str: &str) {
    let path = PathBuf::from(path_str);
    let handle = match state
        .archive_registry
        .lock()
        .ok()
        .and_then(|r| r.lookup_by_path(&path))
    {
        Some(h) => h,
        None => {
            // Not an archive cache path → nothing to do, but clear stale
            // marker so the next archive load starts cleanly.
            if let Ok(mut g) = state.active_archive_path.lock() {
                *g = None;
            }
            return;
        }
    };
    // Update active-paths set: remove previous, add current.
    let prev = state
        .active_archive_path
        .lock()
        .ok()
        .and_then(|g| g.clone());
    if let Ok(mut s) = handle.active_paths.lock() {
        if let Some(p) = prev.as_ref() {
            s.remove(p);
        }
        s.insert(path.clone());
    }
    if let Ok(mut g) = state.active_archive_path.lock() {
        *g = Some(path.clone());
    }
    // Find idx of the just-loaded entry and prefetch idx+1 in the
    // background. idx is the position in handle.entries (sorted by name)
    // not the archive's internal index — both archive backends look up by
    // rel_path, so the sorted order is what we walk.
    let idx = handle
        .entries
        .iter()
        .position(|e| handle.cache_dir.join(&e.rel_path) == path);
    if let Some(i) = idx {
        if i + 1 < handle.entries.len() {
            let bg = handle.clone();
            std::thread::spawn(move || {
                if let Err(e) = archive::ensure_entry(&bg, i + 1) {
                    crate::np_warn!("archive", "prefetch idx={} failed: {e}", i + 1);
                }
                if let Ok(mut s) = bg.active_paths.lock() {
                    s.insert(bg.cache_dir.join(&bg.entries[i + 1].rel_path));
                }
            });
        }
    }
}

/// Events-side helper for the on-demand recovery path. Called when mpv
/// emits EndFile-error and we suspect the failed path is an archive cache
/// entry that hasn't been extracted yet (manual playlist skip past the
/// prefetch window). Extracts the entry off-thread, then asks mpv to retry
/// via `loadfile replace` so the user sees a brief stall, then playback.
pub fn try_recover_archive_load(state: &AppState, app: &AppHandle, failed_path: &str) -> bool {
    let path = PathBuf::from(failed_path);
    let handle = match state
        .archive_registry
        .lock()
        .ok()
        .and_then(|r| r.lookup_by_path(&path))
    {
        Some(h) => h,
        None => return false,
    };
    // Map the failed path back to an entry idx.
    let idx = match handle
        .entries
        .iter()
        .position(|e| handle.cache_dir.join(&e.rel_path) == path)
    {
        Some(i) => i,
        None => return false,
    };
    let player = match state.player.as_ref() {
        Some(p) => p.clone(),
        None => return false,
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        let _ = app2.emit(
            "mpv:source-loading",
            SourceLoadingPayload {
                phase: "extract".into(),
                label: format!("Extracting {}", handle.entries[idx].rel_path.display()),
                progress: None,
            },
        );
        match archive::ensure_entry(&handle, idx) {
            Ok(extracted) => {
                if let Ok(mut s) = handle.active_paths.lock() {
                    s.insert(extracted.clone());
                }
                let _ = app2.emit("mpv:source-loading-done", ());
                let _ = player.command(&["loadfile", &path_to_mpv_string(&extracted), "replace"]);
            }
            Err(e) => {
                let _ = app2.emit("mpv:source-loading-done", ());
                crate::np_warn!("archive", "on-demand extract idx={} failed: {e}", idx);
            }
        }
    });
    true
}

/// Toggle the larger demuxer cache used for network sources. Called by the
/// frontend on `mpv:file-loaded` after detecting a non-file URL — mpv
/// resets these on every loadfile, so they have to be re-applied per file.
///
/// For streams we lean aggressive:
///   * cache-secs=60: pre-buffer 60s so a forward seek inside that window
///     plays without re-fetching.
///   * demuxer-max-bytes=256MiB: enough headroom for 1080p so the cache
///     doesn't trim aggressively.
///   * cache-on-disk=yes: spool to a memory-mapped tmp file instead of
///     burning RAM. mpv handles this automatically — keeps RSS low even
///     with a giant cache.
///   * demuxer-readahead-secs=15: how far ahead the demuxer races even if
///     the cache budget allows more.
///   * cache-pause-initial=no: don't make the user wait for the cache to
///     fill before showing the first frame. Cuts start latency by ~1s.
#[tauri::command]
pub fn set_stream_cache(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    if enabled {
        p.set_string_prop_pub("cache-secs", "60")?;
        p.set_string_prop_pub("demuxer-max-bytes", "256MiB")?;
        let _ = p.set_string_prop_pub("cache-on-disk", "yes");
        let _ = p.set_string_prop_pub("demuxer-readahead-secs", "15");
        let _ = p.set_string_prop_pub("cache-pause-initial", "no");
    } else {
        p.set_string_prop_pub("cache-secs", "5")?;
        p.set_string_prop_pub("demuxer-max-bytes", "10MiB")?;
        let _ = p.set_string_prop_pub("cache-on-disk", "no");
    }
    Ok(())
}

// ── UI dormancy (idle WebView hide) ─────────────────────────────────────────

/// Mark the UI as dormant: hide the WebView2 child window and flip the flag
/// the mpv event loop reads. Intended for "user has been idle while playing
/// fullscreen" — the WebView stops compositing, Page Visibility throttles
/// JS rAF, and only mpv keeps painting. Wake via the `ui:wake` event from
/// the events module (or an explicit `ui_wake` invoke for JS-driven cases).
#[tauri::command]
pub fn ui_dormant(state: State<'_, AppState>) -> Result<(), String> {
    state.ui.is_dormant.store(true, Ordering::Relaxed);
    if let Some(h) = state.ui.webview_hwnd_value() {
        crate::hide_webview(h);
    }
    crate::np_info!("ui", "dormant (JS request)");
    Ok(())
}

/// Explicit JS-driven wake. Same effect as the events-module path that fires
/// on mpv input — used for cases where JS wants to come back without waiting
/// for a mouse move (e.g. `mpv:cli-file` arrival, dialog open via keyboard
/// shortcut bound at the OS level).
#[tauri::command]
pub fn ui_wake(state: State<'_, AppState>) -> Result<(), String> {
    state.ui.is_dormant.store(false, Ordering::Relaxed);
    if let Some(h) = state.ui.webview_hwnd_value() {
        crate::show_webview(h);
    }
    crate::np_info!("ui", "wake (JS request)");
    Ok(())
}

// ── Picture-in-Picture ───────────────────────────────────────────────────────

const PIP_WIDTH: u32 = 480;
const PIP_HEIGHT: u32 = 270;
const PIP_MARGIN: i32 = 20;

/// Shrink the main window to a top-right corner mini-mode and pin it
/// always-on-top. The pre-PiP geometry (size, position, decorations) is
/// stashed in `AppState::pip` so `exit_pip` can restore it. Idempotent: a
/// 2nd call while already in PiP is a no-op.
#[tauri::command]
pub fn enter_pip(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};

    {
        let g = state
            .pip
            .saved
            .lock()
            .map_err(|e| format!("pip lock: {e}"))?;
        if g.is_some() {
            return Ok(());
        }
    }

    // Snapshot current geometry so we can restore it on exit.
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let saved = PipGeometry {
        width: ((size.width as f64) / scale).round() as u32,
        height: ((size.height as f64) / scale).round() as u32,
        x: ((pos.x as f64) / scale).round() as i32,
        y: ((pos.y as f64) / scale).round() as i32,
        decorations: window.is_decorated().unwrap_or(true),
    };
    {
        let mut g = state
            .pip
            .saved
            .lock()
            .map_err(|e| format!("pip lock: {e}"))?;
        *g = Some(saved);
    }

    let work = window.current_monitor().map_err(|e| e.to_string())?;
    let (mon_w, mon_x, mon_y) = match work {
        Some(m) => {
            let s = m.size();
            let p = m.position();
            (
                ((s.width as f64) / scale).round() as i32,
                ((p.x as f64) / scale).round() as i32,
                ((p.y as f64) / scale).round() as i32,
            )
        }
        None => (1920, 0, 0),
    };

    let _ = window.set_decorations(false);
    let _ = window.set_resizable(false);
    let _ = window.set_always_on_top(true);
    window
        .set_size(LogicalSize::new(PIP_WIDTH as f64, PIP_HEIGHT as f64))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(
            (mon_x + mon_w - PIP_WIDTH as i32 - PIP_MARGIN) as f64,
            (mon_y + PIP_MARGIN) as f64,
        ))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn exit_pip(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};

    let g = {
        let mut guard = state
            .pip
            .saved
            .lock()
            .map_err(|e| format!("pip lock: {e}"))?;
        guard.take()
    };
    let Some(g) = g else { return Ok(()) };

    let _ = window.set_always_on_top(false);
    let _ = window.set_resizable(true);
    let _ = window.set_decorations(g.decorations);
    window
        .set_size(LogicalSize::new(g.width as f64, g.height as f64))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(g.x as f64, g.y as f64))
        .map_err(|e| e.to_string())?;
    Ok(())
}
