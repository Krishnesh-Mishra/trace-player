//! Windows taskbar thumb-bar toolbar (Prev / Play-Pause / Next).
//!
//! The buttons are 24×24 monochrome icons drawn at runtime into BGRA pixel
//! buffers and turned into HICONs via CreateIconIndirect. This avoids
//! shipping additional .ico assets.
//!
//! Lifecycle: ITaskbarList3 must see the taskbar button created before
//! ThumbBarAddButtons is accepted (Windows posts WM_TASKBARBUTTONCREATED
//! when ready). We register a window subclass that:
//!   • on WM_TASKBARBUTTONCREATED → calls add_buttons()
//!   • on WM_COMMAND with our button id → dispatches a TaskbarCommand
//!     into the same mpsc channel SMTC uses.
//!
//! Idempotent: calling start() twice on the same HWND is safe.

#![cfg(target_os = "windows")]

use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, OnceLock};

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateCompatibleBitmap, DeleteObject, GetDC, ReleaseDC,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, TaskbarList,
    THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, DestroyIcon, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND,
};

#[derive(Debug, Clone, Copy)]
pub enum TaskbarCommand {
    Prev,
    PlayPause,
    Next,
}

const ID_PREV: u32 = 50001;
const ID_PLAYPAUSE: u32 = 50002;
const ID_NEXT: u32 = 50003;
const SUBCLASS_ID: usize = 0xC0DE_BABE;

/// Static channel used by the window-procedure subclass to dispatch button
/// presses. Set once at start() and read by the subclass on every message.
static CMD_TX: OnceLock<Mutex<Option<Sender<TaskbarCommand>>>> = OnceLock::new();
/// Cached registered window message id for "TaskbarButtonCreated".
static WM_TBBC: OnceLock<u32> = OnceLock::new();

pub struct TaskbarToolbar {
    hwnd: HWND,
    taskbar: ITaskbarList3,
    play_icon: HICON,
    pause_icon: HICON,
    prev_icon: HICON,
    next_icon: HICON,
    is_playing: Mutex<bool>,
}

// SAFETY: TaskbarToolbar is created on the main thread (its window subclass
// must run on the window's message-pump thread) and its Arc is shared with
// the worker thread for set_playing calls. ITaskbarList3 is effectively
// free-threaded in the Windows shell — ThumbBarUpdateButtons marshals
// correctly when called cross-apartment. The HWND and HICON fields are
// plain handles safe to share across threads.
unsafe impl Send for TaskbarToolbar {}
unsafe impl Sync for TaskbarToolbar {}

impl TaskbarToolbar {
    /// Initialize COM (apartment-threaded, idempotent for this thread),
    /// create the ITaskbarList3, build icons, install subclass. The actual
    /// ThumbBarAddButtons call is deferred to the WM_TASKBARBUTTONCREATED
    /// handler.
    pub fn start(hwnd_raw: isize, tx: Sender<TaskbarCommand>) -> Result<Arc<Self>, String> {
        unsafe {
            // COM init — APARTMENTTHREADED matches what most Tauri/Win32 apps
            // do on the main thread. Returns S_FALSE if already initialized,
            // which we accept.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            let taskbar: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("CoCreateInstance(TaskbarList): {e}"))?;
            taskbar
                .HrInit()
                .map_err(|e| format!("ITaskbarList3::HrInit: {e}"))?;

            let prev_icon = make_icon(IconKind::Prev)?;
            let next_icon = make_icon(IconKind::Next)?;
            let play_icon = make_icon(IconKind::Play)?;
            let pause_icon = make_icon(IconKind::Pause)?;

            let hwnd = HWND(hwnd_raw as *mut _);

            // Stash the channel for the subclass proc.
            let slot = CMD_TX.get_or_init(|| Mutex::new(None));
            *slot.lock().unwrap() = Some(tx);

            // Cache the WM_TASKBARBUTTONCREATED message id (registered name).
            WM_TBBC.get_or_init(|| {
                let name: Vec<u16> = "TaskbarButtonCreated\0".encode_utf16().collect();
                RegisterWindowMessageW(windows::core::PCWSTR(name.as_ptr()))
            });

            let me = Arc::new(Self {
                hwnd,
                taskbar,
                play_icon,
                pause_icon,
                prev_icon,
                next_icon,
                is_playing: Mutex::new(false),
            });

            // Stash a raw Arc-clone pointer in the subclass so the proc can
            // call back into add_buttons / set_playing on demand.
            let raw = Arc::into_raw(me.clone()) as usize;
            let ok = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, raw);
            if !ok.as_bool() {
                let _ = Arc::from_raw(raw as *const Self); // drop our clone
                return Err("SetWindowSubclass failed".into());
            }

            // If the taskbar button already exists (window already shown),
            // attempt to add buttons immediately. The subclass will retry on
            // WM_TASKBARBUTTONCREATED if this fails.
            let _ = me.add_buttons();

            Ok(me)
        }
    }

    /// Push the current 3-button set to the taskbar. Safe to call repeatedly.
    fn add_buttons(&self) -> Result<(), String> {
        unsafe {
            let buttons = [
                make_button(ID_PREV, self.prev_icon, "Previous"),
                make_button(ID_PLAYPAUSE, self.play_icon, "Play / Pause"),
                make_button(ID_NEXT, self.next_icon, "Next"),
            ];
            self.taskbar
                .ThumbBarAddButtons(self.hwnd, &buttons)
                .map_err(|e| format!("ThumbBarAddButtons: {e}"))?;
            Ok(())
        }
    }

    /// Update the middle button between play/pause icons.
    pub fn set_playing(&self, playing: bool) {
        let mut g = match self.is_playing.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if *g == playing {
            return;
        }
        *g = playing;
        unsafe {
            let icon = if playing {
                self.pause_icon
            } else {
                self.play_icon
            };
            let buttons = [
                make_button(ID_PREV, self.prev_icon, "Previous"),
                make_button(ID_PLAYPAUSE, icon, if playing { "Pause" } else { "Play" }),
                make_button(ID_NEXT, self.next_icon, "Next"),
            ];
            let _ = self.taskbar.ThumbBarUpdateButtons(self.hwnd, &buttons);
        }
    }
}

impl Drop for TaskbarToolbar {
    fn drop(&mut self) {
        unsafe {
            let _ = RemoveWindowSubclass(self.hwnd, Some(subclass_proc), SUBCLASS_ID);
            let _ = DestroyIcon(self.play_icon);
            let _ = DestroyIcon(self.pause_icon);
            let _ = DestroyIcon(self.prev_icon);
            let _ = DestroyIcon(self.next_icon);
        }
    }
}

unsafe fn make_button(id: u32, icon: HICON, tooltip: &str) -> THUMBBUTTON {
    let mut tip = [0u16; 260];
    for (i, c) in tooltip.encode_utf16().take(259).enumerate() {
        tip[i] = c;
    }
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: tip,
        dwFlags: THBF_ENABLED,
        ..Default::default()
    }
}

extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    unsafe {
        // Re-borrow our Arc<Self> for the duration of this call without
        // taking ownership (the original raw pointer is reclaimed only on
        // RemoveWindowSubclass via Drop — kept simple here: we leak one
        // strong ref for the lifetime of the window).
        let toolbar: &TaskbarToolbar = &*(data as *const TaskbarToolbar);

        if Some(&msg) == WM_TBBC.get() {
            let _ = toolbar.add_buttons();
            return DefSubclassProc(hwnd, msg, wparam, lparam);
        }

        if msg == WM_COMMAND {
            // Thumb-bar buttons arrive with HIWORD(wParam) == THBN_CLICKED (0x1800)
            // and LOWORD(wParam) == button id. We accept any HIWORD as long as
            // the LOWORD matches one of our reserved ids.
            let id = (wparam.0 & 0xFFFF) as u32;
            let cmd = match id {
                ID_PREV => Some(TaskbarCommand::Prev),
                ID_PLAYPAUSE => Some(TaskbarCommand::PlayPause),
                ID_NEXT => Some(TaskbarCommand::Next),
                _ => None,
            };
            if let Some(c) = cmd {
                if let Some(slot) = CMD_TX.get() {
                    if let Ok(g) = slot.lock() {
                        if let Some(tx) = g.as_ref() {
                            let _ = tx.send(c);
                        }
                    }
                }
                return LRESULT(0);
            }
        }

        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}

// ── Hand-drawn 24×24 icons ──────────────────────────────────────────────────

#[derive(Copy, Clone)]
enum IconKind {
    Play,
    Pause,
    Prev,
    Next,
}

const ICON_SIZE: usize = 24;

/// Build a 24×24 BGRA HICON for the given symbol on a transparent background.
/// White foreground; works in both light and dark taskbar themes (Windows
/// auto-recolors monochromatic taskbar icons on most builds, but a plain
/// white glyph is the safest fallback).
unsafe fn make_icon(kind: IconKind) -> Result<HICON, String> {
    // BGRA premultiplied — fully transparent unless we paint a pixel.
    let mut pixels = vec![0u8; ICON_SIZE * ICON_SIZE * 4];

    let mut paint = |x: i32, y: i32| {
        if x < 0 || y < 0 || x >= ICON_SIZE as i32 || y >= ICON_SIZE as i32 {
            return;
        }
        let idx = (y as usize * ICON_SIZE + x as usize) * 4;
        pixels[idx] = 255; // B
        pixels[idx + 1] = 255; // G
        pixels[idx + 2] = 255; // R
        pixels[idx + 3] = 255; // A
    };

    match kind {
        IconKind::Play => {
            // Right-pointing triangle.
            for y in 4..20 {
                let span = y.min(23 - y) - 3;
                if span <= 0 {
                    continue;
                }
                let max_x = 8 + span as i32;
                for x in 8..=max_x {
                    paint(x, y as i32);
                }
            }
        }
        IconKind::Pause => {
            for y in 5..19 {
                for x in 7..10 {
                    paint(x as i32, y as i32);
                }
                for x in 14..17 {
                    paint(x as i32, y as i32);
                }
            }
        }
        IconKind::Prev => {
            // Vertical bar at x=6, plus a left-pointing triangle.
            for y in 5..19 {
                for x in 5..7 {
                    paint(x as i32, y as i32);
                }
            }
            for y in 5..19 {
                let half = (y as i32 - 12).abs();
                let span = 7 - half.min(7);
                if span <= 0 {
                    continue;
                }
                for x in (16 - span as i32)..16 {
                    paint(x, y as i32);
                }
            }
        }
        IconKind::Next => {
            // Right-pointing triangle, plus a vertical bar at x=17.
            for y in 5..19 {
                let half = (y as i32 - 12).abs();
                let span = 7 - half.min(7);
                if span <= 0 {
                    continue;
                }
                for x in 8..=(8 + span as i32) {
                    paint(x, y as i32);
                }
            }
            for y in 5..19 {
                for x in 17..19 {
                    paint(x as i32, y as i32);
                }
            }
        }
    }

    // Build a color BITMAP and a stub mask BITMAP. CreateIconIndirect requires
    // both. The mask is ignored when the color bitmap has an alpha channel,
    // but Windows still wants a valid HBITMAP there.
    let hdc = GetDC(HWND(std::ptr::null_mut()));
    let h_color = CreateBitmap(
        ICON_SIZE as i32,
        ICON_SIZE as i32,
        1,
        32,
        Some(pixels.as_ptr() as *const _),
    );
    let h_mask = CreateCompatibleBitmap(hdc, ICON_SIZE as i32, ICON_SIZE as i32);
    ReleaseDC(HWND(std::ptr::null_mut()), hdc);
    if h_color.0.is_null() || h_mask.0.is_null() {
        return Err("CreateBitmap failed".into());
    }

    let info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: h_mask,
        hbmColor: h_color,
    };
    let icon = CreateIconIndirect(&info).map_err(|e| format!("CreateIconIndirect: {e}"))?;
    // The bitmaps were copied into the icon — release our handles.
    let _ = DeleteObject(h_color);
    let _ = DeleteObject(h_mask);
    Ok(icon)
}
