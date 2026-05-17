//! Windows System Media Transport Controls integration.
//!
//! Surfaces "Now Playing" metadata + transport buttons to the lock screen,
//! Win11 volume flyout, Game Bar, and headset/keyboard media keys.
//!
//! windows-rs 0.58 doesn't ship `ISystemMediaTransportControlsInterop` (the
//! COM bridge that lets a Win32 HWND get a SMTC instance), and its
//! `#[interface]` attribute macro pulls in extra crate/trait dependencies
//! that aren't worth the complexity here. We hand-roll the QueryInterface +
//! virtual-method-table call instead. GUID is from the Windows SDK header
//! `systemmediatransportcontrolsinterop.h`.

#![cfg(target_os = "windows")]

use std::ffi::c_void;
use std::sync::mpsc::Sender;
use std::sync::Mutex;

use windows::core::{IInspectable, Interface, GUID, HRESULT, HSTRING};
use windows::Foundation::TimeSpan;
use windows::Foundation::TypedEventHandler;
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsDisplayUpdater, SystemMediaTransportControlsTimelineProperties,
};
use windows::Win32::Foundation::HWND;

const ISMTC_INTEROP_IID: GUID = GUID::from_u128(0xddb0472d_c911_4a1f_86d9_dc3d71a95f5a);

/// IUnknown::QueryInterface signature.
type FnQueryInterface =
    unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT;
/// IUnknown::Release signature.
type FnRelease = unsafe extern "system" fn(*mut c_void) -> u32;

/// First slot after IUnknown(3) + IInspectable(3) = 6.
type FnGetForWindow =
    unsafe extern "system" fn(*mut c_void, HWND, *const GUID, *mut *mut c_void) -> HRESULT;

#[derive(Debug, Clone, Copy)]
pub enum SmtcCommand {
    Play,
    Pause,
    Next,
    Prev,
}

pub struct SmtcController {
    controls: SystemMediaTransportControls,
    updater: SystemMediaTransportControlsDisplayUpdater,
    timeline: SystemMediaTransportControlsTimelineProperties,
    last_status: Mutex<Option<bool>>,
}

unsafe impl Send for SmtcController {}
unsafe impl Sync for SmtcController {}

impl SmtcController {
    pub fn new(hwnd_raw: isize, tx: Sender<SmtcCommand>) -> Result<Self, String> {
        // 1. Get the SMTC activation factory as IInspectable.
        let factory: IInspectable =
            windows::core::factory::<SystemMediaTransportControls, IInspectable>()
                .map_err(|e| format!("smtc factory: {e}"))?;

        // 2. QI for ISystemMediaTransportControlsInterop. Returns a raw vtable
        //    pointer; we walk slot 6 (IUnknown 0..2, IInspectable 3..5,
        //    GetForWindow at 6).
        let factory_raw: *mut c_void = factory.as_raw();
        let mut interop_raw: *mut c_void = std::ptr::null_mut();
        unsafe {
            let qi: FnQueryInterface = read_vtable_slot(factory_raw, 0);
            let hr = qi(factory_raw, &ISMTC_INTEROP_IID, &mut interop_raw);
            hr.ok().map_err(|e| format!("QI(interop): {e}"))?;
        }

        // 3. Call GetForWindow on the interop pointer.
        let hwnd = HWND(hwnd_raw as *mut _);
        let mut smtc_raw: *mut c_void = std::ptr::null_mut();
        let qi_result = unsafe {
            let get_for_window: FnGetForWindow = read_vtable_slot(interop_raw, 6);
            let hr = get_for_window(
                interop_raw,
                hwnd,
                &SystemMediaTransportControls::IID,
                &mut smtc_raw,
            );
            // Release the interop pointer regardless of result.
            let release: FnRelease = read_vtable_slot(interop_raw, 2);
            release(interop_raw);
            hr.ok()
        };
        qi_result.map_err(|e| format!("GetForWindow: {e}"))?;

        let controls: SystemMediaTransportControls =
            unsafe { SystemMediaTransportControls::from_raw(smtc_raw) };

        let _ = controls.SetIsPlayEnabled(true);
        let _ = controls.SetIsPauseEnabled(true);
        let _ = controls.SetIsNextEnabled(true);
        let _ = controls.SetIsPreviousEnabled(true);

        let updater = controls
            .DisplayUpdater()
            .map_err(|e| format!("DisplayUpdater: {e}"))?;
        let _ = updater.SetType(MediaPlaybackType::Video);

        let timeline = SystemMediaTransportControlsTimelineProperties::new()
            .map_err(|e| format!("Timeline::new: {e}"))?;

        let tx_cb = tx.clone();
        let handler = TypedEventHandler::<
            SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_sender, args| {
            if let Some(args) = args.as_ref() {
                if let Ok(btn) = args.Button() {
                    let cmd = match btn {
                        SystemMediaTransportControlsButton::Play => Some(SmtcCommand::Play),
                        SystemMediaTransportControlsButton::Pause => Some(SmtcCommand::Pause),
                        SystemMediaTransportControlsButton::Next => Some(SmtcCommand::Next),
                        SystemMediaTransportControlsButton::Previous => Some(SmtcCommand::Prev),
                        _ => None,
                    };
                    if let Some(c) = cmd {
                        let _ = tx_cb.send(c);
                    }
                }
            }
            Ok(())
        });
        controls
            .ButtonPressed(&handler)
            .map_err(|e| format!("ButtonPressed: {e}"))?;

        Ok(Self {
            controls,
            updater,
            timeline,
            last_status: Mutex::new(None),
        })
    }

    pub fn set_metadata(&self, title: &str, artist: Option<&str>) {
        if let Ok(props) = self.updater.MusicProperties() {
            let _ = props.SetTitle(&HSTRING::from(title));
            if let Some(a) = artist {
                let _ = props.SetArtist(&HSTRING::from(a));
            }
        }
        let _ = self.updater.Update();
    }

    pub fn set_playing(&self, playing: bool) {
        if let Ok(mut g) = self.last_status.lock() {
            if *g == Some(playing) {
                return;
            }
            *g = Some(playing);
        }
        let status = if playing {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        };
        let _ = self.controls.SetPlaybackStatus(status);
    }

    pub fn set_timeline(&self, position_s: f64, duration_s: f64) {
        if duration_s <= 0.0 {
            return;
        }
        let ticks = |s: f64| TimeSpan {
            Duration: (s * 1e7) as i64,
        };
        let _ = self.timeline.SetStartTime(ticks(0.0));
        let _ = self.timeline.SetEndTime(ticks(duration_s));
        let _ = self.timeline.SetPosition(ticks(position_s));
        let _ = self.timeline.SetMinSeekTime(ticks(0.0));
        let _ = self.timeline.SetMaxSeekTime(ticks(duration_s));
        let _ = self.controls.UpdateTimelineProperties(&self.timeline);
    }

    #[allow(dead_code)]
    pub fn clear(&self) {
        let _ = self.updater.ClearAll();
        let _ = self.updater.Update();
        let _ = self.controls.SetPlaybackStatus(MediaPlaybackStatus::Closed);
    }
}

/// Read a function pointer from a COM object's vtable. The first machine-word
/// at `obj` is a pointer to an array of fn pointers; the Nth slot is the Nth
/// method. Caller must specify a `T` matching that method's signature.
unsafe fn read_vtable_slot<T: Copy>(obj: *mut c_void, slot: usize) -> T {
    let vtbl = *(obj as *mut *mut *const c_void);
    let raw = *vtbl.add(slot);
    std::mem::transmute_copy::<*const c_void, T>(&raw)
}
