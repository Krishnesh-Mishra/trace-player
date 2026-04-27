// libmpv FFI — extended for Phase 2: property observation, event pump, and live setters.
// Linked via cargo:rustc-link-lib=mpv → assets/libmpv.dll.a → libmpv-2.dll at runtime.
mod ffi {
    use std::os::raw::{c_char, c_double, c_int, c_void};

    #[allow(non_camel_case_types)]
    pub type mpv_handle = c_void;

    // Property formats
    pub const MPV_FORMAT_NONE: c_int = 0;
    pub const MPV_FORMAT_STRING: c_int = 1;
    pub const MPV_FORMAT_FLAG: c_int = 3;
    pub const MPV_FORMAT_INT64: c_int = 4;
    pub const MPV_FORMAT_DOUBLE: c_int = 5;

    // Event IDs (subset we care about)
    pub const MPV_EVENT_NONE: c_int = 0;
    pub const MPV_EVENT_SHUTDOWN: c_int = 1;
    pub const MPV_EVENT_END_FILE: c_int = 7;
    pub const MPV_EVENT_FILE_LOADED: c_int = 8;
    pub const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
    pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

    #[repr(C)]
    pub struct mpv_event {
        pub event_id: c_int,
        pub error: c_int,
        pub reply_userdata: u64,
        pub data: *mut c_void,
    }

    #[repr(C)]
    #[allow(dead_code)]
    pub struct mpv_event_property {
        pub name: *const c_char,
        pub format: c_int,
        pub data: *mut c_void,
    }

    extern "C" {
        pub fn mpv_create() -> *mut mpv_handle;
        pub fn mpv_initialize(ctx: *mut mpv_handle) -> c_int;
        pub fn mpv_destroy(ctx: *mut mpv_handle);
        pub fn mpv_terminate_destroy(ctx: *mut mpv_handle);
        pub fn mpv_set_option_string(
            ctx: *mut mpv_handle,
            name: *const c_char,
            data: *const c_char,
        ) -> c_int;
        pub fn mpv_set_property(
            ctx: *mut mpv_handle,
            name: *const c_char,
            format: c_int,
            data: *mut c_void,
        ) -> c_int;
        pub fn mpv_get_property(
            ctx: *mut mpv_handle,
            name: *const c_char,
            format: c_int,
            data: *mut c_void,
        ) -> c_int;
        pub fn mpv_get_property_string(
            ctx: *mut mpv_handle,
            name: *const c_char,
        ) -> *mut c_char;
        // Preferred way to write any property from a string. Internally goes
        // through mpv's option-string parser, which is more permissive than
        // mpv_set_property + MPV_FORMAT_STRING for object-list properties
        // like `af` (where some libmpv builds reject the FORMAT_STRING path
        // with MPV_ERROR_PROPERTY_FORMAT).
        pub fn mpv_set_property_string(
            ctx: *mut mpv_handle,
            name: *const c_char,
            data: *const c_char,
        ) -> c_int;
        pub fn mpv_free(data: *mut c_void);
        pub fn mpv_observe_property(
            ctx: *mut mpv_handle,
            reply_userdata: u64,
            name: *const c_char,
            format: c_int,
        ) -> c_int;
        pub fn mpv_wait_event(ctx: *mut mpv_handle, timeout: c_double) -> *mut mpv_event;
        pub fn mpv_command(ctx: *mut mpv_handle, args: *const *const c_char) -> c_int;
        pub fn mpv_error_string(error: c_int) -> *const c_char;
    }
}

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};

pub use ffi::{MPV_FORMAT_DOUBLE, MPV_FORMAT_FLAG, MPV_FORMAT_NONE};

pub struct Player {
    handle: *mut ffi::mpv_handle,
}

// mpv_handle is documented to be safe to use from multiple threads concurrently.
// The one exception is mpv_wait_event — only one thread may call it at a time.
// In our setup the dedicated event-loop thread is the sole caller of wait_event,
// while command handlers issue set_property / command from arbitrary threads.
unsafe impl Send for Player {}
unsafe impl Sync for Player {}

impl Drop for Player {
    fn drop(&mut self) {
        unsafe { ffi::mpv_terminate_destroy(self.handle) };
    }
}

/// Owned, copied-out form of mpv_event. The raw mpv_event* lifetime ends at the
/// next wait_event call, so callers receive an owned snapshot instead.
pub enum MpvEvent {
    PropertyChange { tag: u64 },
    FileLoaded,
    EndFile,
    PlaybackRestart,
    Shutdown,
    Other,
}

impl Player {
    pub fn new() -> Result<Self, String> {
        unsafe {
            let handle = ffi::mpv_create();
            if handle.is_null() {
                return Err("mpv_create returned null — is libmpv-2.dll present?".to_string());
            }

            // These are set as options (before mpv_initialize).
            // Try gpu-next first (better HDR/scalers/perf); fall back to gpu
            // if the linked libmpv build doesn't ship libplacebo.
            if set_opt(handle, "vo", "gpu-next").is_err() {
                crate::np_warn!("mpv-init", "vo=gpu-next not available — using vo=gpu");
                set_opt(handle, "vo", "gpu")?;
            } else {
                crate::np_info!("mpv-init", "vo=gpu-next");
            }
            set_opt(handle, "hwdec", "auto")?;
            // Windows: force d3d11 so d3d11-exclusive-fs (set below) actually
            // engages — with `auto`, mpv may pick winvk/dxinterop and silently
            // ignore the exclusive-fs flag, which is the only way to bypass
            // DWM compositing for tear-free V-Sync. Falls back to auto if
            // d3d11 isn't available on the linked libmpv build.
            #[cfg(target_os = "windows")]
            {
                if set_opt(handle, "gpu-context", "d3d11").is_err() {
                    crate::np_warn!("mpv-init", "gpu-context=d3d11 unavailable — using auto");
                    set_opt(handle, "gpu-context", "auto")?;
                } else {
                    crate::np_info!("mpv-init", "gpu-context=d3d11");
                }
            }
            #[cfg(not(target_os = "windows"))]
            set_opt(handle, "gpu-context", "auto")?;
            set_opt(handle, "osc", "no")?;
            set_opt(handle, "input-default-bindings", "no")?;
            set_opt(handle, "input-vo-keyboard", "no")?;
            set_opt(handle, "terminal", "no")?;
            // AGC may need to boost above unity gain when source is quiet.
            set_opt(handle, "volume-max", "200")?;

            // Quality defaults — all "free" (no measurable GPU cost) and
            // visibly improve playback. Non-fatal so older libmpv builds
            // that don't recognize a name still init cleanly.
            set_opt_optional(handle, "deband", "yes");
            set_opt_optional(handle, "dither-depth", "auto");
            set_opt_optional(handle, "scale-antiring", "0.7");
            set_opt_optional(handle, "deinterlace", "auto");

            // HDR groundwork. These are gpu-next-only options — they no-op on
            // vo=gpu builds, which is why we use the optional setter.
            set_opt_optional(handle, "target-colorspace-hint", "yes");
            set_opt_optional(handle, "hdr-compute-peak", "yes");

            // Windows: bypass the desktop compositor in fullscreen for direct
            // display swap (lower latency, smoother high-refresh delivery).
            // Reverts automatically when leaving fullscreen. Requires
            // gpu-context=d3d11; silently ignored otherwise.
            #[cfg(target_os = "windows")]
            set_opt_optional(handle, "d3d11-exclusive-fs", "yes");

            let err = ffi::mpv_initialize(handle);
            if err < 0 {
                ffi::mpv_destroy(handle);
                return Err(format!("mpv_initialize: {}", err_str(err)));
            }

            Ok(Player { handle })
        }
    }

    /// A second mpv instance dedicated to extracting thumbnail frames.
    /// No video output, no audio, keyframe-only seeks (~10× faster than exact),
    /// and a built-in scale filter so screenshots come out at thumbnail size.
    /// Never call attach_to_window on this instance.
    pub fn new_thumbnailer() -> Result<Self, String> {
        unsafe {
            let handle = ffi::mpv_create();
            if handle.is_null() {
                return Err("mpv_create returned null (thumbnailer)".to_string());
            }

            set_opt(handle, "vo", "null")?;
            set_opt(handle, "audio", "no")?;
            set_opt(handle, "terminal", "no")?;
            set_opt(handle, "osc", "no")?;
            set_opt(handle, "input-default-bindings", "no")?;
            // Exact seeking — keyframe-only mode (hr-seek=no) lands on the
            // nearest keyframe, which can be 5-10s away from the requested
            // time and produces visibly wrong thumbnails. We accept the
            // slower seek; tile extraction still completes in seconds.
            set_opt(handle, "hr-seek", "yes")?;
            set_opt(handle, "hr-seek-framedrop", "yes")?;
            // Built-in downscale so every screenshot lands at thumb size.
            set_opt(handle, "vf", "scale=160:-2")?;

            let err = ffi::mpv_initialize(handle);
            if err < 0 {
                ffi::mpv_destroy(handle);
                return Err(format!("thumbnailer mpv_initialize: {}", err_str(err)));
            }

            Ok(Player { handle })
        }
    }

    /// Write the current video frame (just the frame, no OSD/subs) to disk.
    pub fn screenshot_to_file(&self, path: &str) -> Result<(), String> {
        self.command(&["screenshot-to-file", path, "video"])
    }

    /// Pass the native window handle (HWND on Windows, XID on Linux) to mpv.
    /// Must be called before the first loadfile.
    pub fn attach_to_window(&self, wid: i64) -> Result<(), String> {
        unsafe {
            let name = cstr("wid");
            let mut data = wid;
            let err = ffi::mpv_set_property(
                self.handle,
                name.as_ptr(),
                ffi::MPV_FORMAT_INT64,
                &mut data as *mut i64 as *mut c_void,
            );
            mpv_result(err, "wid")
        }
    }

    pub fn load(&self, path: &str) -> Result<(), String> {
        self.command(&["loadfile", path, "replace"])
    }

    pub fn play(&self) -> Result<(), String> {
        self.set_flag("pause", false)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.set_flag("pause", true)
    }

    pub fn set_volume(&self, v: f64) -> Result<(), String> {
        self.set_double("volume", v)
    }

    pub fn set_mute(&self, b: bool) -> Result<(), String> {
        self.set_flag("mute", b)
    }

    pub fn set_speed(&self, s: f64) -> Result<(), String> {
        self.set_double("speed", s)
    }

    pub fn seek(&self, seconds: f64, mode: &str) -> Result<(), String> {
        let s = format!("{}", seconds);
        self.command(&["seek", &s, mode])
    }

    pub fn set_audio_track(&self, id: &str) -> Result<(), String> {
        self.set_string_prop("aid", id)
    }

    pub fn set_sub_track(&self, id: &str) -> Result<(), String> {
        self.set_string_prop("sid", id)
    }

    pub fn set_subtitle_delay(&self, seconds: f64) -> Result<(), String> {
        self.set_double("sub-delay", seconds)
    }

    /// Apply every individual subtitle style property in one call.
    /// Forces `sub-ass-override=force` so styling also overrides ASS subs.
    pub fn set_subtitle_style(
        &self,
        font: &str,
        size: i64,
        color: &str,
        border_size: f64,
        border_color: &str,
        shadow_offset: f64,
        margin_y: i64,
        bold: bool,
        align_y: &str,
    ) -> Result<(), String> {
        self.set_string_prop("sub-ass-override", "force")?;
        self.set_string_prop("sub-font", font)?;
        self.set_int("sub-font-size", size)?;
        self.set_string_prop("sub-color", color)?;
        self.set_double("sub-border-size", border_size)?;
        self.set_string_prop("sub-border-color", border_color)?;
        self.set_double("sub-shadow-offset", shadow_offset)?;
        self.set_int("sub-margin-y", margin_y)?;
        self.set_flag("sub-bold", bold)?;
        self.set_string_prop("sub-align-y", align_y)?;
        Ok(())
    }

    // Public wrappers for arbitrary mpv properties. The internal set_* helpers
    // stay private; these forward to them so commands can address any property
    // name without growing one wrapper method per property.
    pub fn set_int_prop(&self, name: &str, val: i64) -> Result<(), String> {
        self.set_int(name, val)
    }
    pub fn set_double_prop(&self, name: &str, val: f64) -> Result<(), String> {
        self.set_double(name, val)
    }
    pub fn set_string_prop_pub(&self, name: &str, val: &str) -> Result<(), String> {
        self.set_string_prop(name, val)
    }

    /// Public string property reader for status/diagnostic queries.
    pub fn get_string_prop_pub(&self, name: &str) -> Option<String> {
        self.get_property_string(name)
    }

    /// Public int64 property reader, used for video-params/w, video-params/h.
    pub fn get_int_prop(&self, name: &str) -> Option<i64> {
        unsafe {
            let name_c = cstr(name);
            let mut out: i64 = 0;
            let err = ffi::mpv_get_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_INT64,
                &mut out as *mut i64 as *mut c_void,
            );
            if err < 0 {
                None
            } else {
                Some(out)
            }
        }
    }

    /// Replace the audio filter chain. Empty string clears all filters.
    /// `chain` is mpv's standard af syntax: comma-separated filter list.
    ///
    /// We try three writers in order because every approach fails on at
    /// least one libmpv build:
    ///   1. `mpv_set_property_string` — option-string parser, most lenient.
    ///   2. `mpv_set_property` + FORMAT_STRING — what we used before.
    ///   3. `af clr` / `af set <chain>` command — different parser path.
    /// The first writer that succeeds wins. Logging is suppressed for the
    /// non-final attempts so the dev console doesn't flood with bogus errors.
    pub fn set_audio_filter(&self, chain: &str) -> Result<(), String> {
        if self.set_string_prop_string_api("af", chain).is_ok() {
            return Ok(());
        }
        if self.set_string_prop_silent("af", chain).is_ok() {
            return Ok(());
        }
        if chain.is_empty() {
            self.command(&["af", "clr"])
        } else {
            self.command(&["af", "set", chain])
        }
    }

    pub fn get_property_string(&self, name: &str) -> Option<String> {
        unsafe {
            let name_c = cstr(name);
            let ptr = ffi::mpv_get_property_string(self.handle, name_c.as_ptr());
            if ptr.is_null() {
                return None;
            }
            let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            ffi::mpv_free(ptr as *mut c_void);
            Some(s)
        }
    }

    pub fn get_property_f64(&self, name: &str) -> Option<f64> {
        unsafe {
            let name_c = cstr(name);
            let mut out: f64 = 0.0;
            let err = ffi::mpv_get_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_DOUBLE,
                &mut out as *mut f64 as *mut c_void,
            );
            if err < 0 {
                None
            } else {
                Some(out)
            }
        }
    }

    pub fn get_property_flag(&self, name: &str) -> Option<bool> {
        unsafe {
            let name_c = cstr(name);
            let mut out: c_int = 0;
            let err = ffi::mpv_get_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_FLAG,
                &mut out as *mut c_int as *mut c_void,
            );
            if err < 0 {
                None
            } else {
                Some(out != 0)
            }
        }
    }

    pub fn observe_property(&self, name: &str, format: c_int, userdata: u64) -> Result<(), String> {
        unsafe {
            let name_c = cstr(name);
            let err = ffi::mpv_observe_property(self.handle, userdata, name_c.as_ptr(), format);
            mpv_result(err, name)
        }
    }

    /// Block waiting for the next mpv event. Copies relevant fields out of the
    /// raw event before returning — the underlying mpv_event* is invalidated by
    /// the next wait_event call.
    pub fn wait_event(&self, timeout: f64) -> MpvEvent {
        unsafe {
            let evt = ffi::mpv_wait_event(self.handle, timeout);
            if evt.is_null() {
                return MpvEvent::Other;
            }
            let event_id = (*evt).event_id;
            let reply = (*evt).reply_userdata;
            match event_id {
                ffi::MPV_EVENT_PROPERTY_CHANGE => MpvEvent::PropertyChange { tag: reply },
                ffi::MPV_EVENT_FILE_LOADED => MpvEvent::FileLoaded,
                ffi::MPV_EVENT_END_FILE => MpvEvent::EndFile,
                ffi::MPV_EVENT_PLAYBACK_RESTART => MpvEvent::PlaybackRestart,
                ffi::MPV_EVENT_SHUTDOWN => MpvEvent::Shutdown,
                ffi::MPV_EVENT_NONE => MpvEvent::Other,
                _ => MpvEvent::Other,
            }
        }
    }

    // ── internal helpers ──────────────────────────────────────────────────────

    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        unsafe {
            let cstrings: Vec<CString> = args.iter().map(|s| cstr(s)).collect();
            let mut ptrs: Vec<*const c_char> = cstrings.iter().map(|s| s.as_ptr()).collect();
            ptrs.push(std::ptr::null()); // null sentinel required by mpv_command
            let err = ffi::mpv_command(self.handle, ptrs.as_ptr());
            mpv_result(err, args[0])
        }
    }

    /// Like `command`, but does not log on failure. Use when the failure is
    /// expected and noisy — e.g. background thumbnailer seeks that race with
    /// file unloads or playlist transitions.
    pub fn command_silent(&self, args: &[&str]) -> Result<(), String> {
        unsafe {
            let cstrings: Vec<CString> = args.iter().map(|s| cstr(s)).collect();
            let mut ptrs: Vec<*const c_char> = cstrings.iter().map(|s| s.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            let err = ffi::mpv_command(self.handle, ptrs.as_ptr());
            if err < 0 {
                Err(format!("{}: {}", args[0], err_str(err)))
            } else {
                Ok(())
            }
        }
    }

    fn set_flag(&self, name: &str, val: bool) -> Result<(), String> {
        unsafe {
            let name_c = cstr(name);
            let mut data: c_int = if val { 1 } else { 0 };
            let err = ffi::mpv_set_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_FLAG,
                &mut data as *mut c_int as *mut c_void,
            );
            mpv_result(err, name)
        }
    }

    fn set_int(&self, name: &str, val: i64) -> Result<(), String> {
        unsafe {
            let name_c = cstr(name);
            let mut data: i64 = val;
            let err = ffi::mpv_set_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_INT64,
                &mut data as *mut i64 as *mut c_void,
            );
            mpv_result(err, name)
        }
    }

    fn set_double(&self, name: &str, val: f64) -> Result<(), String> {
        unsafe {
            let name_c = cstr(name);
            let mut data: f64 = val;
            let err = ffi::mpv_set_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_DOUBLE,
                &mut data as *mut f64 as *mut c_void,
            );
            mpv_result(err, name)
        }
    }

    fn set_string_prop(&self, name: &str, val: &str) -> Result<(), String> {
        unsafe {
            let name_c = cstr(name);
            let val_c = cstr(val);
            // For STRING format, data is a pointer to a *const c_char.
            let mut s_ptr: *const c_char = val_c.as_ptr();
            let err = ffi::mpv_set_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_STRING,
                &mut s_ptr as *mut *const c_char as *mut c_void,
            );
            mpv_result(err, name)
        }
    }

    /// Same as set_string_prop but uses the dedicated `mpv_set_property_string`
    /// FFI entrypoint. Goes through mpv's option-string parser which is more
    /// lenient for object-list properties like `af`.
    fn set_string_prop_string_api(&self, name: &str, val: &str) -> Result<(), c_int> {
        unsafe {
            let name_c = cstr(name);
            let val_c = cstr(val);
            let err = ffi::mpv_set_property_string(self.handle, name_c.as_ptr(), val_c.as_ptr());
            if err < 0 {
                Err(err)
            } else {
                Ok(())
            }
        }
    }

    /// Variant of set_string_prop that doesn't log on failure — used by the
    /// fallback chain in set_audio_filter so each unsuccessful attempt stays
    /// quiet until they all fail.
    fn set_string_prop_silent(&self, name: &str, val: &str) -> Result<(), c_int> {
        unsafe {
            let name_c = cstr(name);
            let val_c = cstr(val);
            let mut s_ptr: *const c_char = val_c.as_ptr();
            let err = ffi::mpv_set_property(
                self.handle,
                name_c.as_ptr(),
                ffi::MPV_FORMAT_STRING,
                &mut s_ptr as *mut *const c_char as *mut c_void,
            );
            if err < 0 {
                Err(err)
            } else {
                Ok(())
            }
        }
    }
}

// ── free helpers ──────────────────────────────────────────────────────────────

unsafe fn set_opt(handle: *mut ffi::mpv_handle, name: &str, value: &str) -> Result<(), String> {
    let name_c = cstr(name);
    let val_c = cstr(value);
    let err = ffi::mpv_set_option_string(handle, name_c.as_ptr(), val_c.as_ptr());
    if err < 0 {
        Err(format!("set_opt({name}={value}): {}", err_str(err)))
    } else {
        Ok(())
    }
}

/// Same as set_opt, but logs+continues on failure instead of aborting init.
/// Use for options that may not exist on every libmpv build (e.g.
/// gpu-next-only properties, platform-specific flags).
unsafe fn set_opt_optional(handle: *mut ffi::mpv_handle, name: &str, value: &str) {
    let name_c = cstr(name);
    let val_c = cstr(value);
    let err = ffi::mpv_set_option_string(handle, name_c.as_ptr(), val_c.as_ptr());
    if err < 0 {
        crate::np_warn!(
            "mpv-init",
            "optional opt {name}={value} not applied: {}",
            err_str(err)
        );
    }
}

fn mpv_result(err: c_int, ctx: &str) -> Result<(), String> {
    if err < 0 {
        let msg = format!("{ctx}: {}", unsafe { err_str(err) });
        crate::np_err!("mpv", "{msg}");
        Err(msg)
    } else {
        Ok(())
    }
}

unsafe fn err_str(code: c_int) -> String {
    let ptr = ffi::mpv_error_string(code);
    if ptr.is_null() {
        return format!("error {code}");
    }
    CStr::from_ptr(ptr).to_string_lossy().into_owned()
}

fn cstr(s: &str) -> CString {
    CString::new(s).expect("str must not contain null bytes")
}
