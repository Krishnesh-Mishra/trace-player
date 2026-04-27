// Battery / AC detection. Polls Win32 GetSystemPowerStatus once every 30 s
// and emits `mpv:power-state { on_battery: bool }` whenever the state flips.
// Also pushes the change into AppState.perf so the next file-load and the
// AGC/perf appliers can read it without polling Win32 themselves.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::state::AgcController; // unused for now — kept for future hooks
use crate::state::PerfController;

const POLL_INTERVAL: Duration = Duration::from_secs(30);

#[cfg(target_os = "windows")]
mod winpower {
    #[repr(C)]
    pub struct SystemPowerStatus {
        pub ac_line_status: u8,
        pub battery_flag: u8,
        pub battery_life_percent: u8,
        pub system_status_flag: u8,
        pub battery_life_time: u32,
        pub battery_full_life_time: u32,
    }

    extern "system" {
        pub fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }
}

/// Returns Some(true) if running on battery, Some(false) on AC, None if
/// unknown (desktop without battery, or non-Windows).
pub fn is_on_battery() -> Option<bool> {
    #[cfg(target_os = "windows")]
    {
        let mut s = winpower::SystemPowerStatus {
            ac_line_status: 255,
            battery_flag: 255,
            battery_life_percent: 255,
            system_status_flag: 0,
            battery_life_time: 0,
            battery_full_life_time: 0,
        };
        let ok = unsafe { winpower::GetSystemPowerStatus(&mut s) };
        if ok == 0 {
            return None;
        }
        match s.ac_line_status {
            0 => Some(true),
            1 => Some(false),
            _ => None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

pub fn start_power_loop(
    app: AppHandle,
    perf: Arc<PerfController>,
    on_battery_change: impl Fn(&AppHandle, bool) + Send + 'static,
) {
    thread::spawn(move || {
        let mut last: Option<bool> = None;
        loop {
            let now = is_on_battery();
            if let Some(on_batt) = now {
                let prev = perf.on_battery.swap(on_batt, Ordering::Relaxed);
                if last.is_none() || last != Some(on_batt) {
                    last = Some(on_batt);
                    let _ = app.emit("mpv:power-state", on_batt);
                    if prev != on_batt {
                        on_battery_change(&app, on_batt);
                    }
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

// Suppress dead-code warning for the unused import on the AGC re-export.
#[allow(dead_code)]
fn _agc_marker(_: &AgcController) {}
