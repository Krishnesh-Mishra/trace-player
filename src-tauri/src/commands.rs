use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::player::Player;
use crate::state::{AppState, PipGeometry};
use crate::thumbnailer;

// ── Track list ──────────────────────────────────────────────────────────────

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
    pub align_y: String,
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
        let title = entry.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
        let lang = entry.get("lang").and_then(|v| v.as_str()).map(|s| s.to_string());
        let codec = entry.get("codec").and_then(|v| v.as_str()).map(|s| s.to_string());
        let selected = entry.get("selected").and_then(|v| v.as_bool()).unwrap_or(false);
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

// ── Playback ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn load_file(path: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::np_info!("cmd", "load_file path={}", path);
    player_ref(&state)?.load(&path)
}

#[tauri::command]
pub fn play(state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.play()
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.pause()
}

#[tauri::command]
pub fn seek(seconds: f64, mode: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.seek(seconds, &mode)
}

#[tauri::command]
pub fn set_volume(volume: f64, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut params = state.agc.params.lock().unwrap_or_else(|e| e.into_inner());
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
    let json = p.get_property_string("track-list").unwrap_or_else(|| "[]".to_string());
    Ok(parse_track_list(&json))
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

// ── Thumbnails ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_thumbnailing(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let thumb = state
        .get_or_init_thumbnailer()
        .ok_or_else(|| "Thumbnailer not initialized".to_string())?;
    thumbnailer::start_thumbnail_job(app, thumb, path);
    Ok(())
}

#[tauri::command]
pub fn request_thumb_window(
    t: f64,
    radius: f64,
    density: u32,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let thumb = state
        .get_or_init_thumbnailer()
        .ok_or_else(|| "Thumbnailer not initialized".to_string())?;
    thumbnailer::request_dense_window(app, thumb, t, radius, density);
    Ok(())
}

#[tauri::command]
pub fn request_thumb_exact(
    t: f64,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let thumb = state
        .get_or_init_thumbnailer()
        .ok_or_else(|| "Thumbnailer not initialized".to_string())?;
    thumbnailer::request_exact_frame(app, thumb, t);
    Ok(())
}

// ── Screenshot ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn take_screenshot(state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.command(&["screenshot", "video"])
}

// ── Chapters ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn chapter_seek(delta: i64, state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    p.command(&["add", "chapter", &delta.to_string()])
}

// ── Playlist read-only (used by events.rs to emit mpv:playlist) ─────────────

#[derive(Serialize, Clone)]
pub struct PlaylistItem {
    pub index: i64,
    pub filename: String,
    pub title: Option<String>,
    pub current: bool,
}

pub fn read_playlist(p: &Player) -> Vec<PlaylistItem> {
    let json = p.get_property_string("playlist").unwrap_or_else(|| "[]".to_string());
    let parsed: Value = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let arr = match parsed.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .enumerate()
        .map(|(idx, entry)| {
            let filename = entry
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = entry
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let current = entry
                .get("current")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            PlaylistItem {
                index: idx as i64,
                filename,
                title,
                current,
            }
        })
        .collect()
}

// ── Player snapshot for the React rehydrate path ────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub path: String,
    pub paused: bool,
    pub time_pos: f64,
    pub duration: f64,
    pub volume: f64,
    pub speed: f64,
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
    let tracks_json = p.get_property_string("track-list").unwrap_or_else(|| "[]".to_string());
    let tracks = parse_track_list(&tracks_json);
    Ok(PlayerState {
        path,
        paused,
        time_pos,
        duration,
        volume,
        speed,
        tracks,
    })
}

// ── External subtitle ───────────────────────────────────────────────────────

#[tauri::command]
pub fn load_subtitle(path: String, state: State<'_, AppState>) -> Result<(), String> {
    player_ref(&state)?.command(&["sub-add", &path, "select"])
}

// ── Frame step ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn frame_step(backward: bool, state: State<'_, AppState>) -> Result<(), String> {
    if backward {
        player_ref(&state)?.command(&["frame-back-step"])
    } else {
        player_ref(&state)?.command(&["frame-step"])
    }
}

// ── Force redraw ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn force_redraw(state: State<'_, AppState>) -> Result<(), String> {
    let p = player_ref(&state)?;
    let _ = p.command(&["seek", "0", "exact"]);
    Ok(())
}

// ── Media info ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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

// ── Network sources (HTTP/RTSP only — no torrents in lite) ──────────────────

#[tauri::command]
pub async fn open_source(
    url: String,
    append: bool,
    file_index: Option<usize>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<(), String> {
    let _ = file_index;
    crate::np_info!("cmd", "open_source url={} append={}", url, append);
    let p = player_ref(&state)?;
    let lower = url.to_ascii_lowercase();
    let accepted = ["http://", "https://", "rtsp://", "rtmp://", "rtmps://", "mms://", "file://"]
        .iter()
        .any(|prefix| lower.starts_with(prefix));
    if !accepted {
        return Err("Unsupported URL scheme — lite build supports http/https/rtsp/rtmp/mms only".into());
    }
    let mode = if append { "append-play" } else { "replace" };
    p.command(&["loadfile", &url, mode])
}

// ── Stream cache (mpv-side tuning for network playback) ─────────────────────

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

// ── UI dormancy ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ui_dormant(state: State<'_, AppState>) -> Result<(), String> {
    state.ui.is_dormant.store(true, Ordering::Relaxed);
    if let Some(h) = state.ui.webview_hwnd_value() {
        crate::hide_webview(h);
    }
    Ok(())
}

#[tauri::command]
pub fn take_cli_file(state: State<'_, AppState>) -> Option<String> {
    state.cli_file.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
pub fn ui_wake(state: State<'_, AppState>) -> Result<(), String> {
    state.ui.is_dormant.store(false, Ordering::Relaxed);
    if let Some(h) = state.ui.webview_hwnd_value() {
        crate::show_webview(h);
    }
    Ok(())
}

// ── Picture-in-Picture ──────────────────────────────────────────────────────

const PIP_WIDTH: u32 = 480;
const PIP_HEIGHT: u32 = 270;
const PIP_MARGIN: i32 = 20;

#[tauri::command]
pub fn enter_pip(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};

    {
        let g = state.pip.saved.lock().map_err(|e| format!("pip lock: {e}"))?;
        if g.is_some() {
            return Ok(());
        }
    }

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
pub fn exit_pip(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
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

#[tauri::command]
pub async fn resize_mpv_to_parent(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use std::ffi::c_void;

        type HWND = *mut c_void;
        type BOOL = i32;

        #[repr(C)]
        struct RECT {
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
        }

        extern "system" {
            fn GetClientRect(hwnd: HWND, rect: *mut RECT) -> BOOL;
            fn PostMessageW(hwnd: HWND, msg: u32, wparam: usize, lparam: isize) -> BOOL;
        }

        const WM_SIZE: u32 = 0x0005;
        const SIZE_RESTORED: usize = 0;

        let hwnd = match window.window_handle() {
            Ok(h) => match h.as_raw() {
                RawWindowHandle::Win32(w) => w.hwnd.get() as HWND,
                _ => return Ok(()),
            },
            Err(_) => return Ok(()),
        };

        let mut rc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        unsafe {
            if GetClientRect(hwnd, &mut rc) == 0 {
                return Ok(());
            }
            let w = rc.right - rc.left;
            let h = rc.bottom - rc.top;
            let lparam_size = ((h as u32) << 16) | (w as u32 & 0xFFFF);
            PostMessageW(hwnd, WM_SIZE, SIZE_RESTORED, lparam_size as isize);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
    Ok(())
}
