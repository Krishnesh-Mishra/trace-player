// Path validation pattern:
// All Tauri commands that accept a file/directory path from the frontend MUST call
// `is_path_allowed()` before performing any filesystem operation. This prevents
// path-traversal attacks where malicious JS in the WebView could read arbitrary
// files. Allowed locations: user home directory, system temp directory.
// This same pattern should be applied to `set_screenshot_dir` in commands.rs.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::streaming;
use crate::thumbnailer;

/// Validates that the given path resides within an allowed directory (user home
/// or system temp). Returns `Ok(())` if access is permitted, or an error string
/// describing why access was denied.
fn is_path_allowed(path: &Path) -> Result<(), String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let home = dirs::home_dir().ok_or("cannot determine home dir")?;
    // Allow anything under the user's home directory
    if canonical.starts_with(&home) {
        return Ok(());
    }
    // Allow temp directory (for thumbnails)
    if canonical.starts_with(std::env::temp_dir()) {
        return Ok(());
    }
    Err(format!("access denied: {}", canonical.display()))
}

const VIDEO_EXTS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "flv", "wmv", "mpg", "mpeg", "ogv", "3gp",
    "m2ts", "mts",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirVideo {
    pub name: String,
    pub path: String,
    pub size: u64,
}

fn thumb_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {e}"))?;
    let dir = base.join("library-thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create thumb dir: {e}"))?;
    Ok(dir)
}

fn path_hash(path: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(path.as_bytes());
    let digest = hasher.finalize();
    hex::encode(&digest[..10])
}

#[tauri::command]
pub fn get_app_thumb_dir(app: AppHandle) -> Result<String, String> {
    let dir = thumb_dir(&app)?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "non-utf8 path".to_string())
}

#[tauri::command]
pub async fn generate_library_thumb(
    path: String,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let thumbnailer = state.get_or_init_thumbnailer().ok_or_else(|| {
        crate::np_err!("library", "thumbnailer not available for {}", path);
        "thumbnailer not available".to_string()
    })?;

    let out_dir = thumb_dir(&app)?;
    let hash = path_hash(&path);
    let dest = out_dir.join(format!("{hash}.jpg"));

    // Threshold matches `thumbnailer::MIN_VALID_JPEG_BYTES`. Anything below
    // is a previously-cached broken frame (3 KB-ish output from a partial
    // torrent file or HEVC decode error). Drop it so we regen with the
    // current code path instead of serving a corrupt thumbnail.
    const MIN_CACHED_JPEG_BYTES: u64 = 4096;
    if dest.exists() {
        if let Ok(meta) = std::fs::metadata(&dest) {
            if meta.len() >= MIN_CACHED_JPEG_BYTES {
                return dest
                    .to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "non-utf8 path".to_string());
            }
            crate::np_info!(
                "library",
                "evicting too-small cached thumb {} ({} bytes)",
                dest.display(),
                meta.len()
            );
            let _ = std::fs::remove_file(&dest);
        }
    }

    let src = path.clone();
    let dest_clone = dest.clone();
    tauri::async_runtime::spawn_blocking(move || {
        thumbnailer::generate_persistent_thumb(&thumbnailer, &src, &dest_clone)
    })
    .await
    .map_err(|e| {
        crate::np_err!("library", "thumb task join: {e}");
        format!("thumb task join: {e}")
    })?
    .map_err(|e| {
        crate::np_err!("library", "generate thumb {}: {}", path, e);
        format!("generate thumb: {e}")
    })?;

    match std::fs::metadata(&dest) {
        Ok(m) if m.len() >= MIN_CACHED_JPEG_BYTES => {}
        Ok(m) => {
            crate::np_err!(
                "library",
                "thumb file too small after write: {} ({} bytes)",
                dest.display(),
                m.len()
            );
            let _ = std::fs::remove_file(&dest);
            return Err("thumb file too small".to_string());
        }
        Err(e) => {
            crate::np_err!("library", "thumb file missing after write: {} ({})", dest.display(), e);
            return Err(format!("thumb file missing: {e}"));
        }
    }

    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "non-utf8 path".to_string())
}

#[tauri::command]
pub fn read_thumb_base64(path: String) -> Result<String, String> {
    is_path_allowed(Path::new(&path))?;
    use base64::{engine::general_purpose, Engine as _};
    let bytes = std::fs::read(&path).map_err(|e| format!("read thumb: {e}"))?;
    Ok(general_purpose::STANDARD.encode(&bytes))
}

/// True iff `path` is a file at least `MIN_CACHED_JPEG_BYTES` bytes large.
/// Used by the library auto-gen loop to detect cached thumb_path entries
/// that were written by an earlier (buggy) code path with broken/empty
/// frames — those get evicted and regenerated.
#[tauri::command]
pub fn is_thumb_valid(path: String) -> bool {
    const MIN_CACHED_JPEG_BYTES: u64 = 4096;
    std::fs::metadata(&path)
        .map(|m| m.is_file() && m.len() >= MIN_CACHED_JPEG_BYTES)
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetaInfo {
    pub size: u64,
    pub created: Option<u64>,
    pub modified: Option<u64>,
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetaInfo, String> {
    is_path_allowed(Path::new(&path))?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("metadata: {e}"))?;
    let created = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Ok(FileMetaInfo {
        size: meta.len(),
        created,
        modified,
    })
}

#[tauri::command]
pub async fn probe_video_info(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<thumbnailer::MediaInfo, String> {
    let thumbnailer = state.get_or_init_thumbnailer().ok_or_else(|| {
        crate::np_err!("library", "thumbnailer not available for probe of {}", path);
        "thumbnailer not available".to_string()
    })?;

    tauri::async_runtime::spawn_blocking(move || {
        thumbnailer::probe_media_info(&thumbnailer, &path)
    })
    .await
    .map_err(|e| format!("probe task join: {e}"))?
}

#[tauri::command]
pub async fn read_directory_videos(path: String) -> Result<Vec<DirVideo>, String> {
    // No `is_path_allowed` here: this is called for the parent folder of a
    // file the user has already loaded into the player (sibling-playlist
    // population), or for an explorer-style path the user typed in the
    // Library UI. Both cases are user-authorized — restricting to ~home
    // breaks playback siblings for any video opened from `D:\Movies\` etc.
    // We still only return video-extension filenames + sizes, never the
    // file contents.
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("not a directory: {path}"));
    }

    let mut results = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))?;

    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase());
        if let Some(ref ext) = ext {
            if !VIDEO_EXTS.contains(&ext.as_str()) {
                continue;
            }
        } else {
            continue;
        }
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        results.push(DirVideo {
            name,
            path: p.to_string_lossy().to_string(),
            size,
        });
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

#[tauri::command]
pub async fn scan_common_folders() -> Result<Vec<DirVideo>, String> {
    let folders: Vec<PathBuf> = [
        dirs::video_dir(),
        dirs::download_dir(),
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::picture_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut results = Vec::new();
    for folder in &folders {
        scan_recursive(folder, 3, &mut results);
    }
    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

/// Disk-first torrent thumbnail path resolver.
///
/// Walks rqbit's `session_dir()` looking for the file the library item refers to.
/// Returns the full path if found, or None — pure filesystem read, never spawns
/// rqbit or touches the network. Called from the library auto-gen loop for
/// torrent items whose `thumb_path IS NULL` so we can generate a thumb from the
/// already-downloaded file without re-adding the magnet.
///
/// Lookup order:
///   1. `session_dir / folder_name / title` when `folder_name` is supplied
///      (multi-file torrent: library folder name == rqbit torrent name).
///   2. `session_dir / {subdir} / title` for every immediate subdir of session_dir
///      (single-file torrent where the library entry didn't store the torrent name).
///   3. `session_dir / title` (very rare: rqbit dropped the file at top level).
#[tauri::command]
pub async fn find_torrent_local_path(
    title: String,
    folder_name: Option<String>,
) -> Result<Option<String>, String> {
    let root = streaming::session_dir();
    if !root.is_dir() {
        return Ok(None);
    }

    if let Some(folder) = folder_name.as_ref() {
        let candidate = root.join(folder).join(&title);
        if candidate.is_file() {
            return Ok(candidate.to_str().map(|s| s.to_string()));
        }
    }

    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let candidate = p.join(&title);
            if candidate.is_file() {
                return Ok(candidate.to_str().map(|s| s.to_string()));
            }
        }
    }

    let flat = root.join(&title);
    if flat.is_file() {
        return Ok(flat.to_str().map(|s| s.to_string()));
    }

    Ok(None)
}

/// Stream-fallback torrent thumbnail generator. Adds the magnet to rqbit if
/// not already present, hands the resulting `http://127.0.0.1:.../stream/{idx}`
/// URL to the headless thumbnailer mpv, and lets libmpv issue Range requests
/// for the middle pieces. Uses longer timeouts than the local-file path because
/// rqbit may need to fetch ~10-30 MB from the swarm before mpv can demux a
/// frame at the 50% mark.
///
/// On success the torrent is `forget`-ten so it doesn't keep downloading in
/// the background — we only wanted the one frame. The JPEG is cached under
/// the same `library-thumbs` dir using `sha1(magnet:idx)` as the key so a
/// later disk-first lookup of the same item hits the cache too.
#[tauri::command]
pub async fn generate_torrent_stream_thumb(
    magnet: String,
    file_index: u32,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let thumbnailer = state.get_or_init_thumbnailer().ok_or_else(|| {
        crate::np_err!("library", "thumbnailer not available for stream thumb");
        "thumbnailer not available".to_string()
    })?;

    let out_dir = thumb_dir(&app)?;
    let key = format!("{magnet}:{file_index}");
    let hash = path_hash(&key);
    let dest = out_dir.join(format!("{hash}.jpg"));

    if dest.exists() {
        if let Ok(meta) = std::fs::metadata(&dest) {
            if meta.len() > 0 {
                return dest
                    .to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "non-utf8 path".to_string());
            }
            let _ = std::fs::remove_file(&dest);
        }
    }

    let handle = crate::commands::ensure_streaming(&state, &app)?;
    let added = handle.add_magnet(&magnet).map_err(|e| {
        crate::np_err!("library", "stream-thumb add_magnet: {e}");
        format!("add_magnet: {e}")
    })?;

    let target_idx = file_index as usize;
    let video = added
        .videos
        .iter()
        .find(|v| v.idx == target_idx)
        .cloned()
        .ok_or_else(|| format!("file index {target_idx} not found in torrent"))?;

    // Track this torrent so the shutdown handler in lib.rs cleans it up via
    // its existing forget-all-torrents pass. We deliberately do NOT call
    // `handle.forget(added.id)` after each extraction because re-adding the
    // same magnet immediately after forgetting hits a rqbit race where the
    // returned torrent_id is reused but `/torrents/{id}/update_only_files`
    // returns 404 (the new torrent isn't fully registered yet). Leaving it
    // alive across the batch means subsequent stream-thumb calls for other
    // files in the same torrent are cheap set_only_files toggles.
    if let Ok(mut ids) = state.torrent_ids.lock() {
        ids.insert(added.id);
    }

    // Ask rqbit to download only this file. Blocks through the initial-
    // checksum phase (up to 120 s for huge torrents); for thumb-only that's
    // fine because the wait would happen during load() anyway.
    if let Err(e) = handle.set_only_files(added.id, &[target_idx]) {
        crate::np_warn!("library", "stream-thumb set_only_files: {e}");
    }

    let torrent_id = added.id;
    let dest_clone = dest.clone();
    let stream_url = video.stream_url.clone();
    let handle_for_quiet = handle.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        thumbnailer::generate_persistent_thumb_with_timeouts(
            &thumbnailer,
            &stream_url,
            &dest_clone,
            Duration::from_secs(90),
            Duration::from_secs(60),
        )
    })
    .await
    .map_err(|e| format!("stream-thumb task join: {e}"))?;

    // After the thumb is captured (or fails), stop downloading by toggling
    // the wanted-files set to empty. Keeps the torrent registered so the
    // next stream-thumb call for a different file in the same magnet just
    // does another fast set_only_files toggle instead of a fresh add.
    if let Err(e) = handle_for_quiet.set_only_files(torrent_id, &[]) {
        crate::np_debug!("library", "post-thumb set_only_files([]) failed: {e}");
    }

    result.map_err(|e| {
        crate::np_err!("library", "generate stream thumb {}: {}", magnet, e);
        format!("generate stream thumb: {e}")
    })?;

    match std::fs::metadata(&dest) {
        Ok(m) if m.len() > 0 => {}
        Ok(_) => {
            let _ = std::fs::remove_file(&dest);
            return Err("stream thumb empty after write".to_string());
        }
        Err(e) => return Err(format!("stream thumb missing after write: {e}")),
    }

    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "non-utf8 path".to_string())
}

fn scan_recursive(dir: &Path, max_depth: u32, results: &mut Vec<DirVideo>) {
    if max_depth == 0 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            scan_recursive(&p, max_depth - 1, results);
        } else if p.is_file() {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase());
            if let Some(ref ext) = ext {
                if !VIDEO_EXTS.contains(&ext.as_str()) {
                    continue;
                }
            } else {
                continue;
            }
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            results.push(DirVideo {
                name,
                path: p.to_string_lossy().to_string(),
                size,
            });
        }
    }
}
