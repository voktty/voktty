use std::io::{self, ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::agreement::{agree_ephemeral, EphemeralPrivateKey, UnparsedPublicKey, ECDH_P256};
use ring::rand::SystemRandom;
use serde::Serialize;
use tauri::Manager;
use voktty_companion_protocol::{
    AgentCapabilities, AgentState, AgentSummary, ClientMessage, EncryptedFrame, PairingRequest,
    QrInvitation, ServerMessage, SessionControl, INVITATION_TTL_SECS, PROTOCOL_VERSION,
};

use crate::modules::collab::quick_tunnel::{verified_executable, CloudflaredTunnel};

use super::pairing::{PairingDecision, PairingError, PairingRegistry};
use super::transport::CompanionTransport;

const ACCEPT_POLL: Duration = Duration::from_millis(20);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_REQUEST_BYTES: usize = 512 * 1024;

struct CompanionRuntime {
    _server: CompanionLoopback,
    _tunnel: Option<CloudflaredTunnel>,
    host_private_key: Option<EphemeralPrivateKey>,
    sessions: Arc<Mutex<std::collections::HashMap<String, CompanionSession>>>,
    pairing: Arc<Mutex<Option<PairingRegistry>>>,
    invite: QrInvitation,
}

struct CompanionSession {
    transport: CompanionTransport,
    key_confirmed: bool,
}

#[derive(Default)]
pub struct CompanionState {
    runtime: Mutex<Option<CompanionRuntime>>,
    session_states: Arc<Mutex<std::collections::HashMap<String, AgentState>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInvite {
    pub invitation: QrInvitation,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionStatus {
    pub active: bool,
    pub expires_at_ms: Option<u64>,
    pub public_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairingInfo {
    pub id: String,
    pub device_name: String,
    pub fingerprint: String,
    pub expires_at_ms: u64,
}

impl CompanionState {
    pub fn set_session_state(&self, session_id: String, state: AgentState) {
        if let Ok(mut states) = self.session_states.lock() {
            states.insert(session_id, state);
        }
    }

    pub fn start(
        &self,
        app: Option<tauri::AppHandle>,
        custom_cloudflared_path: Option<&str>,
    ) -> Result<CompanionInvite, String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "companion state is unavailable".to_string())?;
        if runtime.is_some() {
            return Err("companion is already active".to_string());
        }

        let pairing = Arc::new(Mutex::new(None));
        let sessions = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let server = CompanionLoopback::start(
            app.clone(),
            pairing.clone(),
            sessions.clone(),
            self.session_states.clone(),
        )
        .map_err(|error| error.to_string())?;
        // Android WebCrypto supports P-256 ECDH across current WebView versions.
        // Keeping both ends on this curve is required before a session key can be derived.
        let private_key = EphemeralPrivateKey::generate(&ECDH_P256, &SystemRandom::new())
            .map_err(|_| "could not create companion host key".to_string())?;
        let public_key = private_key
            .compute_public_key()
            .map_err(|_| "could not derive companion host key".to_string())?;

        let lan_ip = detect_lan_ip().unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
        let local_url = format!("http://{}:{}", lan_ip, server.address().port());
        let tunnel = if let Some(path) = custom_cloudflared_path {
            CloudflaredTunnel::start(
                &verified_executable(Some(path))?,
                &format!("http://127.0.0.1:{}", server.address().port()),
            )
            .ok()
        } else if let Ok(path) = verified_executable(None) {
            CloudflaredTunnel::start(
                &path,
                &format!("http://127.0.0.1:{}", server.address().port()),
            )
            .ok()
        } else {
            None
        };
        let public_url = tunnel
            .as_ref()
            .map(|t| t.public_url().to_string())
            .unwrap_or(local_url);

        let expires_at_ms = now_ms().saturating_add(INVITATION_TTL_SECS.saturating_mul(1000));
        let invite = QrInvitation {
            protocol: PROTOCOL_VERSION,
            public_url,
            invitation_id: random_token(16)?,
            host_public_key: URL_SAFE_NO_PAD.encode(public_key.as_ref()),
            secret: random_token(32)?,
            expires_at_ms,
        };
        let response = CompanionInvite {
            invitation: invite.clone(),
        };
        let registry =
            PairingRegistry::new(&invite.invitation_id, &invite.secret, invite.expires_at_ms)?;
        *pairing
            .lock()
            .map_err(|_| "companion pairing state is unavailable".to_string())? = Some(registry);
        *runtime = Some(CompanionRuntime {
            _server: server,
            _tunnel: tunnel,
            host_private_key: Some(private_key),
            sessions,
            pairing,
            invite,
        });
        Ok(response)
    }

    pub fn stop(&self) -> bool {
        self.runtime
            .lock()
            .ok()
            .and_then(|mut runtime| runtime.take())
            .is_some()
    }

    pub fn status(&self) -> CompanionStatus {
        let Ok(runtime) = self.runtime.lock() else {
            return CompanionStatus {
                active: false,
                expires_at_ms: None,
                public_url: None,
            };
        };
        let Some(runtime) = runtime.as_ref() else {
            return CompanionStatus {
                active: false,
                expires_at_ms: None,
                public_url: None,
            };
        };
        CompanionStatus {
            active: true,
            expires_at_ms: Some(runtime.invite.expires_at_ms),
            public_url: Some(runtime.invite.public_url.clone()),
        }
    }

    pub fn pending_pairings(&self) -> Vec<PendingPairingInfo> {
        let Ok(runtime) = self.runtime.lock() else {
            return Vec::new();
        };
        let Some(runtime) = runtime.as_ref() else {
            return Vec::new();
        };
        let Ok(pairing) = runtime.pairing.lock() else {
            return Vec::new();
        };
        pairing
            .as_ref()
            .map(PairingRegistry::pending)
            .unwrap_or_default()
            .into_iter()
            .map(|pending| PendingPairingInfo {
                id: pending.id,
                device_name: pending.device_name,
                fingerprint: pending.fingerprint,
                expires_at_ms: pending.expires_at_ms,
            })
            .collect()
    }

    pub fn decide_pairing(&self, request_id: &str, approved: bool) -> Result<(), String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "companion state is unavailable".to_string())?;
        let runtime = runtime
            .as_mut()
            .ok_or_else(|| "companion is not active".to_string())?;
        if approved {
            let device = runtime
                .pairing
                .lock()
                .map_err(|_| "companion pairing state is unavailable".to_string())?
                .as_mut()
                .ok_or_else(|| "companion is starting".to_string())?
                .approve(request_id, now_ms())
                .map_err(pairing_error)?;
            let device_key = URL_SAFE_NO_PAD
                .decode(device.public_key)
                .map_err(|_| "companion device key is invalid".to_string())?;
            let private_key = runtime
                .host_private_key
                .take()
                .ok_or_else(|| "companion invitation was already used".to_string())?;
            let peer_key = UnparsedPublicKey::new(&ECDH_P256, device_key);
            let session_key = agree_ephemeral(private_key, &peer_key, |shared| shared.to_vec())
                .map_err(|_| "companion device key is invalid".to_string())?;
            let transport = CompanionTransport::for_host(&session_key, &device.id)
                .map_err(|_| "could not initialize companion transport".to_string())?;
            runtime
                .sessions
                .lock()
                .map_err(|_| "companion session state is unavailable".to_string())?
                .insert(
                    device.id,
                    CompanionSession {
                        transport,
                        key_confirmed: false,
                    },
                );
            Ok(())
        } else if runtime
            .pairing
            .lock()
            .map_err(|_| "companion pairing state is unavailable".to_string())?
            .as_mut()
            .is_some_and(|pairing| pairing.reject(request_id))
        {
            Ok(())
        } else {
            Err("pairing request was not found".to_string())
        }
    }
}

fn pairing_error(error: PairingError) -> String {
    match error {
        PairingError::Consumed => "pairing invitation was already used".to_string(),
        PairingError::Expired => "companion pairing request expired".to_string(),
        PairingError::Rejected => "pairing request was rejected".to_string(),
        PairingError::UnsupportedProtocol => "unsupported companion protocol".to_string(),
    }
}

fn detect_lan_ip() -> Option<IpAddr> {
    let candidates = [("0.0.0.0:0", "192.0.2.1:9"), ("[::]:0", "[2001:db8::1]:9")];
    for (bind, destination) in candidates {
        if let Ok(socket) = std::net::UdpSocket::bind(bind) {
            if socket.connect(destination).is_ok() {
                if let Ok(local) = socket.local_addr() {
                    let ip = local.ip();
                    if !ip.is_unspecified() && !ip.is_loopback() {
                        return Some(ip);
                    }
                }
            }
        }
    }
    None
}

struct CompanionLoopback {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CompanionLoopback {
    fn start(
        app: Option<tauri::AppHandle>,
        pairing: Arc<Mutex<Option<PairingRegistry>>>,
        sessions: Arc<Mutex<std::collections::HashMap<String, CompanionSession>>>,
        session_states: Arc<Mutex<std::collections::HashMap<String, AgentState>>>,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0))?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let thread = thread::Builder::new()
            .name(format!("voktty-companion-accept-{}", address.port()))
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let app = app.clone();
                            let pairing = pairing.clone();
                            let sessions = sessions.clone();
                            let session_states = session_states.clone();
                            thread::spawn(move || {
                                let _ = handle_request(
                                    stream,
                                    &app,
                                    &pairing,
                                    &sessions,
                                    &session_states,
                                );
                            });
                        }
                        Err(error) if error.kind() == ErrorKind::WouldBlock => {
                            thread::sleep(ACCEPT_POLL);
                        }
                        Err(error) => {
                            log::warn!("companion listener stopped: {error}");
                            break;
                        }
                    }
                }
            })?;
        Ok(Self {
            address,
            stop,
            thread: Some(thread),
        })
    }

    fn address(&self) -> SocketAddr {
        self.address
    }
}

impl Drop for CompanionLoopback {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn handle_request(
    mut stream: TcpStream,
    app: &Option<tauri::AppHandle>,
    pairing: &Arc<Mutex<Option<PairingRegistry>>>,
    sessions: &Arc<Mutex<std::collections::HashMap<String, CompanionSession>>>,
    session_states: &Arc<Mutex<std::collections::HashMap<String, AgentState>>>,
) -> io::Result<()> {
    stream.set_read_timeout(Some(REQUEST_TIMEOUT))?;
    stream.set_write_timeout(Some(REQUEST_TIMEOUT))?;
    let request = read_http_request(&mut stream)?;
    let request = request.as_slice();
    let health = request.starts_with(b"GET /health HTTP/");
    let response = if health {
        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK".to_vec()
    } else if request.starts_with(b"OPTIONS ") {
        http_response(204, "No Content", b"")
    } else if request.starts_with(b"POST /v1/companion/pair HTTP/") {
        handle_pairing_request(request, pairing)
    } else if request.starts_with(b"GET /v1/companion/pair/") {
        handle_pairing_status_request(request, pairing)
    } else if request.starts_with(b"POST /v1/companion/session/") {
        let line_end = request
            .windows(2)
            .position(|part| part == b"\r\n")
            .unwrap_or(0);
        let path = std::str::from_utf8(&request[..line_end]).unwrap_or("");
        if path.contains("/confirm") {
            handle_session_confirmation_request(request, sessions)
        } else if path.contains("/message") {
            handle_session_message_request(request, sessions, app, session_states)
        } else {
            http_response(404, "Not Found", b"")
        }
    } else {
        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
    };
    stream.write_all(&response)?;
    stream.flush()?;
    let _ = stream.shutdown(std::net::Shutdown::Write);
    Ok(())
}

fn handle_session_message_request(
    request: &[u8],
    sessions: &Arc<Mutex<std::collections::HashMap<String, CompanionSession>>>,
    app: &Option<tauri::AppHandle>,
    session_states: &Arc<Mutex<std::collections::HashMap<String, AgentState>>>,
) -> Vec<u8> {
    let Some(line_end) = request.windows(2).position(|part| part == b"\r\n") else {
        return http_response(400, "Bad Request", b"");
    };
    let Some(session_id) = std::str::from_utf8(&request[..line_end])
        .ok()
        .and_then(|line| line.strip_prefix("POST /v1/companion/session/"))
        .and_then(|rest| {
            rest.strip_suffix("/message HTTP/1.1")
                .or_else(|| rest.strip_suffix("/message HTTP/1.0"))
        })
    else {
        return http_response(404, "Not Found", b"");
    };
    let Some(body_start) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
        return http_response(400, "Bad Request", b"");
    };
    let frame = match serde_json::from_slice::<EncryptedFrame>(&request[body_start + 4..]) {
        Ok(frame) => frame,
        Err(_) => return http_response(400, "Bad Request", b""),
    };
    let Ok(mut sessions) = sessions.lock() else {
        return http_response(503, "Service Unavailable", b"");
    };
    let Some(session) = sessions.get_mut(session_id) else {
        return http_response(403, "Forbidden", b"");
    };
    if !session.key_confirmed {
        return http_response(403, "Forbidden", b"");
    }

    let client_msg = match session.transport.open_client_message(&frame) {
        Ok(msg) => msg,
        Err(_) => return http_response(403, "Forbidden", b""),
    };

    let server_response: ServerMessage = match client_msg {
        ClientMessage::InventorySubscribe { .. } => {
            let mut agents = Vec::new();
            if let Some(app) = app {
                if let Some(store) =
                    app.try_state::<crate::modules::harness::session_store::SessionStoreState>()
                {
                    if let Ok(conn) = store.lock_conn() {
                        if let Ok(summaries) =
                            crate::modules::harness::session_store::list_recent_sessions(
                                &conn,
                                voktty_companion_protocol::MAX_INVENTORY_AGENTS,
                            )
                        {
                            let state_map = session_states.lock().ok();
                            for s in summaries {
                                let state = state_map
                                    .as_ref()
                                    .and_then(|m| m.get(&s.id).copied())
                                    .unwrap_or(AgentState::Idle);
                                agents.push(AgentSummary {
                                    agent_id: s.id,
                                    provider: s.harness,
                                    state,
                                    title: s.title,
                                    transcript_cursor: s.updated_at as u64,
                                    capabilities: AgentCapabilities {
                                        can_read: true,
                                        can_send_message: true,
                                        can_approve: true,
                                    },
                                });
                            }
                        }
                    }
                }
            }
            ServerMessage::Inventory {
                protocol: PROTOCOL_VERSION,
                agents,
            }
        }
        ClientMessage::AgentSnapshot { agent_id, .. } => {
            let mut content = "[]".to_string();
            let mut cursor = 0;
            if let Some(app) = app {
                if let Some(store) =
                    app.try_state::<crate::modules::harness::session_store::SessionStoreState>()
                {
                    if let Ok(conn) = store.lock_conn() {
                        if let Ok(Some(record)) =
                            crate::modules::harness::session_store::get_session(&conn, &agent_id)
                        {
                            cursor = record.updated_at as u64;
                            let mut serialized = serde_json::to_string(&record.blocks)
                                .unwrap_or_else(|_| "[]".into());
                            if serialized.len()
                                > voktty_companion_protocol::MAX_TRANSCRIPT_DELTA_BYTES
                            {
                                if let serde_json::Value::Array(blocks) = record.blocks {
                                    let truncated = serde_json::Value::Array(
                                        blocks.into_iter().rev().take(30).rev().collect(),
                                    );
                                    serialized = serde_json::to_string(&truncated)
                                        .unwrap_or_else(|_| "[]".into());
                                }
                            }
                            content = serialized;
                        }
                    }
                }
            }
            ServerMessage::AgentDelta {
                protocol: PROTOCOL_VERSION,
                agent_id,
                cursor,
                content,
            }
        }
        ClientMessage::AgentMessage {
            agent_id, message, ..
        } => {
            if let Some(app) = app {
                use tauri::Emitter;
                let _ = app.emit(
                    "companion:agent-message",
                    serde_json::json!({
                        "sessionId": agent_id,
                        "message": message,
                    }),
                );
            }
            ServerMessage::Pong {
                protocol: PROTOCOL_VERSION,
            }
        }
        ClientMessage::ApprovalRespond {
            agent_id,
            grant_id,
            approved,
            ..
        } => {
            if let Some(app) = app {
                use tauri::Emitter;
                let _ = app.emit(
                    "companion:approval-decision",
                    serde_json::json!({
                        "sessionId": agent_id,
                        "grantId": grant_id,
                        "approved": approved,
                    }),
                );
            }
            ServerMessage::Pong {
                protocol: PROTOCOL_VERSION,
            }
        }
        ClientMessage::Ping { .. } => ServerMessage::Pong {
            protocol: PROTOCOL_VERSION,
        },
        ClientMessage::Revoke { .. } => ServerMessage::Closed {
            protocol: PROTOCOL_VERSION,
            reason: "revoked".to_string(),
        },
    };

    match session.transport.seal_server_message(&server_response) {
        Ok(frame) => json_response(200, "OK", &frame),
        Err(_) => http_response(500, "Internal Server Error", b""),
    }
}

fn handle_session_confirmation_request(
    request: &[u8],
    sessions: &Arc<Mutex<std::collections::HashMap<String, CompanionSession>>>,
) -> Vec<u8> {
    let Some(line_end) = request.windows(2).position(|part| part == b"\r\n") else {
        return http_response(400, "Bad Request", b"");
    };
    let Some(session_id) = std::str::from_utf8(&request[..line_end])
        .ok()
        .and_then(|line| line.strip_prefix("POST /v1/companion/session/"))
        .and_then(|rest| {
            rest.strip_suffix("/confirm HTTP/1.1")
                .or_else(|| rest.strip_suffix("/confirm HTTP/1.0"))
        })
    else {
        return http_response(404, "Not Found", b"");
    };
    let Some(body_start) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
        return http_response(400, "Bad Request", b"");
    };
    let frame = match serde_json::from_slice::<EncryptedFrame>(&request[body_start + 4..]) {
        Ok(frame) => frame,
        Err(_) => return http_response(400, "Bad Request", b""),
    };
    let Ok(mut sessions) = sessions.lock() else {
        return http_response(503, "Service Unavailable", b"");
    };
    let Some(session) = sessions.get_mut(session_id) else {
        return http_response(403, "Forbidden", b"");
    };
    if session.key_confirmed {
        return http_response(409, "Conflict", b"");
    }
    match session.transport.open(&frame) {
        Ok(SessionControl::KeyConfirm { protocol }) if protocol == PROTOCOL_VERSION => {
            match session.transport.seal(&SessionControl::KeyConfirmed {
                protocol: PROTOCOL_VERSION,
            }) {
                Ok(response) => {
                    session.key_confirmed = true;
                    json_response(200, "OK", &response)
                }
                Err(_) => http_response(403, "Forbidden", b""),
            }
        }
        Ok(_) | Err(_) => http_response(403, "Forbidden", b""),
    }
}

fn read_http_request(stream: &mut TcpStream) -> io::Result<Vec<u8>> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                ErrorKind::UnexpectedEof,
                "incomplete HTTP request",
            ));
        }
        if request.len().saturating_add(read) > MAX_REQUEST_BYTES {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                "HTTP request too large",
            ));
        }
        request.extend_from_slice(&chunk[..read]);
        let Some(body_start) = request
            .windows(4)
            .position(|part| part == b"\r\n\r\n")
            .map(|offset| offset + 4)
        else {
            continue;
        };
        let content_length = std::str::from_utf8(&request[..body_start])
            .ok()
            .and_then(|headers| {
                headers.lines().find_map(|line| {
                    line.strip_prefix("Content-Length:")
                        .or_else(|| line.strip_prefix("content-length:"))
                })
            })
            .and_then(|value| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        if request.len() >= body_start.saturating_add(content_length) {
            return Ok(request);
        }
    }
}

fn handle_pairing_request(
    request: &[u8],
    pairing: &Arc<Mutex<Option<PairingRegistry>>>,
) -> Vec<u8> {
    let Some(body_start) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
        return http_response(400, "Bad Request", b"");
    };
    let body = &request[body_start + 4..];
    let request = match serde_json::from_slice::<PairingRequest>(body) {
        Ok(request) => request,
        Err(_) => return http_response(400, "Bad Request", b""),
    };
    let request_id = match random_token(16) {
        Ok(id) => id,
        Err(_) => return http_response(500, "Internal Server Error", b""),
    };
    let result = pairing.lock().ok().and_then(|mut registry| {
        registry
            .as_mut()
            .map(|registry| registry.request(request, now_ms(), request_id))
    });
    match result {
        Some(Ok(pending)) => json_response(
            202,
            "Accepted",
            &serde_json::json!({ "requestId": pending.id }),
        ),
        Some(Err(PairingError::Expired | PairingError::Consumed)) => {
            http_response(410, "Gone", b"")
        }
        Some(Err(_)) => http_response(403, "Forbidden", b""),
        None => http_response(503, "Service Unavailable", b""),
    }
}

fn handle_pairing_status_request(
    request: &[u8],
    pairing: &Arc<Mutex<Option<PairingRegistry>>>,
) -> Vec<u8> {
    let Some(line_end) = request.windows(2).position(|part| part == b"\r\n") else {
        return http_response(400, "Bad Request", b"");
    };
    let Some(path) = std::str::from_utf8(&request[..line_end])
        .ok()
        .and_then(|line| line.strip_prefix("GET /v1/companion/pair/"))
        .and_then(|rest| {
            rest.strip_suffix(" HTTP/1.1")
                .or_else(|| rest.strip_suffix(" HTTP/1.0"))
        })
    else {
        return http_response(400, "Bad Request", b"");
    };
    let result = pairing.lock().ok().and_then(|mut registry| {
        registry
            .as_mut()
            .and_then(|registry| registry.decision(path, now_ms()))
    });
    match result {
        Some(PairingDecision::Pending) => {
            json_response(202, "Accepted", &serde_json::json!({ "status": "pending" }))
        }
        Some(PairingDecision::Approved) => {
            json_response(200, "OK", &serde_json::json!({ "status": "approved" }))
        }
        Some(PairingDecision::Rejected) => json_response(
            403,
            "Forbidden",
            &serde_json::json!({ "status": "rejected" }),
        ),
        Some(PairingDecision::Expired) | None => http_response(410, "Gone", b""),
    }
}

fn http_response(status: u16, reason: &str, body: &[u8]) -> Vec<u8> {
    format!(
        "HTTP/1.1 {status} {reason}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes()
    .into_iter()
    .chain(body.iter().copied())
    .collect()
}

fn json_response<T: Serialize>(status: u16, reason: &str, value: &T) -> Vec<u8> {
    let body = serde_json::to_vec(value).unwrap_or_default();
    let mut response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend(body);
    response
}

fn random_token(bytes: usize) -> Result<String, String> {
    let mut token = vec![0_u8; bytes];
    getrandom::fill(&mut token).map_err(|error| error.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(token))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listener_accepts_only_its_health_probe() {
        let listener = CompanionLoopback::start(
            None,
            Arc::new(Mutex::new(None)),
            Arc::new(Mutex::new(std::collections::HashMap::new())),
            Arc::new(Mutex::new(std::collections::HashMap::new())),
        )
        .expect("listener");
        let mut stream = TcpStream::connect(listener.address()).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("timeout");
        stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .expect("request");
        stream.flush().expect("flush");
        let mut buf = [0_u8; 1024];
        let n = stream.read(&mut buf).expect("read");
        let response = String::from_utf8_lossy(&buf[..n]);
        assert!(response.starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn options_preflight_is_accepted_for_cors() {
        let listener = CompanionLoopback::start(
            None,
            Arc::new(Mutex::new(None)),
            Arc::new(Mutex::new(std::collections::HashMap::new())),
            Arc::new(Mutex::new(std::collections::HashMap::new())),
        )
        .expect("listener");
        let mut stream = TcpStream::connect(listener.address()).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("timeout");
        stream
            .write_all(b"OPTIONS /v1/companion/session/s1/message HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .expect("request");
        stream.flush().expect("flush");
        let mut buf = [0_u8; 1024];
        let n = stream.read(&mut buf).expect("read");
        let response = String::from_utf8_lossy(&buf[..n]);
        assert!(response.starts_with("HTTP/1.1 204"));
    }

    #[test]
    fn detects_lan_ip_without_panicking() {
        let _ = detect_lan_ip();
    }

    #[test]
    fn random_tokens_are_url_safe_and_unique() {
        let first = random_token(32).expect("token");
        let second = random_token(32).expect("token");
        assert_ne!(first, second);
        assert!(first
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
    }
}
