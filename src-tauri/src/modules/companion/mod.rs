mod pairing;
mod state;
mod transport;

use tauri::Manager;

pub(crate) use state::CompanionState;

#[tauri::command]
pub async fn companion_start(
    app: tauri::AppHandle,
    custom_cloudflared_path: Option<String>,
) -> Result<state::CompanionInvite, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<CompanionState>()
            .start(Some(app_handle), custom_cloudflared_path.as_deref())
    })
    .await
    .map_err(|error| format!("companion startup task failed: {error}"))?
}

#[tauri::command]
pub fn companion_stop(state: tauri::State<'_, CompanionState>) -> bool {
    state.stop()
}

#[tauri::command]
pub fn companion_status(state: tauri::State<'_, CompanionState>) -> state::CompanionStatus {
    state.status()
}

#[tauri::command]
pub fn companion_pending_pairings(
    state: tauri::State<'_, CompanionState>,
) -> Vec<state::PendingPairingInfo> {
    state.pending_pairings()
}

#[tauri::command]
pub fn companion_decide_pairing(
    state: tauri::State<'_, CompanionState>,
    request_id: String,
    approved: bool,
) -> Result<(), String> {
    state.decide_pairing(&request_id, approved)
}

#[tauri::command]
pub fn companion_set_session_state(
    state: tauri::State<'_, CompanionState>,
    session_id: String,
    agent_state: voktty_companion_protocol::AgentState,
) {
    state.set_session_state(session_id, agent_state);
}
