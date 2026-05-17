mod agc;
mod archive;
mod commands;
mod events;
mod library;
mod log;
mod perf;
mod player;
mod power;
mod state;
mod streaming;
mod thumbnailer;

#[cfg(all(target_os = "windows", target_env = "msvc"))]
mod dll_bootstrap;
#[cfg(target_os = "windows")]
mod smtc;
#[cfg(all(target_os = "windows", target_env = "msvc"))]
mod splash;
#[cfg(target_os = "windows")]
mod taskbar;

use std::sync::Arc;

use player::Player;
use state::AppState;
use tauri::{Emitter, Manager};

// ── WebView HWND lookup (Windows) ───────────────────────────────────────────
//
// We still cache the WebView2 child HWND at startup (some integrations want
// it), but the dormancy hide/show shims are now no-ops — see hide_webview /
// show_webview below for the rationale.
#[cfg(target_os = "windows")]
mod ui_visibility {
    use std::ffi::c_void;
    use std::ptr;

    type HWND = *mut c_void;
    type BOOL = i32;
    type LPARAM = isize;

    extern "system" {
        fn EnumChildWindows(
            hwnd_parent: HWND,
            lp_enum_func: extern "system" fn(HWND, LPARAM) -> BOOL,
            l_param: LPARAM,
        ) -> BOOL;
        fn GetClassNameW(hwnd: HWND, lp_class_name: *mut u16, n_max_count: i32) -> i32;
    }

    extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let mut buf = [0u16; 128];
        let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), 128) };
        if len > 0 {
            let cls = String::from_utf16_lossy(&buf[..len as usize]);
            // The WebView2 host registers its window with a Chromium widget
            // class. mpv's render child uses different class names, so this
            // selector reliably finds the WebView and not mpv.
            if cls.starts_with("Chrome_WidgetWin_") {
                unsafe {
                    let out = lparam as *mut HWND;
                    *out = hwnd;
                }
                return 0; // stop enumeration
            }
        }
        1 // continue
    }

    /// Walks the parent HWND's children for a Chromium-Widget class window
    /// and returns its HWND as isize.
    pub fn find_webview(parent: isize) -> Option<isize> {
        let parent_hwnd = parent as HWND;
        let mut result: HWND = ptr::null_mut();
        unsafe {
            EnumChildWindows(parent_hwnd, enum_proc, &mut result as *mut HWND as LPARAM);
        }
        if result.is_null() {
            None
        } else {
            Some(result as isize)
        }
    }
}

/// Cross-platform shim. Currently a no-op everywhere: SW_HIDE on the
/// WebView2 child got stuck on some systems — once hidden, ShowWindow
/// (SW_SHOWNOACTIVATE) didn't reliably bring it back, so the user was
/// left with mpv playing while the React UI was unreachable except via
/// keyboard shortcuts. JS-side CSS visibility:hidden still hides the
/// controls and Page-Visibility-throttles JS rAF — the OS-level surface
/// drop was a marginal-extra power saving and not worth the bug.
pub(crate) fn hide_webview(_hwnd: isize) {
    // intentionally empty
}

pub(crate) fn show_webview(_hwnd: isize) {
    // intentionally empty
}

/// Resolve a binary that the installer placed alongside the .exe. Tries
/// several candidate paths so the same code works across:
///   - NSIS install:           `<exe_dir>\bin\<name>`
///   - Tauri resource bundle:  `<exe_dir>\resources\bin\<name>`
///                             `<exe_dir>\resources\assets\<name>`
///   - Loose next-to-exe:      `<exe_dir>\<name>`
///   - `cargo tauri dev` from the source tree: walks up looking for
///     `src-tauri\assets\<name>`
pub(crate) fn find_bundled_binary(name: &str) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    let mut candidates: Vec<std::path::PathBuf> = vec![
        dir.join("bin").join(name),
        dir.join("resources").join("bin").join(name),
        dir.join("resources").join("assets").join(name),
        dir.join(name),
    ];
    let mut up = dir.to_path_buf();
    for _ in 0..6 {
        candidates.push(up.join("src-tauri").join("assets").join(name));
        candidates.push(up.join("assets").join(name));
        match up.parent() {
            Some(p) => up = p.to_path_buf(),
            None => break,
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Pull a video source out of CLI args. Skips the program name and any
/// flags (anything starting with `-`). Returns the first arg that is either
/// a real file, a `.torrent` file path, or a recognized network URL scheme
/// (http/https/rtsp/rtmp/mms/magnet/file). Magnet URIs and `.torrent` files
/// are handled later by the streaming module.
fn first_file_arg(argv: &[String]) -> Option<String> {
    for raw in argv.iter().skip(1) {
        if raw.starts_with('-') {
            continue;
        }
        if is_supported_source(raw) {
            return Some(raw.clone());
        }
    }
    None
}

fn is_supported_source(s: &str) -> bool {
    if std::path::Path::new(s).is_file() {
        return true;
    }
    let lower = s.to_ascii_lowercase();
    if lower.ends_with(".torrent") {
        return true;
    }
    matches!(
        lower.split_once(':').map(|(scheme, _)| scheme),
        Some("http" | "https" | "rtsp" | "rtmp" | "mms" | "magnet" | "file")
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    np_info!("boot", "Trace Player starting");

    // Show a Win32 splash on cold first launch only, so the user sees
    // something while the embedded libmpv-2.dll (~121 MB) is written to
    // %LOCALAPPDATA%. The handle is carried into Tauri's setup hook below
    // and dropped after the main window is shown — that bridges WebView2
    // cold-start too, so the user never sees a blank screen.
    #[cfg(all(target_os = "windows", target_env = "msvc"))]
    let splash_handle: Option<splash::SplashHandle> = if dll_bootstrap::needs_extraction() {
        splash::show()
    } else {
        None
    };

    // Extract the embedded libmpv-2.dll to %LOCALAPPDATA%\TracePlayer\bin and
    // LoadLibraryW-preload it before any libmpv FFI call. The bin is linked
    // with /DELAYLOAD:libmpv-2.dll so this preload is what satisfies the
    // delayed import — without it, the first FFI call would fail.
    #[cfg(all(target_os = "windows", target_env = "msvc"))]
    match dll_bootstrap::extract_and_preload() {
        Ok(path) => np_info!("boot", "libmpv ready at {}", path.display()),
        Err(e) => np_err!("boot", "libmpv bootstrap failed: {e}"),
    }

    let player_arc: Option<Arc<Player>> = match Player::new() {
        Ok(p) => {
            np_info!("boot", "main mpv created");
            Some(Arc::new(p))
        }
        Err(e) => {
            np_err!("boot", "mpv init failed: {e}");
            None
        }
    };

    let thumbnailer_arc: Option<Arc<Player>> = match Player::new_thumbnailer() {
        Ok(p) => {
            np_info!("boot", "thumbnailer mpv created");
            Some(Arc::new(p))
        }
        Err(e) => {
            np_err!("boot", "thumbnailer mpv init failed: {e}");
            None
        }
    };

    let player_for_setup = player_arc.clone();

    let app_state = AppState::new(player_arc.clone(), thumbnailer_arc.clone());
    let agc_for_loop = app_state.agc.clone();
    let agc_for_events = app_state.agc.clone();
    let perf_for_power = app_state.perf.clone();
    let perf_for_setup = app_state.perf.clone();
    let ui_for_events = app_state.ui.clone();
    #[cfg(target_os = "windows")]
    let ui_for_setup = app_state.ui.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = first_file_arg(&argv) {
                let _ = app.emit("mpv:cli-file", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:library.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "create library tables",
                            sql: include_str!("../migrations/001_library.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "add file_index to items",
                            sql: include_str!("../migrations/002_add_file_index.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .manage(app_state)
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");

            // Locate the bundled shader directory (resources/shaders/*.glsl)
            // for upscaling. Production builds receive the directory through
            // Tauri's resource resolver; dev/cargo-run sessions don't get the
            // resources copied into target/<profile>/, so walk up from the
            // executable to find src-tauri/resources/shaders/. Whichever
            // candidate exists wins — if none exist, upscaling silently
            // falls back to the built-in scaler.
            if let Some(shader_dir) = find_shader_dir(app) {
                np_info!("boot", "shader_dir = {}", shader_dir.display());
                perf_for_setup.set_shader_dir(shader_dir);
            } else {
                np_warn!("boot", "no shader_dir found in any candidate");
            }

            if let Some(ref player) = player_for_setup {
                attach_mpv_to_window(player, &window);

                // Cache the WebView HWND once; the dormant/wake commands
                // reuse it without re-enumerating. Windows-only — on Linux
                // the JS side handles dormancy via CSS alone.
                #[cfg(target_os = "windows")]
                {
                    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                    if let Ok(handle) = window.window_handle() {
                        if let RawWindowHandle::Win32(h) = handle.as_raw() {
                            let parent_hwnd = h.hwnd.get();
                            set_window_black_background(parent_hwnd);
                            if let Some(wv) = ui_visibility::find_webview(parent_hwnd) {
                                np_info!("ui", "found WebView2 HWND {:#x}", wv);
                                ui_for_setup.set_webview_hwnd(wv);
                            } else {
                                np_warn!(
                                    "ui",
                                    "WebView2 HWND not found — dormancy will be JS-only"
                                );
                            }
                        }
                    }
                }

                // Forward mouse + wheel events from mpv into the Rust event
                // loop as `script-message ui-wake`. The events handler emits
                // `ui:wake` to JS only when currently dormant, so the 60 Hz
                // MOUSE_MOVE storm doesn't cross IPC during normal use.
                for key in &[
                    "MOUSE_MOVE",
                    "MBTN_LEFT",
                    "MBTN_LEFT_DBL",
                    "MBTN_RIGHT",
                    "MBTN_MID",
                    "WHEEL_UP",
                    "WHEEL_DOWN",
                ] {
                    let _ = player.command(&["keybind", key, "script-message ui-wake"]);
                }

                events::start_event_loop(
                    app.handle().clone(),
                    player.clone(),
                    agc_for_events.clone(),
                    ui_for_events.clone(),
                );
                agc::start_agc_loop(player.clone(), agc_for_loop.clone());

                // Windows: spin up SMTC + taskbar thumb-bar. Both feed into a
                // single mpsc channel that a worker thread translates into
                // mpv player commands.
                #[cfg(target_os = "windows")]
                {
                    install_windows_integrations(&window, player.clone());
                }

                // Power detection: emit mpv:power-state on every flip, and
                // when profile==Auto, re-resolve and re-apply the underlying
                // mpv settings + emit mpv:perf-applied so the UI mirrors them.
                let player_for_power = player.clone();
                let perf_for_react = perf_for_power.clone();
                power::start_power_loop(
                    app.handle().clone(),
                    perf_for_power.clone(),
                    move |app_handle, _on_battery| {
                        let dir = perf_for_react.shader_dir_clone();
                        if let Some(resolved) = perf::react_to_power_change(
                            &player_for_power,
                            &perf_for_react,
                            dir.as_ref(),
                        ) {
                            let _ = app_handle.emit("mpv:perf-applied", resolved);
                        }
                    },
                );
            }

            // First-launch CLI arg ("Open with" → we are the new process).
            let argv: Vec<String> = std::env::args().collect();
            let hover_preview = argv.iter().any(|a| a == "--hover" || a == "--hover=true");
            let _ = app
                .handle()
                .emit("mpv:hover-preview-enabled", hover_preview);
            if let Some(path) = first_file_arg(&argv) {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let _ = app_handle.emit("mpv:cli-file", path);
                });
            }

            // Reveal the main window now that mpv is attached and the React
            // frontend has had a chance to mount, then dismiss the splash so
            // the handoff looks like a single uninterrupted load.
            let _ = window.show();
            let _ = window.set_focus();
            #[cfg(all(target_os = "windows", target_env = "msvc"))]
            if let Some(s) = splash_handle {
                s.close();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_file,
            commands::play,
            commands::pause,
            commands::seek,
            commands::set_volume,
            commands::set_mute,
            commands::set_speed,
            commands::set_audio_track,
            commands::set_subtitle_track,
            commands::get_tracks,
            commands::set_audio_filters,
            commands::set_subtitle_style,
            commands::set_subtitle_delay,
            commands::start_thumbnailing,
            commands::request_thumb_window,
            commands::request_thumb_exact,
            commands::set_image_params,
            commands::set_aspect,
            commands::set_zoom,
            commands::set_rotate,
            commands::take_screenshot,
            commands::set_ab_loop_a,
            commands::set_ab_loop_b,
            commands::set_audio_fx,
            commands::set_hdr_mode,
            commands::set_upscaling,
            commands::set_interpolation,
            commands::set_vsync,
            commands::set_exclusive_fullscreen,
            commands::set_perf_profile,
            commands::chapter_seek,
            commands::ab_loop_cycle,
            commands::ab_loop_clear,
            commands::set_screenshot_dir,
            commands::get_pipeline_info,
            commands::set_loop_file,
            commands::set_loop_playlist,
            commands::playlist_shuffle,
            commands::playlist_unshuffle,
            commands::playlist_add,
            commands::playlist_add_many,
            commands::playlist_remove,
            commands::playlist_play_index,
            commands::playlist_clear,
            commands::playlist_next,
            commands::playlist_prev,
            commands::playlist_move,
            commands::get_playlist,
            commands::get_player_state,
            commands::load_subtitle,
            commands::frame_step,
            commands::set_deinterlace,
            commands::get_audio_devices,
            commands::set_audio_device,
            commands::get_media_info,
            commands::enter_pip,
            commands::exit_pip,
            commands::force_redraw,
            commands::ui_dormant,
            commands::ui_wake,
            commands::open_source,
            commands::set_stream_cache,
            commands::open_archive,
            commands::set_torrent_cache_limit,
            commands::resolve_torrent_files,
            commands::resolve_torrent_file,
            commands::cancel_torrent_resolve,
            commands::list_downloads,
            commands::pause_download,
            commands::resume_download,
            commands::start_download,
            commands::stop_download,
            library::generate_library_thumb,
            library::read_thumb_base64,
            library::get_app_thumb_dir,
            library::read_directory_videos,
            library::scan_common_folders,
            library::get_file_metadata,
            library::probe_video_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // RunEvent::Exit fires once after every window has been
            // requested-close and right before tauri tears down managed
            // state. We use it to ask rqbit to forget every torrent we added
            // this session — the StreamingSession's Drop kills the sidecar
            // unconditionally, but forget() lets rqbit flush cleanly first.
            if matches!(event, tauri::RunEvent::Exit) {
                let st: tauri::State<'_, AppState> = app_handle.state();
                commands::forget_all_torrents(st.inner());
            }
        });
}

/// Resolve the directory that holds the bundled FSRCNNX / KrigBilateral
/// shaders. Multi-candidate so it works in:
///   - Production: Tauri's resource_dir contains a `shaders/` subfolder
///     (matching the `bundle.resources` map in tauri.conf.json).
///   - `tauri dev` / `cargo run`: resources aren't always copied to
///     target/<profile>/, so walk up from the executable until we hit
///     `<src-tauri>/resources/shaders/`.
/// Returns the first candidate that contains at least one expected `.glsl`.
fn find_shader_dir(app: &tauri::App) -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("shaders"));
        candidates.push(res.join("resources").join("shaders"));
        candidates.push(res);
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        for _ in 0..6 {
            candidates.push(dir.join("resources").join("shaders"));
            candidates.push(dir.join("shaders"));
            match dir.parent() {
                Some(p) => dir = p.to_path_buf(),
                None => break,
            }
        }
    }

    for cand in &candidates {
        if cand.join("FSRCNNX_x2_8-0-4-1.glsl").exists()
            || cand.join("FSRCNNX_x2_16-0-4-1.glsl").exists()
            || cand.join("KrigBilateral.glsl").exists()
        {
            return Some(cand.clone());
        }
    }

    np_debug!(
        "boot",
        "shader candidates checked, none had matching files: {:?}",
        candidates
    );
    None
}

fn attach_mpv_to_window(player: &Player, window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let wid = match window.window_handle() {
            Ok(handle) => match handle.as_raw() {
                RawWindowHandle::Win32(h) => h.hwnd.get() as i64,
                _ => {
                    np_err!("attach", "unexpected window handle type on Windows");
                    return;
                }
            },
            Err(e) => {
                np_err!("attach", "could not get window handle: {e}");
                return;
            }
        };

        if let Err(e) = player.attach_to_window(wid) {
            np_err!("attach", "attach_to_window failed: {e}");
        } else {
            np_info!("attach", "attached mpv to HWND {wid:#x}");
        }
    }

    #[cfg(target_os = "linux")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let wid = match window.window_handle() {
            Ok(handle) => match handle.as_raw() {
                RawWindowHandle::Xlib(h) => h.window as i64,
                RawWindowHandle::Xcb(h) => h.window.get() as i64,
                _ => {
                    np_err!("attach", "unexpected window handle type on Linux");
                    return;
                }
            },
            Err(e) => {
                np_err!("attach", "could not get window handle: {e}");
                return;
            }
        };

        if let Err(e) = player.attach_to_window(wid) {
            np_err!("attach", "attach_to_window failed: {e}");
        } else {
            np_info!("attach", "attached mpv to wid {wid}");
        }
    }

    #[cfg(target_os = "macos")]
    {
        let _ = window;
        let _ = player;
        np_warn!("attach", "macOS wid embedding not yet implemented");
    }
}

/// Windows-only: bring up SMTC + thumbbar toolbar and a worker thread that
/// translates their button presses into mpv commands. Failures are logged
/// but non-fatal — the player still works without these integrations.
#[cfg(target_os = "windows")]
fn install_windows_integrations(window: &tauri::WebviewWindow, player: Arc<Player>) {
    use std::sync::mpsc;

    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let hwnd = match window.window_handle() {
        Ok(h) => match h.as_raw() {
            RawWindowHandle::Win32(w) => w.hwnd.get(),
            _ => return,
        },
        Err(_) => return,
    };

    // Two channels: one for SMTC, one for taskbar. Separate enums keep the
    // type signatures clean. The worker fans both into player commands.
    let (smtc_tx, smtc_rx) = mpsc::channel::<smtc::SmtcCommand>();
    let (tb_tx, tb_rx) = mpsc::channel::<taskbar::TaskbarCommand>();

    let smtc_ctrl = match smtc::SmtcController::new(hwnd, smtc_tx) {
        Ok(s) => {
            np_info!("smtc", "controller initialized");
            Some(Arc::new(s))
        }
        Err(e) => {
            np_err!("smtc", "init failed: {e}");
            None
        }
    };

    let tb_ctrl = match taskbar::TaskbarToolbar::start(hwnd, tb_tx) {
        Ok(t) => {
            np_info!("taskbar", "toolbar initialized");
            Some(t)
        }
        Err(e) => {
            np_err!("taskbar", "toolbar init failed: {e}");
            None
        }
    };

    // Worker thread — owns both receivers. Plays/pauses go through the
    // Player API; next/prev hit mpv's playlist commands directly.
    let player_for_worker = player.clone();
    std::thread::spawn(move || loop {
        // Cheap poll-both pattern: try smtc with a short timeout, then taskbar.
        if let Ok(cmd) = smtc_rx.recv_timeout(std::time::Duration::from_millis(50)) {
            handle_smtc(&player_for_worker, cmd);
        }
        if let Ok(cmd) = tb_rx.try_recv() {
            handle_taskbar(&player_for_worker, cmd);
        }
    });

    // Mirror playback state into SMTC + taskbar. Was 250 ms (4 Hz) — that
    // pinned the CPU in C2/C3 forever, blocking deep idle. 1000 ms (1 Hz)
    // matches what Win11's volume flyout actually consumes; the scrubber
    // update is slightly chunkier but battery cost drops 4×.
    if smtc_ctrl.is_some() || tb_ctrl.is_some() {
        let player_for_mirror = player.clone();
        let smtc_for_mirror = smtc_ctrl.clone();
        let tb_for_mirror = tb_ctrl.clone();
        std::thread::spawn(move || {
            let mut last_paused: Option<bool> = None;
            let mut last_title: Option<String> = None;
            let mut tick: u32 = 0;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(1000));
                let paused = player_for_mirror.get_property_flag("pause").unwrap_or(true);
                if last_paused != Some(paused) {
                    if let Some(ref s) = smtc_for_mirror {
                        s.set_playing(!paused);
                    }
                    if let Some(ref t) = tb_for_mirror {
                        t.set_playing(!paused);
                    }
                    last_paused = Some(paused);
                }

                // Title + timeline updates ride the same poll. Title rarely
                // changes — only after loadfile — so we just diff. Timeline
                // pushes every tick (~4 Hz) which is what Win11 expects for
                // the volume-flyout scrubber.
                if let Some(ref s) = smtc_for_mirror {
                    if let Some(title) = player_for_mirror.get_string_prop_pub("media-title") {
                        if last_title.as_deref() != Some(title.as_str()) {
                            s.set_metadata(&title, None);
                            last_title = Some(title);
                        }
                    }
                    let pos = player_for_mirror
                        .get_property_f64("time-pos")
                        .unwrap_or(0.0);
                    let dur = player_for_mirror
                        .get_property_f64("duration")
                        .unwrap_or(0.0);
                    s.set_timeline(pos, dur);
                }
                tick = tick.wrapping_add(1);
            }
        });
    }

    // Keep both alive for the lifetime of the process by leaking them.
    if let Some(s) = smtc_ctrl {
        Box::leak(Box::new(s));
    }
    if let Some(t) = tb_ctrl {
        Box::leak(Box::new(t));
    }
}

#[cfg(target_os = "windows")]
fn handle_smtc(player: &Arc<Player>, cmd: smtc::SmtcCommand) {
    match cmd {
        smtc::SmtcCommand::Play => {
            let _ = player.play();
        }
        smtc::SmtcCommand::Pause => {
            let _ = player.pause();
        }
        smtc::SmtcCommand::Next => {
            let _ = player.command(&["playlist-next", "weak"]);
        }
        smtc::SmtcCommand::Prev => {
            let _ = player.command(&["playlist-prev", "weak"]);
        }
    }
}

#[cfg(target_os = "windows")]
fn handle_taskbar(player: &Arc<Player>, cmd: taskbar::TaskbarCommand) {
    match cmd {
        taskbar::TaskbarCommand::PlayPause => {
            let paused = player.get_property_flag("pause").unwrap_or(false);
            if paused {
                let _ = player.play();
            } else {
                let _ = player.pause();
            }
        }
        taskbar::TaskbarCommand::Next => {
            let _ = player.command(&["playlist-next", "weak"]);
        }
        taskbar::TaskbarCommand::Prev => {
            let _ = player.command(&["playlist-prev", "weak"]);
        }
    }
}

/// Paint the Win32 parent HWND's background solid black so it appears behind
/// every child surface (mpv render child, WebView2 child). Without this the
/// Tauri transparent window shows the desktop through any unrendered region —
/// before a file loads, letterbox bars, or brief inter-frame gaps.
///
/// SetClassLongPtrW with GCLP_HBRBACKGROUND (-10) installs the brush on the
/// window's class so WM_ERASEBKGND paints black. InvalidateRect forces an
/// immediate repaint so the effect is visible before the first mpv frame.
#[cfg(target_os = "windows")]
fn set_window_black_background(hwnd: isize) {
    use windows::Win32::Foundation::{BOOL, COLORREF, HWND};
    use windows::Win32::Graphics::Gdi::{CreateSolidBrush, InvalidateRect};
    use windows::Win32::UI::WindowsAndMessaging::{SetClassLongPtrW, GET_CLASS_LONG_INDEX};

    const GCLP_HBRBACKGROUND: GET_CLASS_LONG_INDEX = GET_CLASS_LONG_INDEX(-10i32);

    unsafe {
        let hwnd = HWND(hwnd as *mut core::ffi::c_void);
        let brush = CreateSolidBrush(COLORREF(0x00000000));
        if !brush.is_invalid() {
            SetClassLongPtrW(hwnd, GCLP_HBRBACKGROUND, brush.0 as isize);
            let _ = InvalidateRect(hwnd, None, BOOL(1));
        }
    }
}
