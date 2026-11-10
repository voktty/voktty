//! Native overlay for the Harness notch.
//!
//! The notch exists to watch agents while Voktty is not the foreground app, so
//! it cannot live inside the main webview. This window is transparent, always
//! on top, never takes focus and sits at the top centre of the primary monitor.
//! The frontend owns what it shows; Rust only creates, sizes and hides it.

use tauri::{command, AppHandle};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const NOTCH_LABEL: &str = "notch";

const MIN_WIDTH: f64 = 120.0;
const MAX_WIDTH: f64 = 640.0;
const MIN_HEIGHT: f64 = 4.0;
const MAX_HEIGHT: f64 = 560.0;
const INITIAL_WIDTH: f64 = 420.0;
const INITIAL_HEIGHT: f64 = 56.0;

/// Clamps a size requested by the webview so a bad value cannot cover the screen.
fn clamp_size(width: f64, height: f64) -> (f64, f64) {
    let w = if width.is_finite() {
        width
    } else {
        INITIAL_WIDTH
    };
    let h = if height.is_finite() {
        height
    } else {
        INITIAL_HEIGHT
    };
    (
        w.clamp(MIN_WIDTH, MAX_WIDTH),
        h.clamp(MIN_HEIGHT, MAX_HEIGHT),
    )
}

/// Physical x of a window of `window_width` centred on a monitor.
fn centred_x(monitor_x: i32, monitor_width: u32, window_width: i32) -> i32 {
    monitor_x + (monitor_width as i32 - window_width) / 2
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn place(window: &WebviewWindow, width: f64, height: f64) {
    let (width, height) = clamp_size(width, height);
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let physical_width = (width * monitor.scale_factor()).round() as i32;
        let x = centred_x(monitor.position().x, monitor.size().width, physical_width);
        let _ = window.set_position(tauri::PhysicalPosition::new(x, monitor.position().y));
    }
}

/// Windows 11 draws a rounded border around a transparent top-level window,
/// which reads as a rectangle around the notch. The notch draws its own shape.
#[cfg(target_os = "windows")]
fn strip_system_frame(window: &WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as _;
    for (attribute, value) in [
        (DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND),
        (DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE),
    ] {
        // SAFETY: hwnd belongs to a live window and the value is a u32 attribute.
        let hr = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                &value as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
        if hr != 0 {
            log::debug!("notch window DWM attribute {attribute} failed: {hr:#x}");
        }
    }
}

#[cfg(all(
    not(target_os = "windows"),
    not(any(target_os = "android", target_os = "ios"))
))]
fn strip_system_frame(_window: &WebviewWindow) {}

#[command]
pub async fn notch_window_show(app: AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
            let _ = window.show();
            return Ok(());
        }
        let window =
            WebviewWindowBuilder::new(&app, NOTCH_LABEL, WebviewUrl::App("notch.html".into()))
                .title("Voktty Notch")
                .inner_size(INITIAL_WIDTH, INITIAL_HEIGHT)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible_on_all_workspaces(true)
                .focused(false)
                .focusable(false)
                .visible(false)
                .build()
                .map_err(|e| e.to_string())?;
        strip_system_frame(&window);
        place(&window, INITIAL_WIDTH, INITIAL_HEIGHT);
        let _ = window.show();
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = app;
    Ok(())
}

#[command]
pub async fn notch_window_fit(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        place(&window, width, height);
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = (app, width, height);
    Ok(())
}

#[command]
pub async fn notch_window_hide(app: AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        let _ = window.hide();
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = app;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requested_sizes_are_clamped_to_a_small_overlay() {
        assert_eq!(clamp_size(10_000.0, 10_000.0), (MAX_WIDTH, MAX_HEIGHT));
        assert_eq!(clamp_size(1.0, 1.0), (MIN_WIDTH, MIN_HEIGHT));
    }

    #[test]
    fn non_finite_sizes_fall_back_to_the_initial_size() {
        assert_eq!(
            clamp_size(f64::NAN, f64::INFINITY),
            (INITIAL_WIDTH, INITIAL_HEIGHT)
        );
    }

    #[test]
    fn window_is_centred_on_the_monitor() {
        assert_eq!(centred_x(0, 1920, 420), 750);
        // Secondary monitor to the left of the origin.
        assert_eq!(centred_x(-1920, 1920, 420), -1170);
    }
}
