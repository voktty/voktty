//! Native SSH transport.
//!
//! Consumers are SFTP, port forwarding, host metrics and remote processes. The
//! interactive PTY keeps using the system `ssh` client; see ADR-010.

pub mod agent;
pub mod auth;
pub mod cells;
pub mod connection;
pub mod host_trust;
pub mod known_hosts;
pub mod sftp;
pub mod state;
pub mod types;

use std::sync::Arc;

use tauri::State;

use state::{SshNativeState, SshSessionInfo};
use types::{HostKeyApproval, SshCredential, SshNativeError, SshNativeTarget};

/// Open a native session and register it.
///
/// A host key the user has not seen fails with `host_key_unknown` or
/// `host_key_changed` and the key itself, so the caller can show it and retry
/// with an explicit approval. Nothing is trusted on the user's behalf.
#[tauri::command]
pub async fn ssh_native_connect(
    state: State<'_, SshNativeState>,
    target: SshNativeTarget,
    credentials: Vec<SshCredential>,
    approval: Option<HostKeyApproval>,
) -> Result<SshSessionInfo, SshNativeError> {
    // Driven on its own task: the russh handshake future carries higher-ranked
    // `Send` bounds that a Tauri command future cannot satisfy directly.
    let attempt = target.clone();
    let approval = approval.unwrap_or(HostKeyApproval::None);
    let (chain, remember_line) =
        tokio::spawn(async move { connection::connect(attempt, credentials, approval).await })
            .await
            .map_err(|error| {
                SshNativeError::new(
                    types::SshErrorCode::Protocol,
                    format!("connection task failed: {error}"),
                )
            })??;

    // Only after the session is up, and only for a key the user accepted.
    if let Some(line) = remember_line {
        if let Err(error) = connection::remember_host_key(&line) {
            log::warn!("could not record accepted host key: {error}");
        }
    }

    let user = target
        .destination
        .user
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let hops = chain.depth();
    let info = state.insert(&target, &user, hops, Arc::new(chain))?;
    log::info!(
        "native SSH session {} opened to {}:{} over {hops} hop(s)",
        info.id,
        info.host,
        info.port
    );
    Ok(info)
}

#[tauri::command]
pub fn ssh_native_disconnect(
    state: State<'_, SshNativeState>,
    session_id: String,
) -> Result<(), SshNativeError> {
    state.close(&session_id)?;
    log::info!("native SSH session {session_id} closed");
    Ok(())
}

#[tauri::command]
pub fn ssh_native_sessions(state: State<'_, SshNativeState>) -> Vec<SshSessionInfo> {
    state.list()
}
