mod pairing;
mod state;

pub(crate) use state::CompanionState;

#[tauri::command]
pub async fn companion_start(
    app: tauri::AppHandle,
    custom_cloudflared_path: Option<String>,
) -> Result<state::CompanionInvite, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<CompanionState>()
            .start(custom_cloudflared_path.as_deref())
    })
    .await
    .map_err(|error| format!("companion startup task failed: {error}"))?
}

#[tauri::command]
pub fn companion_stop(state: tauri::State<'_, CompanionState>) -> bool {
    state.stop()
}

#[tauri::command]
pub fn companion_status(
    state: tauri::State<'_, CompanionState>,
) -> state::CompanionStatus {
    state.status()
}
