pub mod manager;
pub mod types;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use manager::TunnelManager;
use types::{SshTunnelConfig, TunnelStatusEvent};

pub struct TunnelState(pub Arc<TunnelManager>);

impl Default for TunnelState {
    fn default() -> Self {
        Self(Arc::new(TunnelManager::new()))
    }
}

#[tauri::command]
pub async fn ssh_tunnel_start(
    app: AppHandle,
    state: State<'_, TunnelState>,
    config: SshTunnelConfig,
) -> Result<TunnelStatusEvent, String> {
    state.0.start_tunnel(app, config)
}

#[tauri::command]
pub async fn ssh_tunnel_stop(
    app: AppHandle,
    state: State<'_, TunnelState>,
    id: String,
) -> Result<(), String> {
    state.0.stop_tunnel(&id)?;
    let _ = app.emit(
        "ssh-tunnel://status-changed",
        types::TunnelStatusEvent {
            id,
            status: types::TunnelStatus::Stopped,
            error: None,
            started_at: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn ssh_tunnel_list(
    state: State<'_, TunnelState>,
) -> Result<Vec<TunnelStatusEvent>, String> {
    state.0.list_active_tunnels()
}

#[tauri::command]
pub async fn ssh_tunnel_stop_all(
    app: AppHandle,
    state: State<'_, TunnelState>,
) -> Result<(), String> {
    state.0.stop_all_tunnels()?;
    let _ = app.emit("ssh-tunnel://all-stopped", ());
    Ok(())
}
