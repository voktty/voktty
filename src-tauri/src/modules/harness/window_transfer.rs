use std::sync::Mutex;

use tauri::State;

pub struct WindowTransferState(Mutex<Option<String>>);

impl WindowTransferState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

#[tauri::command]
pub fn stage_window_transfer(
    state: State<'_, WindowTransferState>,
    payload: String,
) -> Result<(), String> {
    if payload.trim().is_empty() {
        return Err("empty window transfer payload".into());
    }
    *state.0.lock().map_err(|err| err.to_string())? = Some(payload);
    Ok(())
}

#[tauri::command]
pub fn take_window_transfer(
    state: State<'_, WindowTransferState>,
) -> Result<Option<String>, String> {
    Ok(state.0.lock().map_err(|err| err.to_string())?.take())
}
