// yt-dlp.exe lifecycle: locate, ensure-present, lazy update.
//
// The installer drops yt-dlp.exe into `<exe_dir>/bin/yt-dlp.exe`. After that
// we let yt-dlp self-update via mpv's ytdl_hook integration; a once-per-week
// check fetches the latest from GitHub and stages it as `yt-dlp.exe.new` so
// the swap can happen at the next process start (avoids file-in-use).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

const RELEASES_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const DOWNLOAD_FALLBACK: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const USER_AGENT: &str = "NewPlayer/0.1 (+https://github.com/)";
const UPDATE_CHECK_INTERVAL_DAYS: u64 = 7;

/// Locate the yt-dlp executable that mpv's ytdl_hook should call. Returns
/// None if absent — caller decides whether to download (`ensure_present`).
pub fn locate() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    const NAME: &str = "yt-dlp.exe";
    #[cfg(not(target_os = "windows"))]
    const NAME: &str = "yt-dlp";
    crate::find_bundled_binary(NAME)
}

/// Path where update_check stages a downloaded binary. The actual swap
/// happens at the next app launch via `promote_staged_update_at_startup`.
fn staged_path(yt_dlp: &Path) -> PathBuf {
    let mut p = yt_dlp.to_path_buf();
    let new_name = match p.file_name().and_then(|s| s.to_str()) {
        Some(name) => format!("{name}.new"),
        None => "yt-dlp.new".to_string(),
    };
    p.set_file_name(new_name);
    p
}

/// Marker file holding the unix-epoch seconds of the last successful update
/// check, used to throttle the GitHub API polls to once per week.
fn last_check_path() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    Some(
        PathBuf::from(base)
            .join("NewPlayer")
            .join("yt-dlp")
            .join("last-check"),
    )
}

fn read_last_check() -> Option<u64> {
    let p = last_check_path()?;
    let s = std::fs::read_to_string(p).ok()?;
    s.trim().parse().ok()
}

fn write_last_check(epoch_secs: u64) {
    if let Some(p) = last_check_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(p, epoch_secs.to_string());
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Run at startup before any subprocess might call yt-dlp.exe. If a `.new`
/// file is sitting next to it, replace the live exe with the staged one.
///
/// Also recovers from a partial swap: if the live binary is missing but a
/// `.old` backup exists from a prior crashed swap, rename the backup back
/// into place. Idempotent — calling twice is a no-op.
pub fn promote_staged_update_at_startup() {
    if let Some(yt) = locate() {
        promote_at(&yt);
    } else {
        recover_after_crash();
    }
}

fn recover_after_crash() {
    // Try the bin/ candidate next to the .exe. If a .old backup exists
    // there, the user's previous swap was interrupted — restore it.
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(dir) = exe.parent() else { return };
    let yt = dir.join("bin").join("yt-dlp.exe");
    let backup = dir.join("bin").join("yt-dlp.exe.old");
    if !yt.is_file() && backup.is_file() {
        if std::fs::rename(&backup, &yt).is_ok() {
            crate::np_warn!(
                "ytdlp",
                "recovered yt-dlp.exe from .old backup after interrupted swap"
            );
        }
    }
}

fn promote_at(yt: &Path) {
    let staged = staged_path(yt);
    if !staged.is_file() {
        return;
    }
    // Atomic swap: rename live → .old, rename .new → live, delete .old.
    let mut backup = yt.to_path_buf();
    let backup_name = match yt.file_name().and_then(|s| s.to_str()) {
        Some(name) => format!("{name}.old"),
        None => "yt-dlp.old".to_string(),
    };
    backup.set_file_name(backup_name);
    let _ = std::fs::remove_file(&backup);
    if std::fs::rename(yt, &backup).is_err() {
        crate::np_warn!("ytdlp", "couldn't move live yt-dlp aside; keeping current version");
        return;
    }
    if let Err(e) = std::fs::rename(&staged, yt) {
        crate::np_warn!("ytdlp", "promote staged update failed: {e}; rolling back");
        let _ = std::fs::rename(&backup, yt);
        return;
    }
    let _ = std::fs::remove_file(&backup);
    crate::np_info!("ytdlp", "promoted staged update at {}", yt.display());
}

/// Spawn a background thread that runs `yt-dlp.exe --version` once and
/// throws the output away. The point isn't the version — it's getting
/// yt-dlp's bundled Python interpreter + libs into Windows' file cache so
/// the first user URL doesn't pay ~500-800 ms of cold-start cost. Cheap
/// (~150 ms wall-clock when warm; first run ~600 ms) and fully off the
/// boot critical path.
pub fn spawn_prewarm() {
    let Some(yt) = locate() else {
        return;
    };
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        match std::process::Command::new(&yt)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                let _ = child.wait();
                crate::np_debug!(
                    "ytdlp",
                    "prewarm done in {}ms",
                    started.elapsed().as_millis()
                );
            }
            Err(e) => crate::np_warn!("ytdlp", "prewarm spawn failed: {e}"),
        }
    });
}

/// Spawn a background thread that does a single update check after a short
/// idle delay. No-op when last check was within the throttle window.
pub fn spawn_update_check() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(30));

        let Some(yt) = locate() else {
            crate::np_debug!("ytdlp", "skip update check: yt-dlp.exe not present");
            return;
        };

        if let Some(last) = read_last_check() {
            let elapsed = now_secs().saturating_sub(last);
            if elapsed < UPDATE_CHECK_INTERVAL_DAYS * 86400 {
                crate::np_debug!(
                    "ytdlp",
                    "skip update check: last ran {}h ago",
                    elapsed / 3600
                );
                return;
            }
        }

        match check_and_stage(&yt) {
            Ok(true) => crate::np_info!("ytdlp", "newer version staged for next launch"),
            Ok(false) => crate::np_debug!("ytdlp", "yt-dlp is already up to date"),
            Err(e) => crate::np_warn!("ytdlp", "update check failed: {e}"),
        }
        write_last_check(now_secs());
    });
}

#[derive(Deserialize)]
struct ReleaseInfo {
    tag_name: String,
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

fn check_and_stage(yt_dlp: &Path) -> Result<bool, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(30))
        .user_agent(USER_AGENT)
        .build();

    let info: ReleaseInfo = agent
        .get(RELEASES_API)
        .call()
        .map_err(|e| format!("github fetch: {e}"))?
        .into_json()
        .map_err(|e| format!("github JSON: {e}"))?;

    let current = current_version(yt_dlp).unwrap_or_default();
    let latest = info.tag_name.trim_start_matches('v').to_string();
    if !current.is_empty() && current == latest {
        return Ok(false);
    }
    crate::np_info!("ytdlp", "current={} latest={} — staging update", current, latest);

    #[cfg(target_os = "windows")]
    let asset_name = "yt-dlp.exe";
    #[cfg(not(target_os = "windows"))]
    let asset_name = "yt-dlp";

    let url = info
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .map(|a| a.browser_download_url.clone())
        .unwrap_or_else(|| DOWNLOAD_FALLBACK.to_string());

    let resp = agent
        .get(&url)
        .call()
        .map_err(|e| format!("download: {e}"))?;

    let mut bytes: Vec<u8> = Vec::with_capacity(20 * 1024 * 1024);
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("download read: {e}"))?;

    let staged = staged_path(yt_dlp);
    let tmp_path = staged.with_extension("tmp");
    std::fs::write(&tmp_path, &bytes).map_err(|e| format!("write staged tmp: {e}"))?;
    std::fs::rename(&tmp_path, &staged).map_err(|e| format!("rename staged tmp: {e}"))?;
    Ok(true)
}

/// Cheap `yt-dlp --version` shell-out to learn the current build's version
/// string. Not fatal if it fails — just means we can't compare and will
/// always re-download.
pub fn current_version(yt_dlp: &Path) -> Option<String> {
    use std::process::Command;
    let out = Command::new(yt_dlp).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
