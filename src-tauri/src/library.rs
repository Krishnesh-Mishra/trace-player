use std::path::PathBuf;

use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::thumbnailer;

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
        .thumbnailer
        .clone()
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
        let result =
            thumbnailer::generate_persistent_thumb(&thumbnailer, &src, &dest_clone);
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
pub async fn read_directory_videos(path: String) -> Result<Vec<DirVideo>, String> {
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
