use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{
    handle_archive_advance, handle_torrent_advance, parse_track_list, read_playlist,
    try_recover_archive_load, try_recover_torrent_load,
};
use crate::player::{MpvEvent, Player, MPV_FORMAT_DOUBLE, MPV_FORMAT_FLAG, MPV_FORMAT_NONE};
use crate::state::{AgcController, AppState, UiController};

const TAG_TIME_POS: u64 = 1;
const TAG_DURATION: u64 = 2;
const TAG_PAUSE: u64 = 3;
const TAG_VOLUME: u64 = 4;
const TAG_SPEED: u64 = 5;
const TAG_TRACKS: u64 = 6;
const TAG_SEEKABLE: u64 = 7;
const TAG_CORE_IDLE: u64 = 8;
const TAG_IDLE_ACTIVE: u64 = 9;
const TAG_CHAPTERS: u64 = 10;
const TAG_PLAYLIST: u64 = 11;
const TAG_PLAYLIST_POS: u64 = 12;
const TAG_PAUSED_FOR_CACHE: u64 = 13;
const TAG_CACHE_BUFFERING: u64 = 14;
// Fires whenever the VO displays a new video frame — not audio-clock-driven.
// Used as the definitive "frame actually changed on screen" signal.
const TAG_VIDEO_FRAME: u64 = 15;

#[derive(Serialize, Clone)]
pub struct Chapter {
    pub title: Option<String>,
    pub time: f64,
}

#[derive(Serialize, Clone)]
pub struct HdrInfo {
    pub format: String,    // "HDR10" | "HLG" | "DV" | "SDR"
    pub primaries: String, // raw mpv string
    pub gamma: String,
    pub matrix: String,
}

pub fn start_event_loop(
    app: AppHandle,
    player: Arc<Player>,
    agc: Arc<AgcController>,
    ui: Arc<UiController>,
) {
    let observers: &[(&str, std::os::raw::c_int, u64)] = &[
        ("time-pos", MPV_FORMAT_DOUBLE, TAG_TIME_POS),
        ("duration", MPV_FORMAT_DOUBLE, TAG_DURATION),
        ("pause", MPV_FORMAT_FLAG, TAG_PAUSE),
        ("volume", MPV_FORMAT_DOUBLE, TAG_VOLUME),
        ("speed", MPV_FORMAT_DOUBLE, TAG_SPEED),
        ("seekable", MPV_FORMAT_FLAG, TAG_SEEKABLE),
        ("core-idle", MPV_FORMAT_FLAG, TAG_CORE_IDLE),
        ("idle-active", MPV_FORMAT_FLAG, TAG_IDLE_ACTIVE),
        ("track-list", MPV_FORMAT_NONE, TAG_TRACKS),
        ("chapter-list", MPV_FORMAT_NONE, TAG_CHAPTERS),
        ("playlist", MPV_FORMAT_NONE, TAG_PLAYLIST),
        ("playlist-pos", MPV_FORMAT_NONE, TAG_PLAYLIST_POS),
        ("paused-for-cache", MPV_FORMAT_FLAG, TAG_PAUSED_FOR_CACHE),
        // Fires whenever the cache fill level changes while mpv is stalled.
        // -1 = not buffering; 0-100 = percent filled. Hitting 100 means mpv
        // is about to resume; the frontend uses this as the "ready to play"
        // progress bar instead of the misleading total-download percentage.
        (
            "cache-buffering-state",
            MPV_FORMAT_NONE,
            TAG_CACHE_BUFFERING,
        ),
        // Fires once per rendered frame at the VO. Only change that matters is
        // that a new frame was displayed — we never read the property value,
        // MPV_FORMAT_NONE is enough.
        ("video-frame-info", MPV_FORMAT_NONE, TAG_VIDEO_FRAME),
    ];

    for (name, fmt, tag) in observers {
        if let Err(e) = player.observe_property(name, *fmt, *tag) {
            crate::np_err!("events", "observe_property({name}) failed: {e}");
        }
    }
    // Pull mpv's internal log stream into our logger so libavformat/HTTP/
    // TLS/codec errors are visible in the dev console. "warn" balances
    // signal vs noise — "info" floods on every load, "error" is too quiet
    // for diagnosing why a network URL failed.
    if let Err(e) = player.request_log_messages("warn") {
        crate::np_err!("events", "request_log_messages failed: {e}");
    }
    crate::np_info!(
        "events",
        "event loop starting, observing {} properties",
        observers.len()
    );

    thread::spawn(move || {
        // Armed ONLY when paused-for-cache transitions false (cache refilled).
        // NOT armed on PLAYBACK_RESTART — that event fires multiple spurious
        // times after a seek (seek-ack, internal pipeline flush, etc.) long
        // before frames actually render, so using it caused premature dismissal.
        let mut pending_frame_dismiss = false;
        // Require this many consecutive video-frame-info changes before
        // emitting mpv:frame-changed. A single I-frame keyframe preview after
        // a seek produces only 1–2 changes then freezes; sustained playback
        // increments this counter past the threshold in under 250 ms at 24 fps.
        let mut frame_dismiss_count: u32 = 0;
        const FRAME_DISMISS_THRESHOLD: u32 = 5;

        loop {
            match player.wait_event(-1.0) {
                MpvEvent::PropertyChange { tag } => {
                    if tag == TAG_VIDEO_FRAME {
                        if pending_frame_dismiss {
                            frame_dismiss_count += 1;
                            crate::np_debug!(
                                "events",
                                "frame-dismiss count={}/{}",
                                frame_dismiss_count,
                                FRAME_DISMISS_THRESHOLD
                            );
                            if frame_dismiss_count >= FRAME_DISMISS_THRESHOLD {
                                pending_frame_dismiss = false;
                                frame_dismiss_count = 0;
                                let _ = app.emit("mpv:frame-changed", ());
                            }
                        }
                    } else {
                        handle_property_change(
                            &app,
                            &player,
                            &agc,
                            &ui,
                            tag,
                            &mut pending_frame_dismiss,
                            &mut frame_dismiss_count,
                        );
                    }
                }
                MpvEvent::FileLoaded => {
                    // Path string is sent so the frontend can kick thumbnailing
                    // for whichever file mpv just loaded — important for
                    // auto-advance from playlist where loadPath isn't called.
                    let path = player.get_string_prop_pub("path").unwrap_or_default();
                    crate::np_info!("events", "FILE_LOADED path={}", path);
                    // mpv's pause observer fires only on VALUE CHANGES. Since mpv
                    // defaults to pause=false, loading a file keeps it false and
                    // the observer never fires. Emit explicitly so the frontend
                    // isPlaying reflects the actual backend state on every file load.
                    if let Some(paused) = player.get_property_flag("pause") {
                        let _ = app.emit("mpv:pause", paused);
                    }
                    // Lazy-prefetch hook: if the new file is a torrent stream URL,
                    // tell rqbit to widen its "wanted" window. No-op (and clears
                    // the active marker) when the new file isn't a torrent.
                    let st: tauri::State<'_, AppState> = app.state();
                    handle_torrent_advance(st.inner(), &path);
                    // Same idea for archives: if the new path is inside a
                    // registered archive cache, kick the next-entry prefetch
                    // and rotate the active-paths set.
                    handle_archive_advance(st.inner(), &path);
                    if let Err(e) = app.emit("mpv:file-loaded", path) {
                        eprintln!("[events] emit failed: {e}");
                    }
                    emit_tracks(&app, &player);
                    emit_chapters(&app, &player);
                    emit_hdr_info(&app, &player);
                    emit_playlist(&app, &player);
                }
                MpvEvent::EndFile { reason, error } => {
                    crate::np_info!("events", "END_FILE reason={reason} error={error}");
                    let is_error = reason == crate::player::MPV_END_FILE_REASON_ERROR;
                    // Archive recovery: if the failed path is inside a
                    // registered archive cache, that means mpv tried to load an
                    // entry we hadn't extracted yet (manual skip past the
                    // prefetch window). Extract it off-thread and re-issue
                    // loadfile so the user sees a brief stall, then playback —
                    // not a hard error. Skip the auth-classification toast
                    // path in that case.
                    if is_error {
                        let cur_path = player.get_string_prop_pub("path").unwrap_or_default();
                        if !cur_path.is_empty() {
                            let st: tauri::State<'_, AppState> = app.state();
                            // Torrent stream refused (file not in wanted window)
                            // → widen window + loadfile-replace. Checked first
                            // because a torrent URL can't be an archive path.
                            if try_recover_torrent_load(st.inner(), &app, &cur_path) {
                                continue;
                            }
                            if try_recover_archive_load(st.inner(), &app, &cur_path) {
                                continue;
                            }
                        }
                    }
                    #[derive(Serialize, Clone)]
                    struct EofPayload {
                        reason: i32,
                        error: i32,
                        is_error: bool,
                    }
                    if let Err(e) = app.emit(
                        "mpv:eof",
                        EofPayload {
                            reason,
                            error,
                            is_error,
                        },
                    ) {
                        eprintln!("[events] emit failed: {e}");
                    }
                }
                MpvEvent::ClientMessage { args } => {
                    handle_client_message(&app, &ui, args);
                }
                MpvEvent::LogMessage {
                    prefix,
                    level,
                    text,
                } => {
                    // Forward to whichever np_* macro matches mpv's level so the
                    // dev console formatting/severity stays consistent.
                    let tag = if prefix.is_empty() { "mpv" } else { &prefix };
                    match level.as_str() {
                        "fatal" | "error" => crate::np_err!(tag, "{}", text),
                        "warn" => crate::np_warn!(tag, "{}", text),
                        _ => crate::np_info!(tag, "{}", text),
                    }
                }
                MpvEvent::Shutdown => {
                    crate::np_info!("events", "SHUTDOWN — event loop exiting");
                    break;
                }
                MpvEvent::PlaybackRestart => {
                    crate::np_debug!("events", "PLAYBACK_RESTART");
                    // Arm the frame-dismiss and reset the count. Resetting on every
                    // restart means only N *consecutive* frames after the most recent
                    // pipeline restart are counted — old partial counts from earlier
                    // spurious restarts can't bleed into the final check.
                    // paused-for-cache=true will disarm if buffering starts, so a
                    // spurious early restart followed by a stall is safe.
                    pending_frame_dismiss = true;
                    frame_dismiss_count = 0;
                    let _ = app.emit("mpv:playback-restart", ());
                }
                MpvEvent::None | MpvEvent::StartFile | MpvEvent::Other => {}
            }
        }
    });
}

fn handle_property_change(
    app: &AppHandle,
    player: &Player,
    agc: &AgcController,
    ui: &UiController,
    tag: u64,
    pending_frame_dismiss: &mut bool,
    frame_dismiss_count: &mut u32,
) {
    // High-frequency properties (time-pos updates ~10×/s) are not logged here;
    // logging them would dwarf everything else. Lower-frequency state changes
    // ARE logged for diagnostics.
    match tag {
        TAG_TIME_POS => {
            // While the WebView is dormant (idle hidden), there is nothing
            // to render — drop the IPC entirely. Saves ~10 cross-process
            // messages per second + JSON serde + JS event dispatch.
            if ui.is_dormant.load(Ordering::Relaxed) {
                return;
            }
            if let Some(v) = player.get_property_f64("time-pos") {
                if let Err(e) = app.emit("mpv:time-pos", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_DURATION => {
            if let Some(v) = player.get_property_f64("duration") {
                crate::np_info!("events", "duration={:.3}s", v);
                if let Err(e) = app.emit("mpv:duration", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_PAUSE => {
            if let Some(v) = player.get_property_flag("pause") {
                crate::np_info!("events", "pause={}", v);
                if let Err(e) = app.emit("mpv:pause", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_VOLUME => {
            // Suppressed while AGC is active; see notes in agc.rs.
            if !agc.enabled.load(Ordering::Relaxed) {
                if let Some(v) = player.get_property_f64("volume") {
                    if let Err(e) = app.emit("mpv:volume", v) {
                        eprintln!("[events] emit failed: {e}");
                    }
                }
            }
        }
        TAG_SPEED => {
            if let Some(v) = player.get_property_f64("speed") {
                crate::np_info!("events", "speed={:.3}x", v);
                if let Err(e) = app.emit("mpv:speed", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_SEEKABLE => {
            if let Some(v) = player.get_property_flag("seekable") {
                crate::np_debug!("events", "seekable={}", v);
                if let Err(e) = app.emit("mpv:seekable", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_CORE_IDLE => {
            if let Some(v) = player.get_property_flag("core-idle") {
                if let Err(e) = app.emit("mpv:core-idle", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_IDLE_ACTIVE => {
            if let Some(v) = player.get_property_flag("idle-active") {
                if let Err(e) = app.emit("mpv:idle-active", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_PAUSED_FOR_CACHE => {
            if let Some(v) = player.get_property_flag("paused-for-cache") {
                if v {
                    // New stall: cancel pending dismiss and reset frame count
                    // so a stale partial count from a prior cycle can't bleed
                    // into the next one.
                    *pending_frame_dismiss = false;
                    *frame_dismiss_count = 0;
                } else {
                    // Cache refilled: arm dismiss and clear counter. We wait
                    // for FRAME_DISMISS_THRESHOLD consecutive video-frame-info
                    // changes before signalling JS — a single keyframe preview
                    // only produces 1-2 changes then stalls, sustained playback
                    // hits the threshold in under 250 ms at 24 fps.
                    *pending_frame_dismiss = true;
                    *frame_dismiss_count = 0;
                }
                if let Err(e) = app.emit("mpv:paused-for-cache", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_CACHE_BUFFERING => {
            // -1 = not buffering, 0-100 = cache fill level while stalled.
            // Value of 100 means the cache is full and playback is resuming.
            if let Some(v) = player.get_int_prop("cache-buffering-state") {
                if let Err(e) = app.emit("mpv:cache-buffering", v) {
                    eprintln!("[events] emit failed: {e}");
                }
            }
        }
        TAG_TRACKS => {
            crate::np_debug!("events", "tracks changed");
            emit_tracks(app, player);
        }
        TAG_CHAPTERS => {
            crate::np_debug!("events", "chapters changed");
            emit_chapters(app, player);
        }
        TAG_PLAYLIST | TAG_PLAYLIST_POS => {
            crate::np_debug!("events", "playlist changed");
            emit_playlist(app, player);
        }
        _ => {}
    }
}

/// `script-message <name>` from mpv arrives here. The only message we forward
/// is `ui-wake`. Two cases:
///   - WebView is hidden (is_dormant=true): un-hide it, flip the flag, and
///     emit `ui:wake` so JS re-opens the controls.
///   - WebView is visible but controls have auto-hidden: emit `ui:wake` so
///     JS shows the bar again. The mpv child captures mouse events when the
///     cursor is over the video area, so the React `onMouseMove` path on
///     the WebView never fires — without this branch the controls only
///     come back on keypress.
/// Rate-limited to 500 ms because MOUSE_MOVE fires per pixel and JS only
/// needs one wake per hide-timer cycle to keep the bar up.
fn handle_client_message(app: &AppHandle, ui: &UiController, args: Vec<String>) {
    let Some(name) = args.first() else { return };
    if name != "ui-wake" {
        return;
    }
    let was_dormant = ui
        .is_dormant
        .compare_exchange(true, false, Ordering::AcqRel, Ordering::Relaxed)
        .is_ok();

    if !was_dormant {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let last = ui.last_wake_emit_ms.load(Ordering::Relaxed);
        if now_ms.saturating_sub(last) < 500 {
            return;
        }
        ui.last_wake_emit_ms.store(now_ms, Ordering::Relaxed);
    } else {
        if let Some(hwnd) = ui.webview_hwnd_value() {
            crate::show_webview(hwnd);
        }
        crate::np_info!("ui", "wake (mpv input, was dormant)");
        // Reset the rate-limit window so the next non-dormant wake doesn't
        // get rejected immediately after we come out of dormancy.
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        ui.last_wake_emit_ms.store(now_ms, Ordering::Relaxed);
    }

    if let Err(e) = app.emit("ui:wake", ()) {
        eprintln!("[events] emit failed: {e}");
    }
}

fn emit_playlist(app: &AppHandle, player: &Player) {
    let items = read_playlist(player);
    if let Err(e) = app.emit("mpv:playlist", items) {
        eprintln!("[events] emit failed: {e}");
    }
}

fn emit_tracks(app: &AppHandle, player: &Player) {
    let json = player
        .get_property_string("track-list")
        .unwrap_or_else(|| "[]".to_string());
    let tracks = parse_track_list(&json);
    if let Err(e) = app.emit("mpv:tracks", tracks) {
        eprintln!("[events] emit failed: {e}");
    }
}

fn emit_chapters(app: &AppHandle, player: &Player) {
    let json = player
        .get_property_string("chapter-list")
        .unwrap_or_else(|| "[]".to_string());
    let parsed: Vec<Chapter> = serde_json::from_str::<Value>(&json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|c| Chapter {
            title: c
                .get("title")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string()),
            time: c.get("time").and_then(|t| t.as_f64()).unwrap_or(0.0),
        })
        .collect();
    if let Err(e) = app.emit("mpv:chapters", parsed) {
        eprintln!("[events] emit failed: {e}");
    }
}

fn emit_hdr_info(app: &AppHandle, player: &Player) {
    let gamma = player
        .get_property_string("video-params/gamma")
        .unwrap_or_default();
    let primaries = player
        .get_property_string("video-params/primaries")
        .unwrap_or_default();
    let matrix = player
        .get_property_string("video-params/colormatrix")
        .unwrap_or_default();

    let format = match gamma.as_str() {
        "pq" => "HDR10",
        "hlg" => "HLG",
        "dovi" => "DV",
        _ => "SDR",
    }
    .to_string();

    if let Err(e) = app.emit(
        "mpv:hdr-info",
        HdrInfo {
            format,
            primaries,
            gamma,
            matrix,
        },
    ) {
        eprintln!("[events] emit failed: {e}");
    }
}
