use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::player::Player;

// ── AGC ─────────────────────────────────────────────────────────────────────

/// Live AGC (Automatic Gain Control) state. Kept (though disabled by default
/// in the lite build) because `set_volume` still threads through it — user_volume
/// is tracked separately from mpv's actual volume property so future AGC work
/// can re-enable without touching the volume call sites.
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

pub struct PerfController {
    pub profile: Mutex<String>,
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
        if let Ok(mut g) = self.shader_dir.lock() {
            *g = Some(dir);
        }
    }

    pub fn shader_dir_clone(&self) -> Option<PathBuf> {
        self.shader_dir.lock().ok().and_then(|g| g.clone())
    }

    #[allow(dead_code)]
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

// ── PiP ─────────────────────────────────────────────────────────────────────

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

pub struct UiController {
    pub is_dormant: AtomicBool,
    pub webview_hwnd: Mutex<Option<isize>>,
    pub last_wake_emit_ms: AtomicU64,
}

impl UiController {
    pub fn new() -> Self {
        Self {
            is_dormant: AtomicBool::new(false),
            webview_hwnd: Mutex::new(None),
            last_wake_emit_ms: AtomicU64::new(0),
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

// ── App ─────────────────────────────────────────────────────────────────────

pub struct AppState {
    pub player: Option<Arc<Player>>,
    pub thumbnailer: Mutex<Option<Arc<Player>>>,
    pub agc: Arc<AgcController>,
    pub perf: Arc<PerfController>,
    pub pip: Arc<PipMemory>,
    pub ui: Arc<UiController>,
    pub cli_file: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(player: Option<Arc<Player>>) -> Self {
        Self {
            player,
            thumbnailer: Mutex::new(None),
            agc: Arc::new(AgcController::new()),
            perf: Arc::new(PerfController::new()),
            pip: Arc::new(PipMemory::new()),
            ui: Arc::new(UiController::new()),
            cli_file: Mutex::new(None),
        }
    }

    pub fn get_or_init_thumbnailer(&self) -> Option<Arc<Player>> {
        let mut guard = self.thumbnailer.lock().ok()?;
        if let Some(p) = guard.as_ref() {
            return Some(p.clone());
        }
        match Player::new_thumbnailer() {
            Ok(p) => {
                let arc = Arc::new(p);
                *guard = Some(arc.clone());
                crate::np_info!("boot", "thumbnailer mpv lazily created");
                Some(arc)
            }
            Err(e) => {
                crate::np_err!("boot", "thumbnailer mpv init failed: {e}");
                None
            }
        }
    }
}
