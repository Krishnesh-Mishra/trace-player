// Performance profile applier.
//
// Translates a profile choice (Auto / Battery Saver / Balanced / Best Quality
// / Custom) into the underlying mpv property writes. When profile == Auto, the
// effective profile is BatterySaver while on battery and Balanced on AC.
// Custom is a no-op — used as a marker when the user has hand-tweaked one of
// the underlying knobs (HDR, Upscaling, Interpolation) so the umbrella stops
// fighting them.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::player::Player;
use crate::state::PerfController;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PerfProfile {
    Auto,
    BatterySaver,
    Balanced,
    BestQuality,
    Custom,
}

impl PerfProfile {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "auto" => Some(Self::Auto),
            "battery_saver" => Some(Self::BatterySaver),
            "balanced" => Some(Self::Balanced),
            "best_quality" => Some(Self::BestQuality),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::BatterySaver => "battery_saver",
            Self::Balanced => "balanced",
            Self::BestQuality => "best_quality",
            Self::Custom => "custom",
        }
    }
}

/// What a profile actually translates to. Frontend mirrors these into its
/// HDR / Upscaling / Interpolation / VSync state so the drill-down pages
/// reflect the active settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPerf {
    pub effective: String,     // what we actually applied
    pub upscaling: String,     // off | low | medium
    pub interpolation: String, // off | smooth | cinematic
    pub hdr_mode: String,      // auto | passthrough | tone_map | sdr
    pub vsync: bool,
}

pub fn resolve(profile: PerfProfile, on_battery: bool) -> Option<ResolvedPerf> {
    let effective = match profile {
        PerfProfile::Auto => {
            if on_battery {
                PerfProfile::BatterySaver
            } else {
                PerfProfile::Balanced
            }
        }
        PerfProfile::Custom => return None, // user controls knobs directly
        other => other,
    };

    Some(match effective {
        PerfProfile::BatterySaver => ResolvedPerf {
            effective: "battery_saver".to_string(),
            upscaling: "off".to_string(),
            interpolation: "off".to_string(),
            hdr_mode: "auto".to_string(),
            vsync: false,
        },
        PerfProfile::Balanced => ResolvedPerf {
            effective: "balanced".to_string(),
            upscaling: "low".to_string(),
            interpolation: "off".to_string(),
            hdr_mode: "auto".to_string(),
            vsync: true,
        },
        PerfProfile::BestQuality => ResolvedPerf {
            effective: "best_quality".to_string(),
            upscaling: "medium".to_string(),
            interpolation: "cinematic".to_string(),
            hdr_mode: "auto".to_string(),
            vsync: true,
        },
        // Auto + Custom are handled above.
        _ => unreachable!(),
    })
}

/// Apply a resolved profile to the live mpv player.
pub fn apply(
    player: &Player,
    resolved: &ResolvedPerf,
    shader_dir: Option<&PathBuf>,
) -> Result<(), String> {
    let is_battery_saver = resolved.effective == "battery_saver";
    // Battery-saver baseline first so the per-feature applies below can still
    // override individual knobs if needed. When leaving battery mode this
    // restores the quality defaults that profile=fast knocked down.
    apply_battery_extras(player, is_battery_saver)?;
    apply_upscaling(player, &resolved.upscaling, shader_dir)?;
    apply_interpolation(player, &resolved.interpolation)?;
    apply_hdr(player, &resolved.hdr_mode)?;
    // In battery mode video-sync is already pinned to "audio" by the extras;
    // honouring resolved.vsync would just flip back to display-resample.
    if !is_battery_saver {
        apply_vsync(player, resolved.vsync)?;
    }
    Ok(())
}

/// Battery-saver-only extras. Toggles the heavier render-side knobs that the
/// upscaling / interpolation appliers don't touch. Run with `true` when
/// entering BatterySaver, `false` when leaving — the false branch undoes the
/// quality-killing parts of `profile=fast` so the next profile starts clean.
pub fn apply_battery_extras(player: &Player, is_battery_saver: bool) -> Result<(), String> {
    if is_battery_saver {
        // mpv's built-in low-power preset. Sets a bunch of knobs at once:
        // bilinear scalers, no deband, no dither, no HDR peak detect,
        // video-sync=audio. We re-set the same values explicitly below so
        // the inverse branch can revert them deterministically.
        let _ = player.set_string_prop_pub("profile", "fast");
        // Cheapest scaler chain end-to-end — luma + chroma + downscale.
        let _ = player.set_string_prop_pub("scale", "bilinear");
        let _ = player.set_string_prop_pub("cscale", "bilinear");
        let _ = player.set_string_prop_pub("dscale", "bilinear");
        // Visible-quality knobs that cost real GPU power.
        let _ = player.set_string_prop_pub("deband", "no");
        let _ = player.set_string_prop_pub("dither-depth", "no");
        let _ = player.set_string_prop_pub("hdr-compute-peak", "no");
        // Decode shortcut — skip in-loop deblock filter on non-reference
        // frames. Saves ~5-10% decoder CPU on H.264/HEVC at a quality cost
        // that's barely perceptible on a laptop panel.
        let _ = player.set_string_prop_pub("vd-lavc-skiploopfilter", "nonref");
        // audio sync drops display-resample's per-frame CPU + GPU work.
        let _ = player.set_string_prop_pub("video-sync", "audio");
    } else {
        // Restore the quality defaults set in Player::new(). The scaler
        // chain (scale/cscale/dscale) is re-set by apply_upscaling right
        // after this returns, so we don't touch it here.
        let _ = player.set_string_prop_pub("deband", "yes");
        let _ = player.set_string_prop_pub("dither-depth", "auto");
        let _ = player.set_string_prop_pub("hdr-compute-peak", "yes");
        let _ = player.set_string_prop_pub("vd-lavc-skiploopfilter", "default");
    }
    Ok(())
}

pub fn apply_upscaling(
    player: &Player,
    profile: &str,
    shader_dir: Option<&PathBuf>,
) -> Result<(), String> {
    match profile {
        "off" => {
            player.set_string_prop_pub("scale", "bilinear")?;
            let _ = player.command(&["change-list", "glsl-shaders", "clr", ""]);
        }
        "low" => {
            player.set_string_prop_pub("scale", "ewa_lanczossharp")?;
            player.set_string_prop_pub("cscale", "spline64")?;
            let _ = player.command(&["change-list", "glsl-shaders", "clr", ""]);
        }
        "medium" | "high" => {
            player.set_string_prop_pub("scale", "ewa_lanczossharp")?;
            player.set_string_prop_pub("cscale", "spline64")?;
            // Try to load bundled FSRCNNX_x2_8 + KrigBilateral. If they're
            // not on disk (user hasn't dropped them in resources/shaders/),
            // silently fall through — quality stays at Low.
            let shader_name = if profile == "high" {
                "FSRCNNX_x2_16-0-4-1.glsl"
            } else {
                "FSRCNNX_x2_8-0-4-1.glsl"
            };
            if let Some(dir) = shader_dir {
                let luma = dir.join(shader_name);
                let chroma = dir.join("KrigBilateral.glsl");
                if luma.exists() {
                    let mut chain = luma.to_string_lossy().into_owned();
                    if chroma.exists() {
                        chain.push(';');
                        chain.push_str(&chroma.to_string_lossy());
                        crate::np_info!("upscaling", "loaded {} + KrigBilateral.glsl", shader_name);
                    } else {
                        crate::np_warn!(
                            "upscaling",
                            "loaded {} but KrigBilateral.glsl missing (chroma stays at spline64)",
                            shader_name
                        );
                    }
                    let _ = player.command(&["change-list", "glsl-shaders", "set", &chain]);
                } else {
                    let _ = player.command(&["change-list", "glsl-shaders", "clr", ""]);
                    crate::np_warn!(
                        "upscaling",
                        "{} missing in {} — falling back to Low",
                        shader_name,
                        dir.display()
                    );
                }
            } else {
                crate::np_warn!("upscaling", "shader_dir not set — falling back to Low");
            }
        }
        _ => return Err(format!("unknown upscaling profile: {profile}")),
    }
    Ok(())
}

pub fn apply_interpolation(player: &Player, mode: &str) -> Result<(), String> {
    match mode {
        "off" => {
            player.set_string_prop_pub("interpolation", "no")?;
        }
        "smooth" => {
            player.set_string_prop_pub("interpolation", "yes")?;
            player.set_string_prop_pub("tscale", "oversample")?;
            player.set_string_prop_pub("video-sync", "display-resample")?;
        }
        "cinematic" => {
            player.set_string_prop_pub("interpolation", "yes")?;
            player.set_string_prop_pub("tscale", "mitchell")?;
            player.set_string_prop_pub("video-sync", "display-resample")?;
        }
        _ => return Err(format!("unknown interpolation mode: {mode}")),
    }
    Ok(())
}

pub fn apply_hdr(player: &Player, mode: &str) -> Result<(), String> {
    // All four HDR modes map to combinations of target-colorspace-hint +
    // tone-mapping. Some of these are gpu-next-only and may silently no-op
    // on builds without it — that's fine.
    match mode {
        "auto" => {
            let _ = player.set_string_prop_pub("target-colorspace-hint", "yes");
            let _ = player.set_string_prop_pub("tone-mapping", "auto");
        }
        "passthrough" => {
            let _ = player.set_string_prop_pub("target-colorspace-hint", "yes");
            let _ = player.set_string_prop_pub("tone-mapping", "auto");
            let _ = player.set_string_prop_pub("target-peak", "auto");
        }
        "tone_map" => {
            let _ = player.set_string_prop_pub("target-colorspace-hint", "no");
            let _ = player.set_string_prop_pub("tone-mapping", "spline");
        }
        "sdr" => {
            let _ = player.set_string_prop_pub("target-colorspace-hint", "no");
            let _ = player.set_string_prop_pub("tone-mapping", "auto");
            let _ = player.set_string_prop_pub("target-trc", "bt.1886");
            let _ = player.set_string_prop_pub("target-prim", "bt.709");
        }
        _ => return Err(format!("unknown HDR mode: {mode}")),
    }
    Ok(())
}

pub fn apply_vsync(player: &Player, enabled: bool) -> Result<(), String> {
    let _ = player.set_string_prop_pub(
        "video-sync",
        if enabled { "display-resample" } else { "audio" },
    );
    Ok(())
}

/// When power state flips and profile is Auto, re-resolve and re-apply.
pub fn react_to_power_change(
    player: &Player,
    perf: &Arc<PerfController>,
    shader_dir: Option<&PathBuf>,
) -> Option<ResolvedPerf> {
    let profile_str = perf.profile.lock().ok()?.clone();
    let profile = PerfProfile::from_str(&profile_str)?;
    if profile != PerfProfile::Auto {
        return None;
    }
    let on_battery = perf.on_battery.load(Ordering::Relaxed);
    let resolved = resolve(profile, on_battery)?;
    let _ = apply(player, &resolved, shader_dir);
    Some(resolved)
}
