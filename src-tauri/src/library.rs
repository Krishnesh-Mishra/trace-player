// Path validation pattern:
// All Tauri commands that accept a file/directory path from the frontend MUST call
// `is_path_allowed()` before performing any filesystem operation. This prevents
// path-traversal attacks where malicious JS in the WebView could read arbitrary
// files. Allowed locations: user home directory, system temp directory.
// This same pattern should be applied to `set_screenshot_dir` in commands.rs.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Manager};

use crate::state::AppState;
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
    let thumbnailer = state
        .get_or_init_thumbnailer()
        .ok_or_else(|| "thumbnailer not available".to_string())?;

    let out_dir = thumb_dir(&app)?;
    let hash = path_hash(&path);
    let dest = out_dir.join(format!("{hash}.jpg"));

    if dest.exists() {
        return dest
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "non-utf8 path".to_string());
    }

    let src = path.clone();
    let dest_clone = dest.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = thumbnailer::generate_persistent_thumb(&thumbnailer, &src, &dest_clone);
        let _ = tx.send(result);
    });
    rx.recv()
        .map_err(|e| format!("thumb thread: {e}"))?
        .map_err(|e| format!("generate thumb: {e}"))?;

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
    let thumbnailer = state
        .get_or_init_thumbnailer()
        .ok_or_else(|| "thumbnailer not available".to_string())?;

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = thumbnailer::probe_media_info(&thumbnailer, &path);
        let _ = tx.send(result);
    });
    rx.recv()
        .map_err(|e| format!("probe thread: {e}"))?
}

#[tauri::command]
pub async fn read_directory_videos(path: String) -> Result<Vec<DirVideo>, String> {
    let dir = PathBuf::from(&path);
    is_path_allowed(&dir)?;
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
