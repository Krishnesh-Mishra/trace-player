//! Windows MSVC: embed libmpv-2.dll inside the .exe, extract on first run to
//! %LOCALAPPDATA%\TracePlayer\bin\, and LoadLibraryW-preload it. The bin is
//! linked with /DELAYLOAD:libmpv-2.dll (see build.rs) so the import isn't
//! resolved until the first libmpv FFI call — which is always after this
//! preload. The OS module table matches by name, so the delayed import
//! resolves to the already-loaded cache copy.
//!
//! Static linking would avoid the disk extract but requires building libmpv
//! + FFmpeg from source with a custom MSYS2 toolchain. This is the standard
//! "single-file exe" pattern many shipped Windows apps use.

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use sha1::{Digest, Sha1};
use windows::core::PCWSTR;
use windows::Win32::System::LibraryLoader::LoadLibraryW;

const DLL_BYTES: &[u8] = include_bytes!("../assets/libmpv-2.dll");
const DLL_NAME: &str = "libmpv-2.dll";

/// Cheap probe: returns true when `extract_and_preload` would do the slow
/// 121 MB write (i.e., the stamp or DLL is missing for this fingerprint).
/// Used to gate the first-run splash so warm launches don't flash a window.
/// Any I/O error (no LOCALAPPDATA, unreadable dir) is treated as "needed"
/// — false negatives would skip the splash on a real cold start, which is
/// the case we most want it for.
pub fn needs_extraction() -> bool {
    let Ok(cache_dir) = cache_dir() else {
        return true;
    };
    let fingerprint = quick_fingerprint();
    let stamp_path = cache_dir.join(format!("libmpv-{fingerprint}.stamp"));
    let dll_path = cache_dir.join(DLL_NAME);
    !stamp_path.exists() || !dll_path.exists()
}

pub fn extract_and_preload() -> Result<PathBuf, String> {
    let cache_dir = cache_dir()?;
    fs::create_dir_all(&cache_dir).map_err(|e| format!("create {}: {e}", cache_dir.display()))?;

    let fingerprint = quick_fingerprint();
    let stamp_path = cache_dir.join(format!("libmpv-{fingerprint}.stamp"));
    let dll_path = cache_dir.join(DLL_NAME);

    if !stamp_path.exists() || !dll_path.exists() {
        // Atomic write via tmp + rename so a concurrent Trace Player instance
        // can't observe a half-written DLL.
        let tmp = cache_dir.join(format!("libmpv-2.{}.tmp", std::process::id()));
        {
            let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
            f.write_all(DLL_BYTES).map_err(|e| format!("write tmp: {e}"))?;
            f.sync_all().ok();
        }
        // remove_file failure is fine — the rename below replaces it. The
        // remove only matters if the rename target exists and is open
        // exclusively; in practice mpv DLLs allow shared opens.
        let _ = fs::remove_file(&dll_path);
        fs::rename(&tmp, &dll_path).map_err(|e| format!("rename tmp→dll: {e}"))?;
        // Stamp last — its presence is the integrity marker.
        fs::write(&stamp_path, fingerprint.as_bytes())
            .map_err(|e| format!("write stamp: {e}"))?;
        sweep_old_stamps(&cache_dir, &stamp_path);
    }

    preload_dll(&dll_path)?;
    Ok(dll_path)
}

fn cache_dir() -> Result<PathBuf, String> {
    let local =
        std::env::var_os("LOCALAPPDATA").ok_or_else(|| "LOCALAPPDATA not set".to_string())?;
    Ok(PathBuf::from(local).join("TracePlayer").join("bin"))
}

// SHA-1 of (length || first 64 KB || last 64 KB). Stable, fingerprints any
// real libmpv version change in <1 ms without hashing the full 121 MB.
fn quick_fingerprint() -> String {
    let mut hasher = Sha1::new();
    hasher.update((DLL_BYTES.len() as u64).to_le_bytes());
    let head_n = DLL_BYTES.len().min(64 * 1024);
    hasher.update(&DLL_BYTES[..head_n]);
    if DLL_BYTES.len() > 64 * 1024 {
        let start = DLL_BYTES.len() - 64 * 1024;
        hasher.update(&DLL_BYTES[start..]);
    }
    hex::encode(&hasher.finalize()[..8])
}

fn sweep_old_stamps(dir: &Path, keep: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let p = entry.path();
        if p == keep {
            continue;
        }
        if p.extension().and_then(|s| s.to_str()) == Some("stamp") {
            let _ = fs::remove_file(p);
        }
    }
}

fn preload_dll(path: &Path) -> Result<(), String> {
    let wide: Vec<u16> = OsString::from(path.as_os_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        LoadLibraryW(PCWSTR(wide.as_ptr()))
            .map_err(|e| format!("LoadLibraryW({}): {e}", path.display()))?;
    }
    Ok(())
}
