mod auth;
mod crypto;
mod files;
mod guest;
mod quick_tunnel;
pub(crate) mod requirements;
mod server;
mod session;
mod state;

use std::sync::Arc;

use tauri::ipc::{Channel, Response};
use tauri::Manager;

pub(crate) use guest::CollabGuestState;
pub(crate) use state::CollabState;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn collab_host_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    pty: tauri::State<'_, crate::modules::pty::PtyState>,
    workspace: tauri::State<'_, crate::modules::workspace::WorkspaceRegistry>,
    pty_id: u32,
    cols: u16,
    rows: u16,
    file_root: Option<String>,
) -> Result<state::HostedInvite, String> {
    if !pty.has_session(pty_id) {
        return Err("terminal session not found".to_string());
    }
    let citation_files = file_root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .map(|root| {
            let files = files::CitationFiles::new(std::path::Path::new(root))?;
            if !workspace.is_authorized(files.root()) {
                return Err("file citation root is outside the authorized workspace".to_string());
            }
            Ok(Arc::new(files))
        })
        .transpose()?;
    let input_app = app;
    state.start_host_with_files(
        pty_id,
        cols,
        rows,
        Arc::new(move |id, data| {
            input_app
                .state::<crate::modules::pty::PtyState>()
                .write_bytes(id, data)
        }),
        citation_files,
    )
}

#[tauri::command]
pub fn collab_host_stop(state: tauri::State<'_, CollabState>, pty_id: u32) -> bool {
    state.stop_host(pty_id, "host_stopped")
}

#[tauri::command]
pub fn collab_host_snapshot_barrier(
    state: tauri::State<'_, CollabState>,
    pty: tauri::State<'_, crate::modules::pty::PtyState>,
    pty_id: u32,
    token: String,
) -> Result<u64, String> {
    pty.send_collab_snapshot_barrier(pty_id, &token, || state.output_sequence(pty_id))
}

#[tauri::command]
pub fn collab_host_set_snapshot(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
    sequence: u64,
    cols: u16,
    rows: u16,
    snapshot: String,
) -> Result<(), String> {
    state.set_snapshot(pty_id, sequence, cols, rows, snapshot.as_bytes())
}

#[tauri::command]
pub fn collab_host_snapshot_required(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
) -> Result<bool, String> {
    state.snapshot_required(pty_id)
}

#[tauri::command]
pub async fn collab_host_publish(
    app: tauri::AppHandle,
    pty_id: u32,
    custom_path: Option<String>,
) -> Result<state::PublishedTunnel, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<CollabState>()
            .publish_host(pty_id, custom_path.as_deref())
    })
    .await
    .map_err(|error| format!("cloudflared launch failed: {error}"))?
}

#[tauri::command]
pub fn collab_host_unpublish(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
) -> Result<bool, String> {
    state.unpublish_host(pty_id)
}

#[tauri::command]
pub fn collab_host_participants(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
) -> Result<Vec<voktty_collab_protocol::Participant>, String> {
    state.participants(pty_id)
}

#[tauri::command]
pub fn collab_host_grant_control(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
    participant_id: String,
) -> Result<(), String> {
    state.grant_control(pty_id, &participant_id)
}

#[tauri::command]
pub fn collab_host_revoke_control(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
    participant_id: String,
) -> Result<(), String> {
    state.revoke_control(pty_id, &participant_id)
}

#[tauri::command]
pub fn collab_host_remove_participant(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
    participant_id: String,
) -> Result<(), String> {
    state.remove_participant(pty_id, &participant_id)
}

#[tauri::command]
pub fn collab_host_ban_participant(
    state: tauri::State<'_, CollabState>,
    pty_id: u32,
    participant_id: String,
) -> Result<(), String> {
    state.ban_participant(pty_id, &participant_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn collab_guest_connect(
    app: tauri::AppHandle,
    connection_url: String,
    session_id: String,
    invite_code: String,
    participant_name: String,
    on_data: Channel<Response>,
    on_control: Channel<voktty_collab_protocol::ServerControl>,
    on_exit: Channel<i32>,
    on_status: Channel<guest::GuestConnectionStatus>,
) -> Result<guest::GuestWelcome, String> {
    let connection_id = app.state::<CollabGuestState>().reserve_id();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<CollabGuestState>().connect(
            connection_id,
            &connection_url,
            &session_id,
            &invite_code,
            &participant_name,
            guest::GuestCallbacks {
                on_data,
                on_control,
                on_exit,
                on_status,
            },
        )
    })
    .await
    .map_err(|error| format!("collaboration connection task failed: {error}"))?
}

#[tauri::command]
pub fn collab_guest_write(
    state: tauri::State<'_, CollabGuestState>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    let connection_id = request
        .headers()
        .get("x-collab-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "collab_guest_write: missing x-collab-id header".to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("collab_guest_write: expected raw body".to_string());
    };
    state.write(connection_id, bytes)
}

#[tauri::command]
pub fn collab_guest_request_control(
    state: tauri::State<'_, CollabGuestState>,
    connection_id: u64,
) -> Result<(), String> {
    state.request_control(connection_id)
}

#[tauri::command]
pub fn collab_guest_release_control(
    state: tauri::State<'_, CollabGuestState>,
    connection_id: u64,
) -> Result<(), String> {
    state.release_control(connection_id)
}

#[tauri::command]
pub fn collab_guest_file_search(
    state: tauri::State<'_, CollabGuestState>,
    connection_id: u64,
    request_id: String,
    query: String,
    limit: u16,
) -> Result<(), String> {
    state.file_search(connection_id, request_id, query, limit)
}

#[tauri::command]
pub fn collab_guest_file_read(
    state: tauri::State<'_, CollabGuestState>,
    connection_id: u64,
    request_id: String,
    path: String,
) -> Result<(), String> {
    state.file_read(connection_id, request_id, path)
}

#[tauri::command]
pub fn collab_guest_close(
    state: tauri::State<'_, CollabGuestState>,
    connection_id: u64,
) -> Result<bool, String> {
    state.close(connection_id)
}
