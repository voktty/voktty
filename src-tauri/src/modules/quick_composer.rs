use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager, State};

pub const QUICK_COMPOSER_LABEL: &str = "quick-composer";
pub const QUICK_COMPOSER_GIT_LABEL: &str = "quick-composer-git";

const LAUNCH_EVENT: &str = "quick_composer_launch";
const GIT_REQUEST_EVENT: &str = "quick_git_request";
const GIT_RESULT_EVENT: &str = "quick_git_result";

#[derive(Default)]
pub struct QuickComposerState {
    pub enabled: Mutex<bool>,
    pub shortcut: Mutex<Option<String>>,
    pub launch_queue: Mutex<VecDeque<QueuedLaunch>>,
    pub git_state: Mutex<Option<serde_json::Value>>,
    pub active_captures: Mutex<HashMap<String, String>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct QueuedLaunch {
    pub id: String,
    pub request: serde_json::Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCompletePayload {
    pub id: String,
    pub choice: Option<serde_json::Value>,
    pub restore_focus: bool,
}

#[command]
pub async fn quick_composer_set_enabled(
    state: State<'_, QuickComposerState>,
    enabled: bool,
    shortcut: Option<String>,
) -> Result<(), String> {
    let mut e = state.enabled.lock().map_err(|e| e.to_string())?;
    *e = enabled;
    let mut s = state.shortcut.lock().map_err(|e| e.to_string())?;
    *s = shortcut;
    Ok(())
}

#[command]
pub async fn quick_composer_prepare() -> Result<bool, String> {
    Ok(true)
}

#[command]
pub async fn quick_composer_fit(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(QUICK_COMPOSER_LABEL) {
        if let Ok(size) = window.outer_size() {
            let _ = window.set_size(tauri::PhysicalSize::new(size.width, height.round() as u32));
        }
    }
    Ok(())
}

#[command]
pub async fn quick_composer_submit(
    app: AppHandle,
    state: State<'_, QuickComposerState>,
    launch: serde_json::Value,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let queued = QueuedLaunch {
        id: id.clone(),
        request: launch,
    };
    {
        let mut queue = state.launch_queue.lock().map_err(|e| e.to_string())?;
        queue.push_back(queued);
    }
    let _ = app.emit(LAUNCH_EVENT, id);
    Ok(())
}

#[command]
pub async fn quick_composer_take(
    state: State<'_, QuickComposerState>,
) -> Result<Option<QueuedLaunch>, String> {
    let mut queue = state.launch_queue.lock().map_err(|e| e.to_string())?;
    Ok(queue.pop_front())
}

#[command]
pub async fn quick_composer_ack(
    _state: State<'_, QuickComposerState>,
    _id: String,
) -> Result<(), String> {
    Ok(())
}

#[command]
pub async fn quick_composer_release_capture(
    state: State<'_, QuickComposerState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let mut captures = state.active_captures.lock().map_err(|e| e.to_string())?;
    for path in paths {
        captures.remove(&path);
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[command]
pub async fn quick_composer_capture(
    _state: State<'_, QuickComposerState>,
) -> Result<Option<String>, String> {
    Ok(None)
}

#[command]
pub async fn quick_git_open(
    app: AppHandle,
    state: State<'_, QuickComposerState>,
    request: serde_json::Value,
) -> Result<(), String> {
    {
        let mut git_state = state.git_state.lock().map_err(|e| e.to_string())?;
        *git_state = Some(request.clone());
    }
    let _ = app.emit(GIT_REQUEST_EVENT, request);
    Ok(())
}

#[command]
pub async fn quick_git_state(
    state: State<'_, QuickComposerState>,
) -> Result<Option<serde_json::Value>, String> {
    let git_state = state.git_state.lock().map_err(|e| e.to_string())?;
    Ok(git_state.clone())
}

#[command]
pub async fn quick_git_fit(app: AppHandle, _id: String, height: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(QUICK_COMPOSER_GIT_LABEL) {
        if let Ok(size) = window.outer_size() {
            let _ = window.set_size(tauri::PhysicalSize::new(size.width, height.round() as u32));
        }
    }
    Ok(())
}

#[command]
pub async fn quick_git_complete(
    app: AppHandle,
    state: State<'_, QuickComposerState>,
    id: String,
    choice: Option<serde_json::Value>,
    restore_focus: bool,
) -> Result<(), String> {
    {
        let mut git_state = state.git_state.lock().map_err(|e| e.to_string())?;
        *git_state = None;
    }
    let payload = GitCompletePayload {
        id,
        choice,
        restore_focus,
    };
    let _ = app.emit(GIT_RESULT_EVENT, payload);
    Ok(())
}

#[command]
pub async fn quick_composer_dismiss(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(QUICK_COMPOSER_LABEL) {
        let _ = window.hide();
    }
    Ok(())
}
