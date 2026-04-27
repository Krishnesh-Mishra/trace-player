use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::commands::{parse_track_list, read_playlist};
use crate::player::{MpvEvent, Player, MPV_FORMAT_DOUBLE, MPV_FORMAT_FLAG, MPV_FORMAT_NONE};
use crate::state::AgcController;

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

pub fn start_event_loop(app: AppHandle, player: Arc<Player>, agc: Arc<AgcController>) {
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
    ];

    for (name, fmt, tag) in observers {
        if let Err(e) = player.observe_property(name, *fmt, *tag) {
            crate::np_err!("events", "observe_property({name}) failed: {e}");
        }
    }
    crate::np_info!("events", "event loop starting, observing {} properties", observers.len());

    thread::spawn(move || loop {
        match player.wait_event(-1.0) {
            MpvEvent::PropertyChange { tag } => {
                handle_property_change(&app, &player, &agc, tag);
            }
            MpvEvent::FileLoaded => {
                // Path string is sent so the frontend can kick thumbnailing
                // for whichever file mpv just loaded — important for
                // auto-advance from playlist where loadPath isn't called.
                let path = player
                    .get_string_prop_pub("path")
                    .unwrap_or_default();
                crate::np_info!("events", "FILE_LOADED path={}", path);
                let _ = app.emit("mpv:file-loaded", path);
                emit_tracks(&app, &player);
                emit_chapters(&app, &player);
                emit_hdr_info(&app, &player);
                emit_playlist(&app, &player);
            }
            MpvEvent::EndFile => {
                crate::np_info!("events", "END_FILE");
                let _ = app.emit("mpv:eof", ());
            }
            MpvEvent::Shutdown => {
                crate::np_info!("events", "SHUTDOWN — event loop exiting");
                break;
            }
            MpvEvent::PlaybackRestart => {
                crate::np_debug!("events", "PLAYBACK_RESTART");
            }
            MpvEvent::Other => {}
        }
    });
}

fn handle_property_change(app: &AppHandle, player: &Player, agc: &AgcController, tag: u64) {
    // High-frequency properties (time-pos updates ~10×/s) are not logged here;
    // logging them would dwarf everything else. Lower-frequency state changes
    // ARE logged for diagnostics.
    match tag {
        TAG_TIME_POS => {
            if let Some(v) = player.get_property_f64("time-pos") {
                let _ = app.emit("mpv:time-pos", v);
            }
        }
        TAG_DURATION => {
            if let Some(v) = player.get_property_f64("duration") {
                crate::np_info!("events", "duration={:.3}s", v);
                let _ = app.emit("mpv:duration", v);
            }
        }
        TAG_PAUSE => {
            if let Some(v) = player.get_property_flag("pause") {
                crate::np_info!("events", "pause={}", v);
                let _ = app.emit("mpv:pause", v);
            }
        }
        TAG_VOLUME => {
            // Suppressed while AGC is active; see notes in agc.rs.
            if !agc.enabled.load(Ordering::Relaxed) {
                if let Some(v) = player.get_property_f64("volume") {
                    let _ = app.emit("mpv:volume", v);
                }
            }
        }
        TAG_SPEED => {
            if let Some(v) = player.get_property_f64("speed") {
                crate::np_info!("events", "speed={:.3}x", v);
                let _ = app.emit("mpv:speed", v);
            }
        }
        TAG_SEEKABLE => {
            if let Some(v) = player.get_property_flag("seekable") {
                crate::np_debug!("events", "seekable={}", v);
                let _ = app.emit("mpv:seekable", v);
            }
        }
        TAG_CORE_IDLE => {
            if let Some(v) = player.get_property_flag("core-idle") {
                let _ = app.emit("mpv:core-idle", v);
            }
        }
        TAG_IDLE_ACTIVE => {
            if let Some(v) = player.get_property_flag("idle-active") {
                let _ = app.emit("mpv:idle-active", v);
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

fn emit_playlist(app: &AppHandle, player: &Player) {
    let items = read_playlist(player);
    let _ = app.emit("mpv:playlist", items);
}

fn emit_tracks(app: &AppHandle, player: &Player) {
    let json = player
        .get_property_string("track-list")
        .unwrap_or_else(|| "[]".to_string());
    let tracks = parse_track_list(&json);
    let _ = app.emit("mpv:tracks", tracks);
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
    let _ = app.emit("mpv:chapters", parsed);
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

    let _ = app.emit(
        "mpv:hdr-info",
        HdrInfo {
            format,
            primaries,
            gamma,
            matrix,
        },
    );
}
