pub mod session;
pub mod types;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use tauri::ipc::Channel;

use session::RdpSession;
use types::{RdpConnectOptions, RdpEvent, RdpInput};

pub struct RdpState {
    sessions: RwLock<HashMap<u32, Arc<RdpSession>>>,
    next_id: AtomicU32,
}

impl Default for RdpState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

#[tauri::command]
pub async fn rdp_connect(
    state: tauri::State<'_, RdpState>,
    options: RdpConnectOptions,
    on_event: Channel<RdpEvent>,
) -> Result<u32, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = session::spawn(id, options, on_event);
    state.sessions.write().unwrap().insert(id, session);
    log::info!("RDP session spawned id={id}");
    Ok(id)
}

#[tauri::command]
pub fn rdp_send_input(
    state: tauri::State<'_, RdpState>,
    id: u32,
    input: RdpInput,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("Unknown RDP session id={id}"))?;

    session.send_input(input)
}

#[tauri::command]
pub fn rdp_disconnect(state: tauri::State<'_, RdpState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    if let Some(s) = session {
        s.disconnect();
        log::info!("RDP session disconnected id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_launch_native(
    host: String,
    port: Option<u16>,
    _username: Option<String>,
) -> Result<(), String> {
    let port = port.unwrap_or(3389);
    let target = format!("{host}:{port}");

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("mstsc")
            .arg(format!("/v:{target}"))
            .spawn()
            .map_err(|e| format!("Failed to launch mstsc: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let url = format!("rdp://full%20address=s:{target}");
        let _ = Command::new("open").arg(&url).spawn();
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        use std::process::Command;
        if Command::new("xfreerdp")
            .arg(format!("/v:{target}"))
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        if Command::new("remmina")
            .arg("-c")
            .arg(&target)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        Err("No native RDP client found (xfreerdp or remmina)".to_string())
    }
}

#[derive(serde::Serialize)]
pub struct RdpProbeResult {
    pub online: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn rdp_probe_host(host: String, port: Option<u16>) -> RdpProbeResult {
    let port = port.unwrap_or(3389);
    let addr = format!("{host}:{port}");
    let start = std::time::Instant::now();

    match tokio::time::timeout(
        std::time::Duration::from_secs(4),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(stream)) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            drop(stream);
            RdpProbeResult {
                online: true,
                latency_ms: Some(latency_ms),
                error: None,
            }
        }
        Ok(Err(e)) => RdpProbeResult {
            online: false,
            latency_ms: None,
            error: Some(e.to_string()),
        },
        Err(_) => RdpProbeResult {
            online: false,
            latency_ms: None,
            error: Some("Tiempo de espera agotado (Timeout)".to_string()),
        },
    }
}
