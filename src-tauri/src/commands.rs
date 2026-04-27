use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::perf::{self, PerfProfile, ResolvedPerf};
use crate::player::Player;
use crate::state::{AppState, PipGeometry};
use crate::thumbnailer;

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

    for entry in arr {
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

        let track = Track { id, title, lang, codec, selected };
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
    player_ref(&state)?.seek(seconds, &mode)
}

/// Track the user's intended volume. When AGC is off, push it to mpv directly.
/// When AGC is on, the AGC tick reads `user_volume` and applies the combined
/// (user × AGC-correction) value on its next loop.
#[tauri::command]
pub fn set_volume(volume: f64, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut params = state
            .agc
            .params
            .lock()
            .map_err(|e| format!("agc lock: {e}"))?;
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
        filters
            .push("lavfi=[astats=metadata=1:reset=1:length=0.04]@agcstats".to_string());
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
    state
        .agc
        .enabled
        .store(dynamic_enabled, Ordering::Relaxed);

    // When AGC turns off, restore mpv volume to the user's slider position
    // (it may currently sit at a boosted/cut value from the last AGC tick).
    if !dynamic_enabled {
        player_ref(&state)?.set_volume(user_vol)?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_subtitle_style(
    style: SubtitleStyle,
    state: State<'_, AppState>,
) -> Result<(), String> {
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
pub fn set_subtitle_delay(
    delay_ms: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
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
pub fn set_image_params(
    params: ImageParams,
    state: State<'_, AppState>,
) -> Result<(), String> {
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
            "lavfi=[acompressor=threshold=0.089:ratio=4:attack=5:release=50:makeup=2]"
                .to_string(),
        );
    }
    // Insert EQ after compression so it shapes the post-compressed signal.
    if eq_enabled && eq_bands.len() == 10 {
        let mut bands = [0.0f64; 10];
        for (i, b) in eq_bands.iter().take(10).enumerate() {
            bands[i] = b.clamp(-12.0, 12.0);
        }
        if let Some(eq) = build_eq_filter(&bands) {
            filters.push(eq);
        }
    }
    if dynamic_enabled {
        filters.push(
            "lavfi=[astats=metadata=1:reset=1:length=0.04]@agcstats".to_string(),
        );
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
    state
        .agc
        .enabled
        .store(dynamic_enabled, Ordering::Relaxed);
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
pub fn set_exclusive_fullscreen(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let p = player_ref(&state)?;
    // d3d11-exclusive-fs is gpu-next-aware but only meaningful when
    // gpu-context=d3d11 (which we force on Windows). Use the optional
    // path so non-Windows / non-d3d11 builds don't error.
    let _ = p.set_string_prop_pub(
        "d3d11-exclusive-fs",
        if enabled { "yes" } else { "no" },
    );
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
    player_ref(&state)?
        .set_string_prop_pub("loop-file", if enabled { "inf" } else { "no" })
}

/// Loop the entire playlist. Independent from loop-file — both can be on.
#[tauri::command]
pub fn set_loop_playlist(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?
        .set_string_prop_pub("loop-playlist", if enabled { "inf" } else { "no" })
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
            current: item.get("current").and_then(|v| v.as_bool()).unwrap_or(false),
        })
        .collect()
}

#[tauri::command]
pub fn get_playlist(state: State<'_, AppState>) -> Result<Vec<PlaylistItem>, String> {
    let p = player_ref(&state)?;
    Ok(read_playlist(p))
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
    let _ = p.command(&["seek", "0", "exact"]);
    Ok(())
}

// ── Deinterlace ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_deinterlace(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.set_string_prop_pub(
        "deinterlace",
        if enabled { "yes" } else { "no" },
    )
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

// ── Picture-in-Picture ───────────────────────────────────────────────────────

const PIP_WIDTH: u32 = 480;
const PIP_HEIGHT: u32 = 270;
const PIP_MARGIN: i32 = 20;

/// Shrink the main window to a top-right corner mini-mode and pin it
/// always-on-top. The pre-PiP geometry (size, position, decorations) is
/// stashed in `AppState::pip` so `exit_pip` can restore it. Idempotent: a
/// 2nd call while already in PiP is a no-op.
#[tauri::command]
pub fn enter_pip(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};

    {
        let g = state.pip.saved.lock().map_err(|e| format!("pip lock: {e}"))?;
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
        let mut g = state.pip.saved.lock().map_err(|e| format!("pip lock: {e}"))?;
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
pub fn exit_pip(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};

    let g = {
        let mut guard = state.pip.saved.lock().map_err(|e| format!("pip lock: {e}"))?;
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
