//! The SFTP surface exposed to the webview.
//!
//! A handle is opened once against a session and reused; every path is
//! resolved against that handle's authorized root inside Rust, so the webview
//! cannot widen its own reach by sending a different root later.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use super::super::registry::Registry;
use super::super::run_detached;
use super::super::state::SshNativeState;
use super::super::types::SshNativeError;
use super::session::{NativeSftp, RemoteEntry, RemoteStat, MAX_BINARY_BYTES};

/// One panel or editor per handle; a workspace needs a handful, not hundreds.
const MAX_HANDLES: usize = 64;

pub type SftpState = Registry<Arc<NativeSftp>>;

pub fn new_state() -> SftpState {
    Registry::new("sftp", MAX_HANDLES)
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpHandleInfo {
    pub handle: String,
    pub root: String,
}

#[tauri::command]
pub async fn ssh_native_sftp_open(
    sessions: State<'_, SshNativeState>,
    handles: State<'_, SftpState>,
    session_id: String,
    root: Option<String>,
) -> Result<SftpHandleInfo, SshNativeError> {
    let lease = sessions.acquire(&session_id)?;
    let root = root.unwrap_or_else(|| "/".to_string());
    let sftp = run_detached(async move { NativeSftp::open(lease, root).await }).await?;

    let root = sftp.root().to_string();
    let handle = handles.insert(Arc::new(sftp))?;
    log::info!("native SFTP handle {handle} opened on {session_id} at {root}");
    Ok(SftpHandleInfo { handle, root })
}

/// Dropping the handle releases the session lease it held, so the session stops
/// counting this consumer.
#[tauri::command]
pub fn ssh_native_sftp_close(
    handles: State<'_, SftpState>,
    handle: String,
) -> Result<(), SshNativeError> {
    handles.remove(&handle)?;
    log::info!("native SFTP handle {handle} closed");
    Ok(())
}

#[tauri::command]
pub async fn ssh_native_sftp_read_dir(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<Vec<RemoteEntry>, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.list_dir(path).await }).await
}

#[tauri::command]
pub async fn ssh_native_sftp_stat(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<RemoteStat, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.stat(path).await }).await
}

#[tauri::command]
pub async fn ssh_native_sftp_canonicalize(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<String, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.canonicalize(path).await }).await
}

#[tauri::command]
pub async fn ssh_native_sftp_read_text(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<String, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.read_text(path).await }).await
}

/// Base64 so binary content never passes through the UTF-8 document reader,
/// which is what used to fail on remote media.
#[tauri::command]
pub async fn ssh_native_sftp_read_binary(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<String, SshNativeError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let sftp = handles.get(&handle)?;
    let bytes = run_detached(async move { sftp.read_bytes(path, MAX_BINARY_BYTES).await }).await?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn ssh_native_sftp_write_text(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
    content: String,
) -> Result<String, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.write_bytes(path, content.into_bytes()).await }).await
}

#[tauri::command]
pub async fn ssh_native_sftp_create_dir(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<String, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.create_dir(path).await }).await
}

#[tauri::command]
pub async fn ssh_native_sftp_create_file(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<String, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.create_file(path).await }).await
}

#[tauri::command]
pub async fn ssh_native_sftp_rename(
    handles: State<'_, SftpState>,
    handle: String,
    from: String,
    to: String,
) -> Result<String, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.rename(from, to).await }).await
}

/// Returns how many entries were removed, so a caller deleting a tree can say
/// what it actually did.
#[tauri::command]
pub async fn ssh_native_sftp_delete(
    handles: State<'_, SftpState>,
    handle: String,
    path: String,
) -> Result<u64, SshNativeError> {
    let sftp = handles.get(&handle)?;
    run_detached(async move { sftp.remove(path).await }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::ssh_native::types::SshErrorCode;

    #[test]
    fn the_handle_registry_is_bounded_and_prefixed() {
        let handles: Registry<String> = Registry::new("sftp", 2);
        let first = handles.insert("a".into()).expect("first");
        assert!(first.starts_with("sftp-"));
        handles.insert("b".into()).expect("second");

        let error = handles.insert("c".into()).expect_err("over the limit");
        assert_eq!(error.code, SshErrorCode::Config);
    }

    #[test]
    fn an_unknown_handle_is_refused() {
        let handles = new_state();
        let error = handles.get("sftp-404").expect_err("unknown handle");
        assert_eq!(error.code, SshErrorCode::Config);
        assert!(error.message.contains("unknown sftp entry"));
    }
}
