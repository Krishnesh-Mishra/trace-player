//! Windows MSVC: locate libmpv-2.dll next to the installed .exe and
//! `LoadLibraryW`-preload it before any libmpv FFI call.
//!
//! The bin is linked with `/DELAYLOAD:libmpv-2.dll` (see build.rs) so the
//! delayed import resolves to whichever copy we LoadLibraryW first.
//!
//! Distribution model: the NSIS installer places libmpv-2.dll alongside
//! the exe. In `cargo tauri dev` the bundler does the same into
//! `target/<profile>/`. Earlier versions embedded the DLL via
//! `include_bytes!` and extracted it on first run; we dropped that to keep
//! the .exe small and let libmpv / yt-dlp / rqbit be updated independently.
//!
//! `needs_extraction` is retained as a name so lib.rs's splash gate can
//! query "is this a cold start where the DLL has to be set up first?" —
//! since the installer guarantees presence, the answer is now always no
//! when the file is found, and the splash code path is effectively a no-op.

use std::ffi::OsString;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use windows::core::PCWSTR;
use windows::Win32::System::LibraryLoader::LoadLibraryW;

const DLL_NAME: &str = "libmpv-2.dll";

/// Cheap probe: returns true when the DLL can't be found in any expected
/// install location. Used by lib.rs to decide whether to flash the cold-
/// start splash. With the installer-based model this should always be
/// false on a normal launch.
pub fn needs_extraction() -> bool {
    locate().is_none()
}

/// Resolve the DLL path and `LoadLibraryW` it. The returned `PathBuf` is
/// logged so support can verify which copy was actually used.
pub fn extract_and_preload() -> Result<PathBuf, String> {
    let path = locate().ok_or_else(|| {
        format!(
            "{DLL_NAME} not found — installer must place it in bin/ next to the .exe \
             (or copy it manually to %LOCALAPPDATA%\\Programs\\Trace Player\\bin\\)"
        )
    })?;
    preload_dll(&path)?;
    Ok(path)
}

/// Multi-candidate locate so the same code works in:
///   - Installed (NSIS, currentUser): `<exe_dir>\bin\libmpv-2.dll`
///   - Tauri resource layout:         `<exe_dir>\resources\bin\libmpv-2.dll`
///   - Loose dev copy:                `<exe_dir>\libmpv-2.dll`
///   - `cargo tauri dev` from src:    walk up to `src-tauri\assets\libmpv-2.dll`
fn locate() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    let mut candidates: Vec<PathBuf> = vec![
        dir.join("bin").join(DLL_NAME),
        dir.join("resources").join("bin").join(DLL_NAME),
        dir.join("resources").join("assets").join(DLL_NAME),
        dir.join(DLL_NAME),
    ];

    // Walk up looking for `src-tauri/assets/libmpv-2.dll` — covers
    // `cargo run` and `cargo tauri dev` where the exe is in target/<profile>/.
    let mut up = dir.to_path_buf();
    for _ in 0..6 {
        candidates.push(up.join("src-tauri").join("assets").join(DLL_NAME));
        candidates.push(up.join("assets").join(DLL_NAME));
        match up.parent() {
            Some(p) => up = p.to_path_buf(),
            None => break,
        }
    }

    candidates.into_iter().find_map(|p| {
        if p.is_file() {
            p.canonicalize().ok()
        } else {
            None
        }
    })
}

fn preload_dll(path: &Path) -> Result<(), String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("dll path canonicalize: {e}"))?;
    let wide: Vec<u16> = OsString::from(canonical.as_os_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        LoadLibraryW(PCWSTR(wide.as_ptr()))
            .map_err(|e| format!("LoadLibraryW({}): {e}", canonical.display()))?;
    }
    Ok(())
}
