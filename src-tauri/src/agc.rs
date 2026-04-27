// Real-time Automatic Gain Control.
//
// We add a labeled `astats` lavfi filter to the mpv audio chain when AGC is
// enabled. A background thread polls the filter's RMS metadata every ~40 ms,
// computes the gain needed to bring the source level into [min_db, max_db],
// smooths it with asymmetric attack/release, and applies it via mpv's
// `volume` property. The user's intended volume is tracked separately so the
// UI slider doesn't jiggle as AGC works under it.
//
// Output formula:
//   mpv_volume = clamp(user_volume * 10^(agc_gain_db / 20), 0, 200)

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::player::Player;
use crate::state::AgcController;

const TICK: Duration = Duration::from_millis(40);
// Asymmetric — cut hard peaks fast (ear-safety), boost quiet sections slow
// (avoids hearing the floor pump up between dialog beats).
const ATTACK_ALPHA: f64 = 0.55;
const RELEASE_ALPHA: f64 = 0.06;
// Below this, the source is effectively silent — skip so we don't try to
// boost background hiss to dialog level.
const SILENCE_DBFS: f64 = -85.0;

pub fn start_agc_loop(player: Arc<Player>, agc: Arc<AgcController>) {
    thread::spawn(move || loop {
        thread::sleep(TICK);

        if !agc.enabled.load(Ordering::Relaxed) {
            continue;
        }

        let rms = match player.get_property_f64(
            "af-metadata/agcstats/lavfi.astats.Overall.RMS_level",
        ) {
            Some(v) => v,
            None => continue,
        };

        if !rms.is_finite() || rms < SILENCE_DBFS {
            continue;
        }

        let mut params = match agc.params.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };

        let target = if rms < params.min_db {
            params.min_db - rms
        } else if rms > params.max_db {
            params.max_db - rms
        } else {
            // Inside the band — decay toward 0 so we don't stick at boost
            // forever once the loud part finishes.
            0.0
        };

        let alpha = if target < params.agc_gain_db {
            ATTACK_ALPHA
        } else {
            RELEASE_ALPHA
        };
        params.agc_gain_db += (target - params.agc_gain_db) * alpha;

        let mpv_vol =
            (params.user_volume * 10f64.powf(params.agc_gain_db / 20.0)).clamp(0.0, 200.0);

        drop(params);
        let _ = player.set_volume(mpv_vol);
    });
}
