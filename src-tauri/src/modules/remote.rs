use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use voktty_remote_protocol::{
    read_frame, write_frame, Frame, RemoteRequest, RemoteResponse, METHOD_GIT_EXEC,
    METHOD_HANDSHAKE, METHOD_PTY_CLOSE, METHOD_PTY_GET_CWD, METHOD_PTY_OPEN, METHOD_PTY_RESIZE,
    METHOD_READ_FILE, METHOD_WATCH_ADD, METHOD_WATCH_REMOVE, PROTOCOL_VERSION,
    REMOTE_SHELL_INTEGRATION_VERSION,
};

const REMOTE_OS: &str = "linux";
const REMOTE_VERSION: &str = env!("CARGO_PKG_VERSION");

const REMOTE_BASHRC: &str = include_str!("pty/scripts/bashrc.bash");
const REMOTE_ZSHENV: &str = include_str!("pty/scripts/zshenv.zsh");
const REMOTE_ZPROFILE: &str = include_str!("pty/scripts/zprofile.zsh");
const REMOTE_ZLOGIN: &str = include_str!("pty/scripts/zlogin.zsh");
const REMOTE_ZSHRC: &str = include_str!("pty/scripts/zshrc.zsh");
const REMOTE_FISH_INIT: &str = include_str!("pty/scripts/init.fish");
const BUNDLED_LINUX_X86_64_HELPER: &[u8] =
    include_bytes!("../../resources/remote/linux-x86_64/voktty-remote");

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RemoteSshConnection {
    pub host: String,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(rename = "identityFile", default)]
    pub identity_file: Option<String>,
    #[serde(rename = "extraArgs", default)]
    pub extra_args: Option<String>,
    #[serde(rename = "initialDirectory", default)]
    pub initial_directory: Option<String>,
    #[serde(rename = "multiplexerMode", default)]
    pub multiplexer_mode: Option<String>,
    #[serde(rename = "tmuxSessionName", default)]
    pub tmux_session_name: Option<String>,
    #[serde(rename = "activeMultiplexerSession", default)]
    pub active_multiplexer_session: Option<String>,
    #[serde(rename = "multiplexerAction", default)]
    pub multiplexer_action: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteSessionInfo {
    pub session_id: u64,
    pub architecture: String,
    pub workspace_root: String,
    pub helper_version: String,
    pub capabilities: Vec<String>,
}

static GLOBAL_REMOTE: OnceLock<RemoteState> = OnceLock::new();

#[derive(Clone)]
pub struct RemoteState {
    sessions: Arc<Mutex<HashMap<u64, Arc<RemoteSession>>>>,
    next_id: Arc<AtomicU64>,
    next_pty_id: Arc<AtomicU64>,
    next_request_id: Arc<AtomicU64>,
}

impl Default for RemoteState {
    fn default() -> Self {
        let state = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
            next_pty_id: Arc::new(AtomicU64::new(1)),
            next_request_id: Arc::new(AtomicU64::new(1)),
        };
        let _ = GLOBAL_REMOTE.set(state.clone());
        state
    }
}

impl RemoteState {
    pub fn global() -> Option<RemoteState> {
        GLOBAL_REMOTE.get().cloned()
    }

    pub(crate) fn exec_git(
        &self,
        session_id: u64,
        cwd: Option<&str>,
        args: &[std::ffi::OsString],
        timeout_secs: u64,
    ) -> Result<crate::modules::git::types::GitOutput, String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "remote session state is poisoned".to_string())?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("remote session {session_id} not found"))?;

        let string_args: Vec<String> = args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();

        let req_id = format!(
            "git-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let request = RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: req_id,
            method: METHOD_GIT_EXEC.to_string(),
            params: serde_json::json!({
                "cwd": cwd,
                "args": string_args,
                "timeoutSecs": timeout_secs,
            }),
        };

        let response = session.request(&request)?;
        if !response.ok {
            let err_msg = response
                .error
                .map(|e| e.message)
                .unwrap_or_else(|| "remote git execution failed".to_string());
            return Err(err_msg);
        }

        let result = response
            .result
            .ok_or_else(|| "missing result payload from remote git execution".to_string())?;

        let stdout_b64 = result
            .get("stdout")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let stdout = base64::engine::general_purpose::STANDARD
            .decode(stdout_b64)
            .map_err(|e| format!("failed to decode remote git stdout base64: {e}"))?;

        let stderr = result
            .get("stderr")
            .and_then(|v| v.as_str())
            .map(|s| s.as_bytes().to_vec())
            .unwrap_or_default();

        let exit_code = result
            .get("exitCode")
            .and_then(|v| v.as_i64())
            .map(|code| code as i32);

        let timed_out = result
            .get("timedOut")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        Ok(crate::modules::git::types::GitOutput {
            stdout,
            stderr,
            exit_code,
            timed_out,
            truncated: false,
        })
    }

    pub(crate) fn read_file_text(
        &self,
        session_id: u64,
        path: &str,
    ) -> Result<crate::modules::git::types::TextSource, String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "remote session state is poisoned".to_string())?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("remote session {session_id} not found"))?;

        let req_id = format!(
            "read-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let request = RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: req_id,
            method: METHOD_READ_FILE.to_string(),
            params: serde_json::json!({
                "path": path,
            }),
        };

        let response = session.request(&request)?;
        if !response.ok {
            if let Some(err) = &response.error {
                if err.code == "binary_file" {
                    return Ok(crate::modules::git::types::TextSource::Binary);
                }
            }
            return Ok(crate::modules::git::types::TextSource::Missing);
        }

        let content = response
            .result
            .as_ref()
            .and_then(|r| r.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string());

        match content {
            Some(text) => Ok(crate::modules::git::types::TextSource::Text(text)),
            None => Ok(crate::modules::git::types::TextSource::Missing),
        }
    }
}

struct RemoteSession {
    child: Mutex<Child>,
    stdin: Mutex<BufWriter<ChildStdin>>,
    routing: Arc<RemoteRouting>,
    connection: RemoteSshConnection,
}

#[derive(Clone)]
struct RemotePtyHandlers {
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
}

struct RemoteRouting {
    pending: Mutex<HashMap<String, mpsc::Sender<Result<RemoteResponse, String>>>>,
    ptys: Mutex<HashMap<u64, RemotePtyHandlers>>,
    app: AppHandle,
    session_id: AtomicU64,
}

#[derive(Clone, Serialize)]
struct RemoteChangedPayload {
    paths: Vec<String>,
    #[serde(rename = "sessionId")]
    session_id: u64,
}

impl Drop for RemoteSession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        self.routing.fail_all("remote SSH session closed");
    }
}

impl RemoteSession {
    fn set_id(&self, session_id: u64) {
        self.routing.session_id.store(session_id, Ordering::Release);
    }

    fn request(&self, request: &RemoteRequest) -> Result<RemoteResponse, String> {
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self
                .routing
                .pending
                .lock()
                .map_err(|_| "remote request state is poisoned".to_string())?;
            if pending.insert(request.id.clone(), sender).is_some() {
                return Err("duplicate remote request id".to_string());
            }
        }
        if let Err(error) = self.send(&Frame::Request(request.clone())) {
            if let Ok(mut pending) = self.routing.pending.lock() {
                pending.remove(&request.id);
            }
            return Err(error);
        }
        receiver
            .recv()
            .map_err(|_| "remote helper closed before replying".to_string())?
    }

    fn send(&self, frame: &Frame) -> Result<(), String> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| "remote helper input is poisoned".to_string())?;
        write_frame(&mut *stdin, frame).map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())
    }

    fn register_pty(
        &self,
        pty_id: u64,
        on_data: Channel<Response>,
        on_exit: Channel<i32>,
    ) -> Result<(), String> {
        let mut ptys = self
            .routing
            .ptys
            .lock()
            .map_err(|_| "remote PTY state is poisoned".to_string())?;
        if ptys
            .insert(pty_id, RemotePtyHandlers { on_data, on_exit })
            .is_some()
        {
            return Err("duplicate remote PTY id".to_string());
        }
        Ok(())
    }

    fn unregister_pty(&self, pty_id: u64) {
        if let Ok(mut ptys) = self.routing.ptys.lock() {
            ptys.remove(&pty_id);
        }
    }
}

impl RemoteRouting {
    fn new(app: AppHandle) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            ptys: Mutex::new(HashMap::new()),
            app,
            session_id: AtomicU64::new(0),
        }
    }

    fn route(&self, frame: Frame) -> Result<(), String> {
        match frame {
            Frame::Response(response) => {
                let sender = self
                    .pending
                    .lock()
                    .map_err(|_| "remote request state is poisoned".to_string())?
                    .remove(&response.id);
                if let Some(sender) = sender {
                    let _ = sender.send(Ok(response));
                }
                Ok(())
            }
            Frame::PtyOutput { pty_id, data } => {
                let handlers = self
                    .ptys
                    .lock()
                    .map_err(|_| "remote PTY state is poisoned".to_string())?
                    .get(&pty_id)
                    .cloned();
                if let Some(handlers) = handlers {
                    if handlers.on_data.send(Response::new(data)).is_err() {
                        if let Ok(mut ptys) = self.ptys.lock() {
                            ptys.remove(&pty_id);
                        }
                    }
                }
                Ok(())
            }
            Frame::PtyExit { pty_id, code } => {
                let handlers = self
                    .ptys
                    .lock()
                    .map_err(|_| "remote PTY state is poisoned".to_string())?
                    .remove(&pty_id);
                if let Some(handlers) = handlers {
                    let _ = handlers.on_exit.send(code);
                }
                Ok(())
            }
            Frame::FsChanged(changed) => {
                let session_id = self.session_id.load(Ordering::Acquire);
                if session_id != 0 {
                    let _ = self.app.emit(
                        "fs:changed",
                        RemoteChangedPayload {
                            paths: changed.paths,
                            session_id,
                        },
                    );
                }
                Ok(())
            }
            Frame::Request(_) | Frame::PtyInput { .. } => {
                Err("remote helper sent a client-only frame".to_string())
            }
        }
    }

    fn fail_all(&self, message: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(message.to_string()));
            }
        }
        if let Ok(mut ptys) = self.ptys.lock() {
            for (_, handlers) in ptys.drain() {
                let _ = handlers.on_exit.send(-1);
            }
        }
    }
}

#[tauri::command]
pub async fn remote_open(
    app: AppHandle,
    state: State<'_, RemoteState>,
    connection: RemoteSshConnection,
    workspace_root: Option<String>,
) -> Result<RemoteSessionInfo, String> {
    validate_connection(&connection)?;
    let (session, mut info) = tauri::async_runtime::spawn_blocking(move || {
        open_remote_session(app, connection, workspace_root)
    })
    .await
    .map_err(|error| format!("remote bootstrap task failed: {error}"))??;
    let session_id = state.next_id.fetch_add(1, Ordering::Relaxed);
    info.session_id = session_id;
    session.set_id(session_id);
    state
        .sessions
        .lock()
        .map_err(|_| "remote session state is poisoned".to_string())?
        .insert(session_id, Arc::new(session));
    Ok(info)
}

#[tauri::command]
pub async fn remote_request(
    state: State<'_, RemoteState>,
    session_id: u64,
    request: RemoteRequest,
) -> Result<RemoteResponse, String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "remote session state is poisoned".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "remote session not found".to_string())?;
    tauri::async_runtime::spawn_blocking(move || session.request(&request))
        .await
        .map_err(|error| format!("remote request task failed: {error}"))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn remote_pty_open(
    state: State<'_, RemoteState>,
    session_id: u64,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    blocks: Option<bool>,
    multiplexer_mode: Option<String>,
    tmux_session_name: Option<String>,
    multiplexer_action: Option<String>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u64, String> {
    let session = remote_session(&state, session_id)?;
    let pty_id = state.next_pty_id.fetch_add(1, Ordering::Relaxed);
    session.register_pty(pty_id, on_data, on_exit)?;

    let mode = multiplexer_mode.or_else(|| session.connection.multiplexer_mode.clone());
    let session_name = tmux_session_name
        .or_else(|| session.connection.active_multiplexer_session.clone())
        .or_else(|| session.connection.tmux_session_name.clone());
    let action = multiplexer_action.or_else(|| session.connection.multiplexer_action.clone());

    let request = RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: state.next_request_id("pty-open"),
        method: METHOD_PTY_OPEN.to_string(),
        params: serde_json::json!({
            "ptyId": pty_id,
            "cols": cols,
            "rows": rows,
            "cwd": cwd,
            "blocks": blocks.unwrap_or(false),
            "multiplexerMode": mode,
            "tmuxSessionName": session_name,
            "multiplexerAction": action,
        }),
    };
    let request_session = session.clone();
    let response = tauri::async_runtime::spawn_blocking(move || request_session.request(&request))
        .await
        .map_err(|error| format!("remote PTY open task failed: {error}"))?;
    match response.and_then(response_result) {
        Ok(_) => Ok(pty_id),
        Err(error) => {
            session.unregister_pty(pty_id);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn remote_pty_write(
    state: State<'_, RemoteState>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    let session_id = request_header_u64(&request, "x-remote-session-id")?;
    let pty_id = request_header_u64(&request, "x-pty-id")?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("remote_pty_write: expected raw body".to_string());
    };
    remote_session(&state, session_id)?.send(&Frame::PtyInput {
        pty_id,
        data: data.clone(),
    })
}

#[tauri::command]
pub async fn remote_pty_resize(
    state: State<'_, RemoteState>,
    session_id: u64,
    pty_id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let request = RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: state.next_request_id("pty-resize"),
        method: METHOD_PTY_RESIZE.to_string(),
        params: serde_json::json!({ "ptyId": pty_id, "cols": cols, "rows": rows }),
    };
    response_result(
        remote_request_for_session(remote_session(&state, session_id)?, request).await?,
    )?;
    Ok(())
}

#[tauri::command]
pub async fn remote_pty_close(
    state: State<'_, RemoteState>,
    session_id: u64,
    pty_id: u64,
) -> Result<(), String> {
    let session = remote_session(&state, session_id)?;
    let request = RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: state.next_request_id("pty-close"),
        method: METHOD_PTY_CLOSE.to_string(),
        params: serde_json::json!({ "ptyId": pty_id }),
    };
    let result = remote_request_for_session(session.clone(), request)
        .await
        .and_then(response_result)
        .map(|_| ());
    session.unregister_pty(pty_id);
    result
}

#[tauri::command]
pub async fn remote_pty_get_cwd(
    state: State<'_, RemoteState>,
    session_id: u64,
    pty_id: u64,
) -> Result<String, String> {
    let session = remote_session(&state, session_id)?;
    let request = RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: state.next_request_id("pty-get-cwd"),
        method: METHOD_PTY_GET_CWD.to_string(),
        params: serde_json::json!({ "ptyId": pty_id }),
    };
    let response = remote_request_for_session(session, request).await?;
    let res = response_result(response)?;
    res.get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "no cwd in response".to_string())
}

#[tauri::command]
pub async fn remote_watch_add(
    state: State<'_, RemoteState>,
    session_id: u64,
    paths: Vec<String>,
) -> Result<(), String> {
    remote_watch_request(&state, session_id, METHOD_WATCH_ADD, paths).await
}

#[tauri::command]
pub async fn remote_watch_remove(
    state: State<'_, RemoteState>,
    session_id: u64,
    paths: Vec<String>,
) -> Result<(), String> {
    remote_watch_request(&state, session_id, METHOD_WATCH_REMOVE, paths).await
}

impl RemoteState {
    fn next_request_id(&self, operation: &str) -> String {
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        format!("{operation}-{id}")
    }
}

fn remote_session(state: &RemoteState, session_id: u64) -> Result<Arc<RemoteSession>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "remote session state is poisoned".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "remote session not found".to_string())
}

async fn remote_request_for_session(
    session: Arc<RemoteSession>,
    request: RemoteRequest,
) -> Result<RemoteResponse, String> {
    tauri::async_runtime::spawn_blocking(move || session.request(&request))
        .await
        .map_err(|error| format!("remote request task failed: {error}"))?
}

fn response_result(response: RemoteResponse) -> Result<serde_json::Value, String> {
    if response.ok {
        Ok(response.result.unwrap_or(serde_json::Value::Null))
    } else {
        Err(response_error(response))
    }
}

fn request_header_u64(request: &tauri::ipc::Request, name: &str) -> Result<u64, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| format!("remote_pty_write: missing {name} header"))
}

async fn remote_watch_request(
    state: &RemoteState,
    session_id: u64,
    method: &str,
    paths: Vec<String>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let request = RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: state.next_request_id(if method == METHOD_WATCH_ADD {
            "watch-add"
        } else {
            "watch-remove"
        }),
        method: method.to_string(),
        params: serde_json::json!({ "paths": paths }),
    };
    response_result(
        remote_request_for_session(remote_session(state, session_id)?, request).await?,
    )?;
    Ok(())
}

#[tauri::command]
pub fn remote_close(state: State<'_, RemoteState>, session_id: u64) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "remote session state is poisoned".to_string())?
        .remove(&session_id);
    drop(session);
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SshPingResult {
    pub host: String,
    pub port: u16,
    pub online: bool,
    #[serde(rename = "latencyMs")]
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SshServerMetrics {
    #[serde(rename = "osName")]
    pub os_name: String,
    #[serde(rename = "cpuPercent")]
    pub cpu_percent: f32,
    #[serde(rename = "memUsedBytes")]
    pub mem_used_bytes: u64,
    #[serde(rename = "memTotalBytes")]
    pub mem_total_bytes: u64,
    #[serde(rename = "diskUsedBytes")]
    pub disk_used_bytes: u64,
    #[serde(rename = "diskTotalBytes")]
    pub disk_total_bytes: u64,
    #[serde(rename = "netRxBytes")]
    pub net_rx_bytes: u64,
    #[serde(rename = "netTxBytes")]
    pub net_tx_bytes: u64,
    #[serde(rename = "tcpConnections")]
    pub tcp_connections: u32,
    #[serde(rename = "usersCount")]
    pub users_count: u32,
    #[serde(rename = "loadAvg")]
    pub load_avg: Vec<f32>,
    #[serde(rename = "pingMs")]
    pub ping_ms: Option<u64>,
}

pub const METRICS_PROBE_SCRIPT: &str = r#"sh -c '
os=$(grep -oP "(?<=PRETTY_NAME=).*" /etc/os-release 2>/dev/null | tr -d "\"" || uname -sr)
[ -z "$os" ] && os=$(uname -sr)
load=$(cat /proc/loadavg 2>/dev/null | awk "{print \$1,\$2,\$3}")
mem=$(cat /proc/meminfo 2>/dev/null | awk "/MemTotal/{t=\$2} /MemAvailable/{a=\$2} END{print t, a}")
disk=$(df -k / 2>/dev/null | tail -1 | awk "{print \$2,\$3}")
tcp=$(grep -c "^[0-9 ]*:" /proc/net/tcp 2>/dev/null || ss -t -a 2>/dev/null | wc -l)
users=$(who 2>/dev/null | wc -l)
net=$(cat /proc/net/dev 2>/dev/null | awk "NR>2 {rx+=\$2; tx+=\$10} END{print rx, tx}")
stat=$(cat /proc/stat 2>/dev/null | head -1 | awk "{print \$2,\$3,\$4,\$5,\$6,\$7,\$8}")
echo "VOKTTY_METRICS|$os|$load|$mem|$disk|$tcp|$users|$net|$stat"
'"#;

pub fn parse_metrics_line(line: &str, ping_ms: Option<u64>) -> Option<SshServerMetrics> {
    let raw = line.trim();
    let marker = "VOKTTY_METRICS|";
    let idx = raw.find(marker)?;
    let payload = &raw[idx + marker.len()..];

    let parts: Vec<&str> = payload.split('|').collect();
    if parts.len() < 8 {
        return None;
    }

    let os_name = if parts[0].trim().is_empty() {
        "Linux".to_string()
    } else {
        parts[0].trim().to_string()
    };

    let load_avg: Vec<f32> = parts[1]
        .split_whitespace()
        .filter_map(|s| s.parse::<f32>().ok())
        .collect();

    let mem_parts: Vec<u64> = parts[2]
        .split_whitespace()
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();
    let (mem_total_bytes, mem_used_bytes) = if mem_parts.len() >= 2 {
        let total = mem_parts[0] * 1024;
        let avail = mem_parts[1] * 1024;
        (total, total.saturating_sub(avail))
    } else {
        (0, 0)
    };

    let disk_parts: Vec<u64> = parts[3]
        .split_whitespace()
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();
    let (disk_total_bytes, disk_used_bytes) = if disk_parts.len() >= 2 {
        (disk_parts[0] * 1024, disk_parts[1] * 1024)
    } else {
        (0, 0)
    };

    let tcp_connections = parts[4].trim().parse::<u32>().unwrap_or(0);
    let users_count = parts[5].trim().parse::<u32>().unwrap_or(0);

    let net_parts: Vec<u64> = parts[6]
        .split_whitespace()
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();
    let (net_rx_bytes, net_tx_bytes) = if net_parts.len() >= 2 {
        (net_parts[0], net_parts[1])
    } else {
        (0, 0)
    };

    let stat_parts: Vec<f32> = parts[7]
        .split_whitespace()
        .filter_map(|s| s.parse::<f32>().ok())
        .collect();
    let cpu_percent = if stat_parts.len() >= 4 {
        let user = stat_parts[0];
        let nice = stat_parts[1];
        let system = stat_parts[2];
        let idle = stat_parts[3];
        let iowait = stat_parts.get(4).copied().unwrap_or(0.0);
        let irq = stat_parts.get(5).copied().unwrap_or(0.0);
        let softirq = stat_parts.get(6).copied().unwrap_or(0.0);
        let total_idle = idle + iowait;
        let total_busy = user + nice + system + irq + softirq;
        let total = total_idle + total_busy;
        if total > 0.0 {
            ((total_busy / total) * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        }
    } else {
        0.0
    };

    Some(SshServerMetrics {
        os_name,
        cpu_percent,
        mem_used_bytes,
        mem_total_bytes,
        disk_used_bytes,
        disk_total_bytes,
        net_rx_bytes,
        net_tx_bytes,
        tcp_connections,
        users_count,
        load_avg,
        ping_ms,
    })
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMultiplexerSession {
    pub name: String,
    pub windows_count: u32,
    pub attached_count: u32,
    pub created_at: Option<u64>,
    pub last_activity: Option<u64>,
    pub is_attached: bool,
    pub multiplexer: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMultiplexerProbe {
    pub supported: bool,
    pub multiplexer: Option<String>,
    pub sessions: Vec<RemoteMultiplexerSession>,
}

pub const MULTIPLEXER_PROBE_SCRIPT: &str = r#"sh -c '
if command -v tmux >/dev/null 2>&1; then
    printf "VOKTTY_MUX|tmux\n"
    tmux list-sessions -F "VOKTTY_SES|#{session_name}|#{session_windows}|#{session_attached}|#{session_created}|#{session_activity}" 2>/dev/null || true
elif command -v screen >/dev/null 2>&1; then
    printf "VOKTTY_MUX|screen\n"
    screen -ls 2>/dev/null | grep -E "^[[:space:]]*[0-9]+\." | while read -r line; do
        name=$(echo "$line" | awk "{print \$1}" | cut -d"." -f2-)
        [ -z "$name" ] && name=$(echo "$line" | awk "{print \$1}")
        att=0
        echo "$line" | grep -qi "Attached" && att=1
        printf "VOKTTY_SES|%s|1|%d|0|0\n" "$name" "$att"
    done || true
else
    printf "VOKTTY_MUX|none\n"
fi
'"#;

pub fn parse_multiplexer_probe(output: &str) -> RemoteMultiplexerProbe {
    let mut multiplexer = None;
    let mut sessions = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(mux_type) = trimmed.strip_prefix("VOKTTY_MUX|") {
            let clean = mux_type.trim();
            if clean != "none" && !clean.is_empty() {
                multiplexer = Some(clean.to_string());
            }
        } else if let Some(ses_payload) = trimmed.strip_prefix("VOKTTY_SES|") {
            let parts: Vec<&str> = ses_payload.split('|').collect();
            if parts.is_empty() || parts[0].trim().is_empty() {
                continue;
            }
            let name = parts[0].trim().to_string();
            let windows_count = parts
                .get(1)
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1);
            let attached_count = parts
                .get(2)
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0);
            let created_at = parts
                .get(3)
                .and_then(|s| s.parse::<u64>().ok())
                .filter(|v| *v > 0);
            let last_activity = parts
                .get(4)
                .and_then(|s| s.parse::<u64>().ok())
                .filter(|v| *v > 0);
            let is_attached = attached_count > 0;
            let mux = multiplexer.clone().unwrap_or_else(|| "tmux".to_string());

            sessions.push(RemoteMultiplexerSession {
                name,
                windows_count,
                attached_count,
                created_at,
                last_activity,
                is_attached,
                multiplexer: mux,
            });
        }
    }

    RemoteMultiplexerProbe {
        supported: multiplexer.is_some(),
        multiplexer,
        sessions,
    }
}

#[tauri::command]
pub async fn ssh_ping(host: String, port: Option<u16>) -> Result<SshPingResult, String> {
    let p = port.unwrap_or(22);
    let host_clone = host.clone();

    tokio::task::spawn_blocking(move || {
        let target = format!("{}:{}", host_clone.trim(), p);
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(1500);

        use std::net::ToSocketAddrs;
        let addrs: Vec<_> = match target.to_socket_addrs() {
            Ok(iter) => iter.collect(),
            Err(e) => {
                return Ok(SshPingResult {
                    host: host_clone,
                    port: p,
                    online: false,
                    latency_ms: None,
                    error: Some(e.to_string()),
                });
            }
        };

        for addr in addrs {
            if std::net::TcpStream::connect_timeout(&addr, timeout).is_ok() {
                let latency_ms = start.elapsed().as_millis() as u64;
                return Ok(SshPingResult {
                    host: host_clone,
                    port: p,
                    online: true,
                    latency_ms: Some(latency_ms),
                    error: None,
                });
            }
        }

        Ok(SshPingResult {
            host: host_clone,
            port: p,
            online: false,
            latency_ms: None,
            error: Some("Host unreachable or port closed".to_string()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_fetch_metrics(
    connection: RemoteSshConnection,
) -> Result<SshServerMetrics, String> {
    validate_connection(&connection)?;
    let conn_clone = connection.clone();

    tokio::task::spawn_blocking(move || {
        let p = conn_clone.port.unwrap_or(22);
        let target = format!("{}:{}", conn_clone.host.trim(), p);
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(1500);

        use std::net::ToSocketAddrs;
        let mut ping_ms = None;
        if let Ok(addrs) = target.to_socket_addrs() {
            for addr in addrs {
                if std::net::TcpStream::connect_timeout(&addr, timeout).is_ok() {
                    ping_ms = Some(start.elapsed().as_millis() as u64);
                    break;
                }
            }
        }

        let output = run_ssh_capture(&conn_clone, METRICS_PROBE_SCRIPT)?;
        parse_metrics_line(&output, ping_ms)
            .ok_or_else(|| "Failed to parse remote server metrics".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_upload_files(
    connection: RemoteSshConnection,
    sources: Vec<String>,
    dest_dir: String,
) -> Result<(), String> {
    validate_connection(&connection)?;
    if sources.is_empty() {
        return Ok(());
    }

    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("scp");
        cmd.arg("-r");
        let user_extra = connection
            .extra_args
            .as_deref()
            .map(parse_extra_args)
            .unwrap_or_default();

        if !has_ssh_option(&user_extra, "BatchMode") {
            cmd.arg("-o").arg("BatchMode=yes");
        }
        if !has_ssh_option(&user_extra, "ServerAliveInterval") {
            cmd.arg("-o").arg("ServerAliveInterval=15");
        }
        if !has_ssh_option(&user_extra, "ServerAliveCountMax") {
            cmd.arg("-o").arg("ServerAliveCountMax=3");
        }
        if !has_ssh_option(&user_extra, "StrictHostKeyChecking") {
            cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
        }

        if let Some(port) = connection.port.filter(|p| *p != 22) {
            cmd.arg("-P").arg(port.to_string());
        }

        if let Some(identity_file) = connection
            .identity_file
            .as_deref()
            .filter(|p| !p.trim().is_empty())
        {
            cmd.arg("-i").arg(expand_tilde(identity_file));
        }

        for arg in user_extra {
            cmd.arg(arg);
        }

        for source in &sources {
            cmd.arg(source);
        }

        let dest_host = ssh_destination(&connection);
        let clean_dest = dest_dir.replace('\\', "/");
        cmd.arg(format!("{}:{}", dest_host, clean_dest));

        crate::modules::proc::hide_console(&mut cmd);
        let output = cmd
            .output()
            .map_err(|e| format!("Failed to execute scp: {e}"))?;

        if !output.status.success() {
            return Err(command_error(&output.stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_download_files(
    connection: RemoteSshConnection,
    remote_sources: Vec<String>,
    local_dest_dir: String,
) -> Result<(), String> {
    validate_connection(&connection)?;
    if remote_sources.is_empty() {
        return Ok(());
    }

    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("scp");
        cmd.arg("-r");
        cmd.arg("-o").arg("BatchMode=yes");
        cmd.arg("-o").arg("ServerAliveInterval=15");
        cmd.arg("-o").arg("ServerAliveCountMax=3");
        cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");

        if let Some(port) = connection.port.filter(|p| *p != 22) {
            cmd.arg("-P").arg(port.to_string());
        }

        if let Some(identity_file) = connection
            .identity_file
            .as_deref()
            .filter(|p| !p.trim().is_empty())
        {
            cmd.arg("-i").arg(identity_file.trim());
        }

        if let Some(extra_args) = connection.extra_args.as_deref() {
            for arg in extra_args.split_whitespace() {
                cmd.arg(arg);
            }
        }

        let dest_host = ssh_destination(&connection);
        for source in &remote_sources {
            let clean_src = source.replace('\\', "/");
            cmd.arg(format!("{}:{}", dest_host, clean_src));
        }

        cmd.arg(&local_dest_dir);

        crate::modules::proc::hide_console(&mut cmd);
        let output = cmd
            .output()
            .map_err(|e| format!("Failed to execute scp: {e}"))?;

        if !output.status.success() {
            return Err(command_error(&output.stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ssh_list_multiplexer_sessions(
    connection: RemoteSshConnection,
) -> Result<RemoteMultiplexerProbe, String> {
    validate_connection(&connection)?;
    let conn_clone = connection.clone();

    tokio::task::spawn_blocking(move || {
        let output = run_ssh_capture(&conn_clone, MULTIPLEXER_PROBE_SCRIPT)?;
        Ok(parse_multiplexer_probe(&output))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn host_local_metrics() -> Result<SshServerMetrics, String> {
    #[cfg(windows)]
    {
        let (mem_total_bytes, mem_used_bytes) = get_windows_memory();
        let (disk_total_bytes, disk_used_bytes) = get_windows_disk();
        let cpu_percent = get_windows_cpu();

        Ok(SshServerMetrics {
            os_name: "Windows Local".to_string(),
            cpu_percent,
            mem_used_bytes,
            mem_total_bytes,
            disk_used_bytes,
            disk_total_bytes,
            net_rx_bytes: 0,
            net_tx_bytes: 0,
            tcp_connections: 0,
            users_count: 1,
            load_avg: vec![],
            ping_ms: Some(0),
        })
    }

    #[cfg(target_os = "linux")]
    {
        let output = match std::process::Command::new("sh")
            .arg("-c")
            .arg(METRICS_PROBE_SCRIPT)
            .output()
        {
            Ok(out) => String::from_utf8_lossy(&out.stdout).into_owned(),
            Err(_) => String::new(),
        };
        if let Some(metrics) = parse_metrics_line(&output, Some(0)) {
            return Ok(metrics);
        }
        Ok(SshServerMetrics {
            os_name: "Linux Local".to_string(),
            cpu_percent: 0.0,
            mem_used_bytes: 0,
            mem_total_bytes: 0,
            disk_used_bytes: 0,
            disk_total_bytes: 0,
            net_rx_bytes: 0,
            net_tx_bytes: 0,
            tcp_connections: 0,
            users_count: 1,
            load_avg: vec![],
            ping_ms: Some(0),
        })
    }

    #[cfg(target_os = "macos")]
    {
        Ok(SshServerMetrics {
            os_name: "macOS Local".to_string(),
            cpu_percent: 0.0,
            mem_used_bytes: 0,
            mem_total_bytes: 0,
            disk_used_bytes: 0,
            disk_total_bytes: 0,
            net_rx_bytes: 0,
            net_tx_bytes: 0,
            tcp_connections: 0,
            users_count: 1,
            load_avg: vec![],
            ping_ms: Some(0),
        })
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        Ok(SshServerMetrics {
            os_name: "Android Local".to_string(),
            cpu_percent: 0.0,
            mem_used_bytes: 0,
            mem_total_bytes: 0,
            disk_used_bytes: 0,
            disk_total_bytes: 0,
            net_rx_bytes: 0,
            net_tx_bytes: 0,
            tcp_connections: 0,
            users_count: 1,
            load_avg: vec![],
            ping_ms: Some(0),
        })
    }
}

#[cfg(windows)]
fn get_windows_memory() -> (u64, u64) {
    #[repr(C)]
    struct MemoryStatusEx {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }
    extern "system" {
        fn GlobalMemoryStatusEx(lp_buffer: *mut MemoryStatusEx) -> i32;
    }
    let mut stat = MemoryStatusEx {
        dw_length: std::mem::size_of::<MemoryStatusEx>() as u32,
        dw_memory_load: 0,
        ull_total_phys: 0,
        ull_avail_phys: 0,
        ull_total_page_file: 0,
        ull_avail_page_file: 0,
        ull_total_virtual: 0,
        ull_avail_virtual: 0,
        ull_avail_extended_virtual: 0,
    };
    unsafe {
        if GlobalMemoryStatusEx(&mut stat) != 0 {
            let total = stat.ull_total_phys;
            let used = total.saturating_sub(stat.ull_avail_phys);
            return (total, used);
        }
    }
    (0, 0)
}

#[cfg(windows)]
fn get_windows_disk() -> (u64, u64) {
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lp_directory_name: *const u16,
            lp_free_bytes_available_to_caller: *mut u64,
            lp_total_number_of_bytes: *mut u64,
            lp_total_number_of_free_bytes: *mut u64,
        ) -> i32;
    }
    let path: Vec<u16> = "C:\\\0".encode_utf16().collect();
    let mut free: u64 = 0;
    let mut total: u64 = 0;
    unsafe {
        if GetDiskFreeSpaceExW(path.as_ptr(), &mut free, &mut total, std::ptr::null_mut()) != 0 {
            let used = total.saturating_sub(free);
            return (total, used);
        }
    }
    (0, 0)
}

#[cfg(windows)]
fn get_windows_cpu() -> f32 {
    extern "system" {
        fn GetSystemTimes(
            lp_idle_time: *mut u64,
            lp_kernel_time: *mut u64,
            lp_user_time: *mut u64,
        ) -> i32;
    }
    static LAST_SAMPLE: std::sync::Mutex<Option<(u64, u64, u64)>> = std::sync::Mutex::new(None);

    let mut idle: u64 = 0;
    let mut kernel: u64 = 0;
    let mut user: u64 = 0;

    unsafe {
        if GetSystemTimes(&mut idle, &mut kernel, &mut user) == 0 {
            return 0.0;
        }
    }

    let mut guard = match LAST_SAMPLE.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Some((prev_idle, prev_kernel, prev_user)) = *guard {
        let idle_diff = idle.saturating_sub(prev_idle);
        let kernel_diff = kernel.saturating_sub(prev_kernel);
        let user_diff = user.saturating_sub(prev_user);
        let total_sys = kernel_diff + user_diff;

        *guard = Some((idle, kernel, user));

        if total_sys > 0 {
            let busy = total_sys.saturating_sub(idle_diff);
            return ((busy as f32 / total_sys as f32) * 100.0).clamp(0.0, 100.0);
        }
    } else {
        *guard = Some((idle, kernel, user));
    }
    0.0
}

fn validate_connection(connection: &RemoteSshConnection) -> Result<(), String> {
    if connection.host.trim().is_empty() || has_control_or_space(&connection.host) {
        return Err("SSH host is invalid".to_string());
    }
    if connection.user.as_deref().is_some_and(has_control_or_space) {
        return Err("SSH user is invalid".to_string());
    }
    if connection
        .extra_args
        .as_deref()
        .is_some_and(|args| args.chars().any(char::is_control))
    {
        return Err("SSH arguments contain control characters".to_string());
    }
    if connection
        .initial_directory
        .as_deref()
        .is_some_and(|path| path.chars().any(char::is_control))
    {
        return Err("SSH initial directory contains control characters".to_string());
    }
    Ok(())
}

fn has_control_or_space(value: &str) -> bool {
    value
        .chars()
        .any(|char| char.is_control() || char.is_whitespace())
}

pub fn parse_extra_args(extra_args: &str) -> Vec<String> {
    shlex::split(extra_args)
        .unwrap_or_else(|| extra_args.split_whitespace().map(str::to_string).collect())
}

pub fn has_ssh_option(args: &[String], opt_name: &str) -> bool {
    let opt_lower = opt_name.to_lowercase();
    let prefix = format!("{}=", opt_lower);
    for (i, arg) in args.iter().enumerate() {
        let lower = arg.to_lowercase();
        if lower.starts_with(&prefix) {
            return true;
        }
        if lower == "-o" {
            if let Some(next) = args.get(i + 1) {
                if next.to_lowercase().starts_with(&prefix) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn expand_tilde(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            let rest = &trimmed[2..];
            return format!("{}/{}", home.to_string_lossy().replace('\\', "/"), rest);
        }
    }
    trimmed.to_string()
}

fn ssh_destination(connection: &RemoteSshConnection) -> String {
    match connection.user.as_deref().filter(|user| !user.is_empty()) {
        Some(user) => format!("{user}@{}", connection.host.trim()),
        None => connection.host.trim().to_string(),
    }
}

fn ssh_args(connection: &RemoteSshConnection) -> Vec<String> {
    let mut args = vec!["-T".to_string()];
    let user_extra = connection
        .extra_args
        .as_deref()
        .map(parse_extra_args)
        .unwrap_or_default();

    if !has_ssh_option(&user_extra, "BatchMode") {
        args.extend(["-o".to_string(), "BatchMode=yes".to_string()]);
    }
    if !has_ssh_option(&user_extra, "ServerAliveInterval") {
        args.extend(["-o".to_string(), "ServerAliveInterval=15".to_string()]);
    }
    if !has_ssh_option(&user_extra, "ServerAliveCountMax") {
        args.extend(["-o".to_string(), "ServerAliveCountMax=3".to_string()]);
    }
    if !has_ssh_option(&user_extra, "TCPKeepAlive") {
        args.extend(["-o".to_string(), "TCPKeepAlive=yes".to_string()]);
    }
    if !has_ssh_option(&user_extra, "ConnectTimeout") {
        args.extend(["-o".to_string(), "ConnectTimeout=10".to_string()]);
    }
    if !has_ssh_option(&user_extra, "StrictHostKeyChecking") {
        args.extend([
            "-o".to_string(),
            "StrictHostKeyChecking=accept-new".to_string(),
        ]);
    }

    if let Some(port) = connection.port.filter(|port| *port != 22) {
        args.extend(["-p".to_string(), port.to_string()]);
    }
    if let Some(identity_file) = connection
        .identity_file
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        args.extend(["-i".to_string(), expand_tilde(identity_file)]);
    }
    args.extend(user_extra);
    args.push(ssh_destination(connection));
    args
}

pub fn run_ssh_capture(
    connection: &RemoteSshConnection,
    remote_command: &str,
) -> Result<String, String> {
    let mut command = Command::new("ssh");
    command.args(ssh_args(connection)).arg(remote_command);
    crate::modules::proc::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("could not start ssh: {e}"))?;
    if !output.status.success() {
        return Err(command_error(&output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

struct HelperProbe {
    architecture: String,
    digest: Option<String>,
    shell_digest: Option<String>,
}

struct BundledHelper {
    bytes: Vec<u8>,
    digest: String,
}

fn probe_remote_helper(connection: &RemoteSshConnection) -> Result<HelperProbe, String> {
    parse_helper_probe(&run_ssh_capture(connection, &probe_command())?)
}

fn parse_helper_probe(output: &str) -> Result<HelperProbe, String> {
    let line = output
        .lines()
        .rev()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("VOKTTY_HELPER|"))
        .ok_or_else(|| "SSH did not return remote helper metadata".to_string())?;
    let mut fields = line.split('|');
    let architecture = fields
        .next()
        .ok_or_else(|| "remote helper metadata is malformed".to_string())?;
    let digest = fields
        .next()
        .ok_or_else(|| "remote helper metadata is malformed".to_string())?;
    let shell_digest = fields.next().unwrap_or("-");
    if !matches!(architecture, "x86_64" | "aarch64") {
        return Err(format!("unsupported Linux architecture: {architecture}"));
    }
    let digest = (digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| digest.to_ascii_lowercase());
    let shell_digest = (shell_digest.len() == 64
        && shell_digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
    .then(|| shell_digest.to_ascii_lowercase());
    Ok(HelperProbe {
        architecture: architecture.to_string(),
        digest,
        shell_digest,
    })
}

fn helper_path(app: &AppHandle, architecture: &str) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("VOKTTY_REMOTE_HELPER_PATH") {
        let pb = PathBuf::from(path);
        if pb.is_file() {
            return Ok(pb);
        }
    }

    let subpath = format!("{REMOTE_OS}-{architecture}/voktty-remote");
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Tauri resource directory (with and without "resources" wrapper directory)
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("remote").join(&subpath));
        candidates.push(resource_dir.join("remote").join(&subpath));
    }

    // 2. Current executable directory and ancestors (handles runner subfolders, portable, and custom installs)
    if let Ok(current_exe) = std::env::current_exe() {
        let mut curr = current_exe.parent();
        for _ in 0..5 {
            if let Some(dir) = curr {
                candidates.push(dir.join("resources").join("remote").join(&subpath));
                candidates.push(dir.join("remote").join(&subpath));
                candidates.push(
                    dir.join("src-tauri")
                        .join("resources")
                        .join("remote")
                        .join(&subpath),
                );
                curr = dir.parent();
            } else {
                break;
            }
        }
    }

    // 3. Cargo manifest dir (development / testing fallback)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("resources").join("remote").join(&subpath));
    candidates.push(
        manifest_dir
            .join("..")
            .join("src-tauri")
            .join("resources")
            .join("remote")
            .join(&subpath),
    );

    for path in &candidates {
        if path.is_file() {
            return Ok(path.clone());
        }
    }

    Err(format!(
        "remote helper binary 'voktty-remote' for {architecture} was not found on local system (checked resource directory and application paths)"
    ))
}

fn read_bundled_helper(helper_path: &Path, architecture: &str) -> Result<BundledHelper, String> {
    let bytes = fs::read(helper_path).map_err(|error| {
        format!(
            "remote helper is not bundled for {architecture}: {} ({error})",
            helper_path.display()
        )
    })?;
    let digest = hex::encode(Sha256::digest(&bytes));
    Ok(BundledHelper { bytes, digest })
}

fn get_bundled_helper(app: &AppHandle, architecture: &str) -> Result<BundledHelper, String> {
    if let Ok(path) = helper_path(app, architecture) {
        if let Ok(helper) = read_bundled_helper(&path, architecture) {
            return Ok(helper);
        }
    }
    if architecture == "x86_64" {
        let bytes = BUNDLED_LINUX_X86_64_HELPER.to_vec();
        let digest = hex::encode(Sha256::digest(&bytes));
        return Ok(BundledHelper { bytes, digest });
    }
    Err(format!(
        "remote helper binary 'voktty-remote' for {architecture} was not found on local system (checked resource directory, application paths, and embedded bundle)"
    ))
}

fn install_helper(
    connection: &RemoteSshConnection,
    helper: &BundledHelper,
    architecture: &str,
) -> Result<(), String> {
    let encoded = base64::engine::general_purpose::STANDARD.encode(&helper.bytes);
    let command_line = install_command(architecture, &helper.digest);

    let mut command = Command::new("ssh");
    command
        .args(ssh_args(connection))
        .arg(command_line)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start ssh helper upload: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "ssh upload stdin is unavailable".to_string())?;
    if let Err(error) = stdin.write_all(encoded.as_bytes()) {
        let _ = child.kill();
        return Err(format!("could not upload remote helper: {error}"));
    }
    drop(stdin);
    let output = child
        .wait_with_output()
        .map_err(|e| format!("could not finish remote helper upload: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output.stderr))
    }
}

fn normalize_script_lf(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn remote_shell_bundle() -> [(String, String); 6] {
    [
        ("bashrc".to_string(), normalize_script_lf(REMOTE_BASHRC)),
        ("zsh/.zshenv".to_string(), normalize_script_lf(REMOTE_ZSHENV)),
        ("zsh/.zprofile".to_string(), normalize_script_lf(REMOTE_ZPROFILE)),
        ("zsh/.zlogin".to_string(), normalize_script_lf(REMOTE_ZLOGIN)),
        ("zsh/.zshrc".to_string(), normalize_script_lf(REMOTE_ZSHRC)),
        ("init.fish".to_string(), normalize_script_lf(REMOTE_FISH_INIT)),
    ]
}

fn remote_shell_bundle_digest() -> String {
    let mut digest = Sha256::new();
    for (name, content) in remote_shell_bundle() {
        digest.update(name.as_bytes());
        digest.update([0]);
        digest.update(content.as_bytes());
        digest.update([0]);
    }
    hex::encode(digest.finalize())
}


fn install_remote_shell_integration(
    connection: &RemoteSshConnection,
    digest: &str,
) -> Result<(), String> {
    let payload = format!(
        "{}\n",
        remote_shell_bundle()
        .iter()
        .map(|(_, content)| base64::engine::general_purpose::STANDARD.encode(content.as_bytes()))
        .collect::<Vec<_>>()
        .join("\n")
    );
    let command_line = shell_integration_install_command(digest);
    let mut command = Command::new("ssh");
    command
        .args(ssh_args(connection))
        .arg(command_line)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start SSH shell integration upload: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "SSH shell integration upload stdin is unavailable".to_string())?;
    if let Err(error) = stdin.write_all(payload.as_bytes()) {
        let _ = child.kill();
        return Err(format!(
            "could not upload remote shell integration: {error}"
        ));
    }
    drop(stdin);
    let output = child
        .wait_with_output()
        .map_err(|e| format!("could not finish remote shell integration upload: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output.stderr))
    }
}

fn open_remote_session(
    app: AppHandle,
    connection: RemoteSshConnection,
    workspace_root: Option<String>,
) -> Result<(RemoteSession, RemoteSessionInfo), String> {
    let probe = probe_remote_helper(&connection)?;
    let helper = get_bundled_helper(&app, &probe.architecture)?;
    if probe.digest.as_deref() != Some(helper.digest.as_str()) {
        install_helper(&connection, &helper, &probe.architecture)?;
    }
    let shell_digest = remote_shell_bundle_digest();
    if probe.shell_digest.as_deref() != Some(shell_digest.as_str()) {
        if let Err(error) = install_remote_shell_integration(&connection, &shell_digest) {
            log::warn!("Remote shell integration unavailable; using login shell fallback: {error}");
        }
    }

    let session = start_helper(&app, &connection, &probe.architecture)?;
    let workspace_root = workspace_root
        .filter(|r| !r.trim().is_empty() && r != ".")
        .or_else(|| connection.initial_directory.clone().filter(|d| !d.trim().is_empty()))
        .unwrap_or_else(|| ".".to_string());
    let handshake = RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: "handshake".to_string(),
        method: METHOD_HANDSHAKE.to_string(),
        params: serde_json::json!({ "workspaceRoot": workspace_root }),
    };
    let response = session.request(&handshake)?;
    if !response.ok {
        return Err(response_error(response));
    }
    let info = parse_session_info(response, &probe.architecture, handshake.params)?;
    Ok((session, info))
}

fn start_helper(
    app: &AppHandle,
    connection: &RemoteSshConnection,
    architecture: &str,
) -> Result<RemoteSession, String> {
    let mut command = Command::new("ssh");
    command
        .args(ssh_args(connection))
        .arg(start_command(architecture))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start remote helper: {e}"))?;
    let Some(stdin) = child.stdin.take() else {
        let _ = child.kill();
        return Err("remote helper stdin is unavailable".to_string());
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("remote helper stdout is unavailable".to_string());
    };
    let stderr = child.stderr.take();
    let routing = Arc::new(RemoteRouting::new(app.clone()));
    let reader_routing = routing.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("voktty-remote-reader".to_string())
        .spawn(move || remote_reader_loop(stdout, reader_routing))
    {
        let _ = child.kill();
        return Err(format!("could not start remote helper reader: {error}"));
    }
    if let Some(mut stderr) = stderr {
        let _ = std::thread::Builder::new()
            .name("voktty-remote-stderr".to_string())
            .spawn(move || {
                let mut buffer = String::new();
                if stderr.read_to_string(&mut buffer).is_ok() && !buffer.trim().is_empty() {
                    log::debug!("remote helper stderr: {}", buffer.trim());
                }
            });
    }
    Ok(RemoteSession {
        child: Mutex::new(child),
        stdin: Mutex::new(BufWriter::new(stdin)),
        routing,
        connection: connection.clone(),
    })
}

fn remote_reader_loop(stdout: ChildStdout, routing: Arc<RemoteRouting>) {
    let mut reader = BufReader::new(stdout);
    loop {
        match read_frame(&mut reader) {
            Ok(Some(frame)) => {
                if let Err(error) = routing.route(frame) {
                    routing.fail_all(&error);
                    return;
                }
            }
            Ok(None) => {
                routing.fail_all("remote helper closed the SSH channel");
                return;
            }
            Err(error) => {
                routing.fail_all(&format!("remote helper protocol error: {error}"));
                return;
            }
        }
    }
}

fn install_command(architecture: &str, digest: &str) -> String {
    let directory = format!("$HOME/.voktty/servers/{REMOTE_VERSION}/linux-{architecture}");
    format!(
        "set -eu; dir=\"{directory}\"; mkdir -p \"$dir\"; tmp=\"$dir/.voktty-remote.tmp.$$\"; base64 -d > \"$tmp\"; actual=$(sha256sum \"$tmp\" | cut -d' ' -f1); [ \"$actual\" = '{digest}' ]; chmod 700 \"$tmp\"; mv \"$tmp\" \"$dir/voktty-remote\""
    )
}

fn shell_integration_install_command(digest: &str) -> String {
    let directory = format!("$HOME/.voktty/shell-integration/{REMOTE_SHELL_INTEGRATION_VERSION}");
    format!(
        "set -eu; dir=\"{directory}\"; mkdir -p \"$dir/zsh\"; tmp=\"$dir/.tmp.$$\"; trap 'rm -f \"$tmp\".*' EXIT HUP INT TERM; IFS= read -r bashrc; IFS= read -r zshenv; IFS= read -r zprofile; IFS= read -r zlogin; IFS= read -r zshrc; IFS= read -r fish; printf %s \"$bashrc\" | base64 -d > \"$tmp.bashrc\"; printf %s \"$zshenv\" | base64 -d > \"$tmp.zshenv\"; printf %s \"$zprofile\" | base64 -d > \"$tmp.zprofile\"; printf %s \"$zlogin\" | base64 -d > \"$tmp.zlogin\"; printf %s \"$zshrc\" | base64 -d > \"$tmp.zshrc\"; printf %s \"$fish\" | base64 -d > \"$tmp.fish\"; mv \"$tmp.bashrc\" \"$dir/bashrc\"; mv \"$tmp.zshenv\" \"$dir/zsh/.zshenv\"; mv \"$tmp.zprofile\" \"$dir/zsh/.zprofile\"; mv \"$tmp.zlogin\" \"$dir/zsh/.zlogin\"; mv \"$tmp.zshrc\" \"$dir/zsh/.zshrc\"; mv \"$tmp.fish\" \"$dir/init.fish\"; printf %s '{digest}' > \"$tmp.digest\"; mv \"$tmp.digest\" \"$dir/.digest\"; trap - EXIT HUP INT TERM"
    )
}

fn probe_command() -> String {
    format!(
        "set -eu; raw=$(uname -m); case \"$raw\" in x86_64) arch=x86_64 ;; aarch64|arm64) arch=aarch64 ;; *) arch=\"$raw\" ;; esac; helper=\"$HOME/.voktty/servers/{REMOTE_VERSION}/linux-$arch/voktty-remote\"; digest=-; if [ -f \"$helper\" ]; then digest=$(sha256sum \"$helper\" | cut -d' ' -f1); fi; shell_digest=-; shell_marker=\"$HOME/.voktty/shell-integration/{REMOTE_SHELL_INTEGRATION_VERSION}/.digest\"; if [ -f \"$shell_marker\" ]; then shell_digest=$(cat \"$shell_marker\"); fi; printf 'VOKTTY_HELPER|%s|%s|%s\\n' \"$arch\" \"$digest\" \"$shell_digest\""
    )
}

fn start_command(architecture: &str) -> String {
    format!(
        "export PATH=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin:${{PATH:-}}\"; cd \"$HOME\" && exec \"$HOME/.voktty/servers/{REMOTE_VERSION}/linux-{architecture}/voktty-remote\" --stdio"
    )
}

fn command_error(stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        "SSH command failed".to_string()
    } else {
        message
    }
}

fn response_error(response: RemoteResponse) -> String {
    response
        .error
        .map(|error| format!("{}: {}", error.code, error.message))
        .unwrap_or_else(|| "remote helper rejected the request".to_string())
}

fn parse_session_info(
    response: RemoteResponse,
    architecture: &str,
    handshake_params: serde_json::Value,
) -> Result<RemoteSessionInfo, String> {
    let result = response
        .result
        .ok_or_else(|| "remote helper handshake returned no result".to_string())?;
    let helper_version = result["version"]
        .as_str()
        .ok_or_else(|| "remote helper did not return its version".to_string())?;
    let workspace_root = result["workspaceRoot"]
        .as_str()
        .or_else(|| handshake_params["workspaceRoot"].as_str())
        .unwrap_or(".")
        .to_string();
    let capabilities = result["capabilities"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Ok(RemoteSessionInfo {
        session_id: 0,
        architecture: architecture.to_string(),
        workspace_root,
        helper_version: helper_version.to_string(),
        capabilities,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> RemoteSshConnection {
        RemoteSshConnection {
            host: "server.example".to_string(),
            user: Some("ubuntu".to_string()),
            port: Some(2222),
            identity_file: Some("C:/keys/id_ed25519".to_string()),
            extra_args: Some("-o ConnectTimeout=5".to_string()),
            initial_directory: None,
            multiplexer_mode: None,
            tmux_session_name: None,
            active_multiplexer_session: None,
            multiplexer_action: None,
        }
    }

    #[test]
    fn builds_ssh_arguments_without_shell_interpolation() {
        assert_eq!(
            ssh_args(&connection()),
            vec![
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "ServerAliveCountMax=3",
                "-o",
                "TCPKeepAlive=yes",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-p",
                "2222",
                "-i",
                "C:/keys/id_ed25519",
                "-o",
                "ConnectTimeout=5",
                "ubuntu@server.example"
            ]
        );
    }

    #[test]
    fn preserves_user_strict_host_key_checking_and_options() {
        let conn = RemoteSshConnection {
            host: "192.168.1.4".to_string(),
            user: Some("abc".to_string()),
            port: Some(9194),
            identity_file: Some("~/.ssh/id_ed25519".to_string()),
            extra_args: Some("-o HostKeyAlias=forgenex-code4 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR".to_string()),
            initial_directory: None,
            multiplexer_mode: None,
            tmux_session_name: None,
            active_multiplexer_session: None,
            multiplexer_action: None,
        };
        let args = ssh_args(&conn);
        assert!(!args.iter().any(|a| a == "StrictHostKeyChecking=accept-new"));
        assert!(args.iter().any(|a| a == "HostKeyAlias=forgenex-code4"));
        assert!(args.iter().any(|a| a == "StrictHostKeyChecking=no"));
        assert!(args.iter().any(|a| a == "UserKnownHostsFile=/dev/null"));
        assert!(args.iter().any(|a| a == "LogLevel=ERROR"));
        assert_eq!(args.last().map(String::as_str), Some("abc@192.168.1.4"));
    }

    #[test]
    fn parses_installed_helper_probe() {
        let digest = "a".repeat(64);
        let shell_digest = "b".repeat(64);
        let probe = parse_helper_probe(&format!(
            "login banner\nVOKTTY_HELPER|x86_64|{digest}|{shell_digest}\n"
        ))
        .expect("probe must parse");
        assert_eq!(probe.architecture, "x86_64");
        assert_eq!(probe.digest.as_deref(), Some(digest.as_str()));
        assert_eq!(probe.shell_digest.as_deref(), Some(shell_digest.as_str()));
    }

    #[test]
    fn treats_missing_or_invalid_remote_digest_as_not_installed() {
        let missing = parse_helper_probe("VOKTTY_HELPER|aarch64|-\n").expect("probe must parse");
        let invalid =
            parse_helper_probe("VOKTTY_HELPER|x86_64|not-a-digest\n").expect("probe must parse");
        assert_eq!(missing.digest, None);
        assert_eq!(invalid.digest, None);
        assert_eq!(missing.shell_digest, None);
        assert!(parse_helper_probe("VOKTTY_HELPER|armv7l|-\n").is_err());
    }

    #[test]
    fn upload_command_contains_only_fixed_remote_locations_and_digest() {
        let command = install_command("x86_64", &"a".repeat(64));
        assert!(command.contains(&format!(".voktty/servers/{REMOTE_VERSION}/linux-x86_64")));
        assert!(command.contains("sha256sum"));
        assert!(!command.contains("; rm -rf"));
    }

    #[test]
    fn probe_command_normalizes_architecture_and_checks_versioned_helper() {
        let command = probe_command();
        assert!(command.contains("aarch64|arm64) arch=aarch64"));
        assert!(command.contains(&format!(".voktty/servers/{REMOTE_VERSION}/linux-$arch")));
        assert!(command.contains(&format!(".voktty/shell-integration/{REMOTE_SHELL_INTEGRATION_VERSION}/.digest")));
        assert!(command.contains("VOKTTY_HELPER|%s|%s|%s"));
    }

    #[test]
    fn remote_shell_bundle_has_a_stable_versioned_install_contract() {
        let digest = remote_shell_bundle_digest();
        assert_eq!(digest.len(), 64);
        assert!(digest.bytes().all(|byte| byte.is_ascii_hexdigit()));
        let command = shell_integration_install_command(&digest);
        assert!(command.contains(&format!(".voktty/shell-integration/{REMOTE_SHELL_INTEGRATION_VERSION}")));
        assert!(command.contains("$dir/zsh/.zshrc"));
        assert!(command.contains("$dir/init.fish"));
        assert!(command.contains(&digest));
    }

    #[test]
    fn serializes_remote_file_changes_with_the_session_boundary() {
        let payload = RemoteChangedPayload {
            paths: vec!["/srv/app/src/main.rs".to_string()],
            session_id: 42,
        };

        assert_eq!(
            serde_json::to_value(payload).expect("payload must serialize"),
            serde_json::json!({
                "paths": ["/srv/app/src/main.rs"],
                "sessionId": 42
            })
        );
    }

    #[test]
    fn parses_remote_server_metrics_line() {
        let sample = "VOKTTY_METRICS|Debian GNU/Linux 12 (bookworm)|0.46 0.51 0.52|24956928 6553600|406423552 294125568|33|1|1250000 850000|1500 50 800 8000 100 10 20";
        let parsed = parse_metrics_line(sample, Some(15)).expect("must parse");
        assert_eq!(parsed.os_name, "Debian GNU/Linux 12 (bookworm)");
        assert_eq!(parsed.load_avg, vec![0.46, 0.51, 0.52]);
        assert_eq!(parsed.tcp_connections, 33);
        assert_eq!(parsed.users_count, 1);
        assert_eq!(parsed.ping_ms, Some(15));
        assert!(parsed.mem_total_bytes > 0);
        assert!(parsed.disk_total_bytes > 0);
        assert!(parsed.cpu_percent > 0.0);
    }

    #[test]
    fn parses_remote_multiplexer_probe_output() {
        let sample = "welcome to server\nVOKTTY_MUX|tmux\nVOKTTY_SES|voktty-main|2|0|1725181200|1725181250\nVOKTTY_SES|voktty-dev|1|1|1725180000|1725181200\n";
        let parsed = parse_multiplexer_probe(sample);
        assert!(parsed.supported);
        assert_eq!(parsed.multiplexer.as_deref(), Some("tmux"));
        assert_eq!(parsed.sessions.len(), 2);
        assert_eq!(parsed.sessions[0].name, "voktty-main");
        assert_eq!(parsed.sessions[0].windows_count, 2);
        assert_eq!(parsed.sessions[0].attached_count, 0);
        assert!(!parsed.sessions[0].is_attached);
        assert_eq!(parsed.sessions[0].created_at, Some(1725181200));
        assert_eq!(parsed.sessions[0].last_activity, Some(1725181250));

        assert_eq!(parsed.sessions[1].name, "voktty-dev");
        assert_eq!(parsed.sessions[1].attached_count, 1);
        assert!(parsed.sessions[1].is_attached);

        let none_sample = "VOKTTY_MUX|none\n";
        let none_parsed = parse_multiplexer_probe(none_sample);
        assert!(!none_parsed.supported);
        assert_eq!(none_parsed.multiplexer, None);
        assert!(none_parsed.sessions.is_empty());
    }
}
