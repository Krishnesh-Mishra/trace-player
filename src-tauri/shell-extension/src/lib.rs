//! Windows Shell IThumbnailProvider for Trace Player video files.
//!
//! Explorer loads this DLL in-process when it needs a thumbnail for a video
//! file. We try not to do any heavy work in here — that's how shell
//! extensions earn a place on Microsoft's Bad Extension list and get
//! disabled wholesale. Instead:
//!
//!   1. Compute `sha1(canonical_path)[..10]` — same scheme `library.rs`
//!      uses for in-app thumbs.
//!   2. Look for `%APPDATA%\com.krishnesh.traceplayer\library-thumbs\{hash}.jpg`.
//!   3. If found, decode + scale + hand back an HBITMAP. Done.
//!   4. If missing, spawn `trace-player.exe --thumbnail-gen "<path>"`
//!      detached and return E_PENDING. Explorer retries on the next paint /
//!      scroll, by which time the JPG has been written by the spawned exe.
//!
//! Library imports + the explore tab already populate the same cache, so
//! Explorer thumbnails effectively come for free on any file the user has
//! ever seen in-app. First-time-seen-in-Explorer files take one extra
//! refresh cycle.

#![cfg(target_os = "windows")]
#![allow(clippy::missing_safety_doc)]

use std::cell::RefCell;
use std::ffi::{c_void, OsString};
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};

use image::{imageops::FilterType, ImageReader};
use sha1::{Digest, Sha1};

use windows::core::{implement, IUnknown, Interface, GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::{
    BOOL, CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_NOINTERFACE, E_POINTER,
    E_UNEXPECTED, HMODULE, S_FALSE, S_OK,
};
use windows::Win32::Graphics::Gdi::{
    CreateDIBSection, DeleteObject, GetDC, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::UI::Shell::PropertiesSystem::IInitializeWithFile;
use windows::Win32::UI::Shell::PropertiesSystem::IInitializeWithFile_Impl;
use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, WTSAT_RGB, WTS_ALPHATYPE};

// ── Module-wide state ───────────────────────────────────────────────────────

/// Outstanding COM object count. Explorer asks DllCanUnloadNow() before
/// unloading; we return S_OK when zero, S_FALSE while any instance is alive.
static DLL_REF_COUNT: AtomicI32 = AtomicI32::new(0);

/// HMODULE of this DLL, captured in DllMain. Needed for resolving the
/// install directory (the .exe sits one level above us).
static mut DLL_MODULE: HMODULE = HMODULE(std::ptr::null_mut());

/// Our CLSID. Generated once and frozen — DO NOT CHANGE: the NSIS installer
/// references this same GUID in the registry, and any change would orphan
/// existing installations.
pub const CLSID_THUMB_PROVIDER: GUID =
    GUID::from_u128(0x8B7C3A24_1E2F_4A8D_9B5C_DE2A1F8B7C30);

// ── IClassFactory + DllMain + DllGetClassObject ─────────────────────────────

#[implement(IClassFactory)]
struct ThumbProviderFactory;

impl IClassFactory_Impl for ThumbProviderFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Option<&IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if punkouter.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        if ppvobject.is_null() || riid.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppvobject = std::ptr::null_mut() };

        let provider = ThumbProvider::new();
        // Wrap in IUnknown then QI to the requested interface so we hand
        // explorer.exe exactly the vtable it asked for.
        let unknown: IUnknown = provider.into();
        unsafe { unknown.query(riid, ppvobject).ok() }
    }

    fn LockServer(&self, flock: BOOL) -> windows::core::Result<()> {
        if flock.as_bool() {
            DLL_REF_COUNT.fetch_add(1, Ordering::SeqCst);
        } else {
            DLL_REF_COUNT.fetch_sub(1, Ordering::SeqCst);
        }
        Ok(())
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllMain(
    hinst: HMODULE,
    reason: u32,
    _reserved: *mut c_void,
) -> BOOL {
    const DLL_PROCESS_ATTACH: u32 = 1;
    if reason == DLL_PROCESS_ATTACH {
        DLL_MODULE = hinst;
    }
    BOOL(1)
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if ppv.is_null() {
        return E_POINTER;
    }
    *ppv = std::ptr::null_mut();
    if rclsid.is_null() || *rclsid != CLSID_THUMB_PROVIDER {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = ThumbProviderFactory.into();
    match factory.query(riid, ppv) {
        S_OK => S_OK,
        _ => E_NOINTERFACE,
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllCanUnloadNow() -> HRESULT {
    if DLL_REF_COUNT.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

// DllRegisterServer / DllUnregisterServer are no-ops here — the NSIS
// installer writes the same registry entries during install / uninstall.
// Exporting them anyway because regsvr32 expects to find them, and a
// missing export turns into a confusing "module not found" rather than
// a clean "not implemented".
#[no_mangle]
pub unsafe extern "system" fn DllRegisterServer() -> HRESULT {
    S_OK
}

#[no_mangle]
pub unsafe extern "system" fn DllUnregisterServer() -> HRESULT {
    S_OK
}

// ── ThumbProvider: implements IInitializeWithFile + IThumbnailProvider ──────

#[implement(IInitializeWithFile, IThumbnailProvider)]
struct ThumbProvider {
    path: RefCell<Option<String>>,
}

impl ThumbProvider {
    fn new() -> Self {
        DLL_REF_COUNT.fetch_add(1, Ordering::SeqCst);
        Self {
            path: RefCell::new(None),
        }
    }
}

impl Drop for ThumbProvider {
    fn drop(&mut self) {
        DLL_REF_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl IInitializeWithFile_Impl for ThumbProvider_Impl {
    fn Initialize(
        &self,
        pszfilepath: &PCWSTR,
        _grfmode: u32,
    ) -> windows::core::Result<()> {
        let path = unsafe { wide_to_string(pszfilepath.0) };
        match path {
            Some(p) => {
                *self.path.borrow_mut() = Some(p);
                Ok(())
            }
            None => Err(E_UNEXPECTED.into()),
        }
    }
}

impl IThumbnailProvider_Impl for ThumbProvider_Impl {
    fn GetThumbnail(
        &self,
        cx: u32,
        phbmp: *mut HBITMAP,
        pdwalpha: *mut WTS_ALPHATYPE,
    ) -> windows::core::Result<()> {
        if phbmp.is_null() || pdwalpha.is_null() {
            return Err(E_POINTER.into());
        }
        let video_path = match self.path.borrow().as_ref() {
            Some(p) => p.clone(),
            None => return Err(E_UNEXPECTED.into()),
        };

        unsafe {
            *phbmp = HBITMAP(std::ptr::null_mut());
            *pdwalpha = WTSAT_RGB;
        }

        // Sanity guard: don't even try if cx is absurd (Explorer is supposed
        // to pass 16..=256, but defensive matters in-process).
        if cx == 0 || cx > 4096 {
            return Err(E_FAIL.into());
        }

        let cache_path = match cache_path_for(&video_path) {
            Some(p) => p,
            None => return Err(E_FAIL.into()),
        };

        if cache_path.is_file() {
            match load_hbitmap(&cache_path, cx) {
                Some(hbmp) => {
                    unsafe { *phbmp = hbmp };
                    return Ok(());
                }
                None => {
                    // Cached file corrupt — drop it and fall through to spawn.
                    let _ = std::fs::remove_file(&cache_path);
                }
            }
        }

        // Cache miss: spawn the headless extractor detached. Don't wait —
        // Explorer must NEVER block on a shell extension. The next time
        // Explorer asks (scroll, refresh, next paint), the cache will exist.
        spawn_thumbnail_gen(&video_path);

        // E_PENDING is the well-known "ask again later" signal for
        // IThumbnailProvider. Explorer doesn't cache the negative response.
        Err(windows::core::Error::from(HRESULT(0x8000000A_u32 as i32)))
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// `%APPDATA%\com.krishnesh.traceplayer\library-thumbs\{sha1(path)[..10]}.jpg`
fn cache_path_for(video_path: &str) -> Option<PathBuf> {
    let mut hasher = Sha1::new();
    hasher.update(video_path.as_bytes());
    let digest = hasher.finalize();
    let hash = hex::encode(&digest[..10]);

    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("com.krishnesh.traceplayer")
            .join("library-thumbs")
            .join(format!("{hash}.jpg")),
    )
}

/// Locate the install root, then `trace-player.exe`. We use the DLL's own
/// module path so this works regardless of how Explorer launched.
fn locate_main_exe() -> Option<PathBuf> {
    let mut buf = [0u16; 1024];
    let len = unsafe { GetModuleFileNameW(DLL_MODULE, &mut buf) };
    if len == 0 || len as usize >= buf.len() {
        return None;
    }
    let dll_path = PathBuf::from(OsString::from_wide(&buf[..len as usize]));
    // DLL lives at <install_dir>\bin\trace-player-shellext.dll
    // exe  lives at <install_dir>\trace-player.exe
    let install_dir = dll_path.parent()?.parent()?;
    let exe = install_dir.join("trace-player.exe");
    if exe.is_file() {
        Some(exe)
    } else {
        None
    }
}

fn spawn_thumbnail_gen(video_path: &str) {
    let Some(exe) = locate_main_exe() else { return };
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    let _ = std::process::Command::new(&exe)
        .arg("--thumbnail-gen")
        .arg(video_path)
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

/// Decode the cached JPG, fit-cover it to `cx`x`cx`, and return as a
/// top-down 32-bit BGRA HBITMAP suitable for IThumbnailProvider.
fn load_hbitmap(cache_path: &Path, cx: u32) -> Option<HBITMAP> {
    let img = ImageReader::open(cache_path).ok()?.decode().ok()?;
    // Aspect-fit into a square cx×cx canvas. Letterbox edges are 0,0,0,0
    // (fully transparent in BGRA but we use WTSAT_RGB so they read as black,
    // which matches how other thumbnail providers handle 16:9 content).
    let target = cx;
    let scaled = img.resize(target, target, FilterType::Triangle);
    let scaled_rgba = scaled.to_rgba8();
    let (sw, sh) = (scaled_rgba.width(), scaled_rgba.height());
    let canvas_w = target;
    let canvas_h = target;
    let mut canvas = vec![0u8; (canvas_w as usize) * (canvas_h as usize) * 4];
    let off_x = (canvas_w.saturating_sub(sw)) / 2;
    let off_y = (canvas_h.saturating_sub(sh)) / 2;
    for y in 0..sh {
        for x in 0..sw {
            let src_idx = ((y * sw + x) * 4) as usize;
            let dst_idx =
                (((y + off_y) * canvas_w + (x + off_x)) * 4) as usize;
            // RGBA → BGRA for GDI
            canvas[dst_idx] = scaled_rgba.as_raw()[src_idx + 2];
            canvas[dst_idx + 1] = scaled_rgba.as_raw()[src_idx + 1];
            canvas[dst_idx + 2] = scaled_rgba.as_raw()[src_idx];
            canvas[dst_idx + 3] = 0xFF;
        }
    }

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: canvas_w as i32,
            // Negative height = top-down DIB. WTS_ALPHATYPE samples row 0 first.
            biHeight: -(canvas_h as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    unsafe {
        let dc = GetDC(None);
        if dc.0.is_null() {
            return None;
        }
        let mut bits_ptr: *mut c_void = std::ptr::null_mut();
        let hbmp = CreateDIBSection(
            dc,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits_ptr,
            None,
            0,
        )
        .ok()?;
        ReleaseDC(None, dc);
        if hbmp.0.is_null() || bits_ptr.is_null() {
            if !hbmp.0.is_null() {
                let _ = DeleteObject(hbmp);
            }
            return None;
        }
        std::ptr::copy_nonoverlapping(canvas.as_ptr(), bits_ptr as *mut u8, canvas.len());
        Some(hbmp)
    }
}

/// Convert a null-terminated wide string pointer to a Rust String.
unsafe fn wide_to_string(ptr: *const u16) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
        if len > 32768 {
            // PATH_MAX-ish guard
            return None;
        }
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    Some(OsString::from_wide(slice).to_string_lossy().into_owned())
}
