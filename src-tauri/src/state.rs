use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::player::Player;

// ── AGC ─────────────────────────────────────────────────────────────────────

/// Live AGC (Automatic Gain Control) state. Volume nudges happen on a
/// polling thread; user_volume is tracked separately so the UI slider stays
/// put while AGC adjusts mpv's volume property under it.
pub struct AgcController {
    pub enabled: AtomicBool,
    pub params: Mutex<AgcParams>,
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
        }
    }
}

// ── Performance / Power ─────────────────────────────────────────────────────

/// Performance profile + battery state. The active profile string is stored
/// so the power-detection thread can re-resolve "auto" without keeping its
/// own enum copy. shader_dir is set once at startup from the Tauri resource
/// dir and read by perf::apply_upscaling.
pub struct PerfController {
    pub profile: Mutex<String>,        // serialized PerfProfile
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
        Self { saved: Mutex::new(None) }
    }
}

pub struct AppState {
    pub player: Option<Arc<Player>>,
    pub thumbnailer: Option<Arc<Player>>,
    pub agc: Arc<AgcController>,
    pub perf: Arc<PerfController>,
    pub pip: Arc<PipMemory>,
}

impl AppState {
    pub fn new(player: Option<Arc<Player>>, thumbnailer: Option<Arc<Player>>) -> Self {
        Self {
            player,
            thumbnailer,
            agc: Arc::new(AgcController::new()),
            perf: Arc::new(PerfController::new()),
            pip: Arc::new(PipMemory::new()),
        }
    }
}
