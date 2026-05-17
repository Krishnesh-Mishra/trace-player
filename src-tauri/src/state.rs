use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::archive::ArchiveRegistry;
use crate::player::Player;
use crate::streaming::StreamingSession;

// ── AGC ─────────────────────────────────────────────────────────────────────

/// Live AGC (Automatic Gain Control) state. Volume nudges happen on a
/// polling thread; user_volume is tracked separately so the UI slider stays
/// put while AGC adjusts mpv's volume property under it.
pub struct AgcController {
    pub enabled: AtomicBool,
    pub params: Mutex<AgcParams>,
    pub shutdown: Arc<std::sync::atomic::AtomicBool>,
}

pub struct AgcParams {
    pub min_db: f64,
    pub max_db: f64,
    pub user_volume: f64,
    pub agc_gain_db: f64,
}

impl AgcController {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            params: Mutex::new(AgcParams {
                min_db: -30.0,
                max_db: -6.0,
                user_volume: 80.0,
                agc_gain_db: 0.0,
            }),
            shutdown: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn stop(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

// ── Performance / Power ─────────────────────────────────────────────────────

/// Performance profile + battery state. The active profile string is stored
/// so the power-detection thread can re-resolve "auto" without keeping its
/// own enum copy. shader_dir is set once at startup from the Tauri resource
/// dir and read by perf::apply_upscaling.
pub struct PerfController {
    pub profile: Mutex<String>, // serialized PerfProfile
    pub on_battery: AtomicBool,
    pub shader_dir: Mutex<Option<PathBuf>>,
}

impl PerfController {
    pub fn new() -> Self {
        Self {
            profile: Mutex::new("auto".to_string()),
            on_battery: AtomicBool::new(false),
            shader_dir: Mutex::new(None),
        }
    }

    pub fn set_shader_dir(&self, dir: PathBuf) {
        match self.shader_dir.lock() {
            Ok(mut g) => {
                *g = Some(dir);
            }
            Err(e) => {
                eprintln!("[state] shader_dir lock poisoned: {e}");
            }
        }
    }

    pub fn shader_dir_clone(&self) -> Option<PathBuf> {
        self.shader_dir.lock().ok().and_then(|g| g.clone())
    }

    pub fn set_profile(&self, name: &str) {
        if let Ok(mut g) = self.profile.lock() {
            *g = name.to_string();
        }
    }

    #[allow(dead_code)]
    pub fn current_profile(&self) -> String {
        self.profile
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "auto".to_string())
    }

    pub fn is_on_battery(&self) -> bool {
        self.on_battery.load(Ordering::Relaxed)
    }
}

// ── App ─────────────────────────────────────────────────────────────────────

/// Pre-PiP window geometry, stashed so exit_pip can restore the window to
/// where the user had it. None when not currently in PiP.
#[derive(Clone, Debug)]
pub struct PipGeometry {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub decorations: bool,
}

pub struct PipMemory {
    pub saved: Mutex<Option<PipGeometry>>,
}

impl PipMemory {
    pub fn new() -> Self {
        Self {
            saved: Mutex::new(None),
        }
    }
}

// ── UI dormancy ─────────────────────────────────────────────────────────────

/// Tracks whether the WebView overlay is currently hidden for power saving.
/// `webview_hwnd` is the cached HWND of the WebView2 child window (Windows
/// only) found at startup so subsequent show/hide calls don't re-enumerate.
/// `is_dormant` is the source of truth — checked by the mpv event loop so a
/// MOUSE_MOVE storm only emits one ui:wake per dormancy cycle.
pub struct UiController {
    pub is_dormant: AtomicBool,
    pub webview_hwnd: Mutex<Option<isize>>,
}

impl UiController {
    pub fn new() -> Self {
        Self {
            is_dormant: AtomicBool::new(false),
            webview_hwnd: Mutex::new(None),
        }
    }

    pub fn set_webview_hwnd(&self, hwnd: isize) {
        if let Ok(mut g) = self.webview_hwnd.lock() {
            *g = Some(hwnd);
        }
    }

    pub fn webview_hwnd_value(&self) -> Option<isize> {
        self.webview_hwnd.lock().ok().and_then(|g| *g)
    }
}

// ── Torrent session tracking ────────────────────────────────────────────────

/// Snapshot of the currently-playing torrent file. Used by the events thread
/// to drive lazy per-file priority: when this changes (mpv loads a new file),
/// the handler tells rqbit which file indices are now wanted.
///
/// `prev_idx` is the previous file index in the same torrent — used to
/// classify natural advance (delta=+1, prefetch one ahead) vs manual skip
/// (delta>1 or backwards, prefetch two ahead so the user has buffer if they
/// skip again).
#[derive(Clone, Debug)]
pub struct ActiveTorrentItem {
    pub torrent_id: u32,
    pub file_idx: usize,
    #[allow(dead_code)]
    pub prev_idx: Option<usize>,
}

pub struct AppState {
    pub player: Option<Arc<Player>>,
    pub thumbnailer: Option<Arc<Player>>,
    pub agc: Arc<AgcController>,
    pub perf: Arc<PerfController>,
    pub pip: Arc<PipMemory>,
    pub ui: Arc<UiController>,
    /// Lazy rqbit.exe sidecar — None until the first magnet/torrent open.
    pub streaming: Arc<Mutex<Option<StreamingSession>>>,
    /// All torrent IDs added during this session — drained on shutdown so
    /// rqbit's `forget` is called before we kill the sidecar.
    pub torrent_ids: Arc<Mutex<HashSet<u32>>>,
    /// Currently-playing torrent file (None when current source is not a
    /// torrent stream). Drives the events.rs prefetch logic.
    pub active_torrent: Arc<Mutex<Option<ActiveTorrentItem>>>,
    /// All video file indices for the currently-loaded torrent. Populated in
    /// load_torrent_into_playlist from the full file list rqbit returned.
    /// handle_torrent_advance passes ALL of these to set_only_files so every
    /// episode is always "wanted" — without this, jumping past the prefetch
    /// window caused rqbit to refuse the stream and mpv to error out.
    pub torrent_video_idxs: Arc<Mutex<Vec<usize>>>,
    /// Per-file metadata for the current torrent: (file_index, stream_url, byte_size).
    /// Used by the seek command to calculate byte offsets and pre-announce the
    /// new playback position to rqbit so it can reprioritize piece downloads.
    pub torrent_video_files: Arc<Mutex<Vec<(usize, String, u64)>>>,
    /// Open archives (zip/7z/rar) the user has loaded into the playlist.
    /// Indexed by cache_dir; events.rs consults this to extract-on-demand
    /// when mpv tries to load a cache path that doesn't exist yet.
    pub archive_registry: Arc<Mutex<ArchiveRegistry>>,
    /// Last archive cache path mpv successfully loaded. Used to remove
    /// stale entries from the active-paths set when the user advances.
    pub active_archive_path: Arc<Mutex<Option<PathBuf>>>,
    /// Set the first time `ensure_streaming` succeeds so the per-second
    /// torrent-stats polling thread is only spawned once.
    pub stats_poller_started: AtomicBool,
    /// Max torrent cache size in bytes (0 = no limit). Eviction runs after
    /// sources are dropped. Set by the frontend via `set_torrent_cache_limit`.
    pub cache_limit_bytes: std::sync::atomic::AtomicU64,
    /// Torrent ID currently being resolved in `resolve_torrent_files`.
    /// Set after `add_magnet` returns so `cancel_torrent_resolve` can forget it.
    pub resolving_torrent_id: Mutex<Option<u32>>,
}

impl AppState {
    pub fn new(player: Option<Arc<Player>>, thumbnailer: Option<Arc<Player>>) -> Self {
        Self {
            player,
            thumbnailer,
            agc: Arc::new(AgcController::new()),
            perf: Arc::new(PerfController::new()),
            pip: Arc::new(PipMemory::new()),
            ui: Arc::new(UiController::new()),
            streaming: Arc::new(Mutex::new(None)),
            torrent_ids: Arc::new(Mutex::new(HashSet::new())),
            active_torrent: Arc::new(Mutex::new(None)),
            torrent_video_idxs: Arc::new(Mutex::new(Vec::new())),
            torrent_video_files: Arc::new(Mutex::new(Vec::new())),
            archive_registry: Arc::new(Mutex::new(ArchiveRegistry::new())),
            active_archive_path: Arc::new(Mutex::new(None)),
            stats_poller_started: AtomicBool::new(false),
            cache_limit_bytes: std::sync::atomic::AtomicU64::new(0),
            resolving_torrent_id: Mutex::new(None),
        }
    }
}
