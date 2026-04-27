//! First-launch splash window.
//!
//! Bare Win32 (no Tauri / no WebView2) so it can be on screen within tens of
//! milliseconds — before the embedded libmpv-2.dll extraction (~6 s on a cold
//! first run) and before WebView2 cold-start. Lives on its own UI thread; the
//! main thread continues into extraction and Tauri builder. Close from any
//! thread by dropping the `SplashHandle` (or calling `close`), which posts
//! WM_CLOSE.
//!
//! Shown only when `dll_bootstrap::needs_extraction()` returns true so warm
//! launches don't get a flashing splash. After extraction the handle is
//! carried into Tauri's setup hook and closed there once the main window is
//! shown — bridges the WebView2 cold-start gap too, so the user sees a
//! continuous "loading" → "main window" transition.

#![cfg(all(target_os = "windows", target_env = "msvc"))]

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateFontW, CreateSolidBrush, DeleteObject, DrawTextW, EndPaint, FillRect,
    InvalidateRect, SelectObject, SetBkMode, SetTextColor, UpdateWindow, CLEARTYPE_QUALITY,
    DEFAULT_CHARSET, DT_CENTER, DT_SINGLELINE, DT_VCENTER, FW_BOLD, FW_NORMAL, OUT_TT_PRECIS,
    PAINTSTRUCT, TRANSPARENT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    GetSystemMetrics, KillTimer, LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassW,
    SetTimer, ShowWindow, TranslateMessage, HMENU, IDC_ARROW, MSG, SM_CXSCREEN, SM_CYSCREEN,
    SW_SHOW, WM_CLOSE, WM_DESTROY, WM_PAINT, WM_TIMER, WNDCLASSW, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};

const CLASS_NAME: PCWSTR = w!("TracePlayerSplash");
const TITLE: &str = "Trace Player";
const SUBTITLE: &str = "Setting things up, this only happens once";
const WIN_W: i32 = 460;
const WIN_H: i32 = 180;
const TIMER_ID: usize = 1;
const TIMER_PERIOD_MS: u32 = 350;

/// Tick counter for the animated dots. Bumped from WM_TIMER, read in WM_PAINT.
static TICK: AtomicU32 = AtomicU32::new(0);

/// Owns the splash UI thread. Drop or `close()` to dismiss the window.
pub struct SplashHandle {
    /// HWND stored as raw isize so the handle is `Send`. The window itself
    /// only ever runs on the UI thread; PostMessageW is documented as
    /// thread-safe so the close path is safe from any thread.
    hwnd: isize,
    thread: Option<JoinHandle<()>>,
}

impl SplashHandle {
    pub fn close(self) {
        // Drop runs the shutdown logic.
        drop(self);
    }
}

impl Drop for SplashHandle {
    fn drop(&mut self) {
        if self.hwnd != 0 {
            unsafe {
                let _ = PostMessageW(
                    HWND(self.hwnd as *mut _),
                    WM_CLOSE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
            self.hwnd = 0;
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Spawn the splash UI thread. Returns once the window has been created and
/// is on screen, or after a 2 s safety timeout if creation fails. Returns
/// `None` if the window couldn't be created — bootstrap proceeds without a
/// splash in that case.
pub fn show() -> Option<SplashHandle> {
    let (tx, rx) = mpsc::channel::<isize>();
    let thread = thread::spawn(move || unsafe { run_message_loop(tx) });
    let hwnd = rx.recv_timeout(Duration::from_millis(2000)).ok()?;
    if hwnd == 0 {
        let _ = thread.join();
        return None;
    }
    Some(SplashHandle {
        hwnd,
        thread: Some(thread),
    })
}

unsafe fn run_message_loop(tx: mpsc::Sender<isize>) {
    let hinstance: windows::Win32::Foundation::HINSTANCE =
        GetModuleHandleW(None).unwrap_or_default().into();

    let bg_brush = CreateSolidBrush(COLORREF(0x000a0a0a));

    let wc = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: hinstance,
        hbrBackground: bg_brush,
        lpszClassName: CLASS_NAME,
        hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
        ..Default::default()
    };
    // Returns 0 if the class is already registered (rare; only matters if
    // `show` is called twice). We accept that and keep going.
    let _ = RegisterClassW(&wc);

    let cx = GetSystemMetrics(SM_CXSCREEN);
    let cy = GetSystemMetrics(SM_CYSCREEN);
    let x = ((cx - WIN_W) / 2).max(0);
    let y = ((cy - WIN_H) / 2).max(0);

    let null_parent: HWND = HWND::default();
    let null_menu: HMENU = HMENU::default();

    let hwnd = match CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        CLASS_NAME,
        w!("Trace Player"),
        WS_POPUP | WS_VISIBLE,
        x,
        y,
        WIN_W,
        WIN_H,
        null_parent,
        null_menu,
        hinstance,
        None,
    ) {
        Ok(h) => h,
        Err(_) => {
            let _ = tx.send(0);
            let _ = DeleteObject(bg_brush);
            return;
        }
    };

    let _ = ShowWindow(hwnd, SW_SHOW);
    let _ = UpdateWindow(hwnd);
    SetTimer(hwnd, TIMER_ID, TIMER_PERIOD_MS, None);

    let _ = tx.send(hwnd.0 as isize);

    let mut msg = MSG::default();
    let null_owner: HWND = HWND::default();
    while GetMessageW(&mut msg, null_owner, 0, 0).as_bool() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    let _ = DeleteObject(bg_brush);
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_PAINT => {
            paint(hwnd);
            LRESULT(0)
        }
        WM_TIMER => {
            TICK.fetch_add(1, Ordering::Relaxed);
            let _ = InvalidateRect(hwnd, None, false);
            LRESULT(0)
        }
        WM_CLOSE => {
            let _ = KillTimer(hwnd, TIMER_ID);
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe fn paint(hwnd: HWND) {
    let mut ps = PAINTSTRUCT::default();
    let hdc = BeginPaint(hwnd, &mut ps);

    let full = RECT {
        left: 0,
        top: 0,
        right: WIN_W,
        bottom: WIN_H,
    };
    let bg = CreateSolidBrush(COLORREF(0x000a0a0a));
    FillRect(hdc, &full, bg);

    // Accent stripe along the bottom (BGR — #3b82f6 → 0xf6823b).
    let stripe = RECT {
        left: 0,
        top: WIN_H - 3,
        right: WIN_W,
        bottom: WIN_H,
    };
    let accent = CreateSolidBrush(COLORREF(0x00f6823b));
    FillRect(hdc, &stripe, accent);

    let _ = SetBkMode(hdc, TRANSPARENT);

    let title_font = CreateFontW(
        34,
        0,
        0,
        0,
        FW_BOLD.0 as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET.0 as u32,
        OUT_TT_PRECIS.0 as u32,
        0,
        CLEARTYPE_QUALITY.0 as u32,
        0,
        w!("Segoe UI"),
    );
    let body_font = CreateFontW(
        16,
        0,
        0,
        0,
        FW_NORMAL.0 as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET.0 as u32,
        OUT_TT_PRECIS.0 as u32,
        0,
        CLEARTYPE_QUALITY.0 as u32,
        0,
        w!("Segoe UI"),
    );

    let old_font = SelectObject(hdc, title_font);
    SetTextColor(hdc, COLORREF(0x00f5f5f5));
    let mut title_buf: Vec<u16> = TITLE.encode_utf16().collect();
    let mut title_rect = RECT {
        left: 0,
        top: 32,
        right: WIN_W,
        bottom: 88,
    };
    DrawTextW(
        hdc,
        &mut title_buf,
        &mut title_rect,
        DT_CENTER | DT_SINGLELINE | DT_VCENTER,
    );

    SelectObject(hdc, body_font);
    SetTextColor(hdc, COLORREF(0x00afa39c));
    let dots = (TICK.load(Ordering::Relaxed) % 4) as usize;
    let line = format!("{SUBTITLE}{}", ".".repeat(dots));
    let mut line_buf: Vec<u16> = line.encode_utf16().collect();
    let mut sub_rect = RECT {
        left: 0,
        top: 96,
        right: WIN_W,
        bottom: 152,
    };
    DrawTextW(
        hdc,
        &mut line_buf,
        &mut sub_rect,
        DT_CENTER | DT_SINGLELINE | DT_VCENTER,
    );

    SelectObject(hdc, old_font);
    let _ = DeleteObject(title_font);
    let _ = DeleteObject(body_font);
    let _ = DeleteObject(bg);
    let _ = DeleteObject(accent);

    let _ = EndPaint(hwnd, &ps);
}
