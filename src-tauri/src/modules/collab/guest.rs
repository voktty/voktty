use std::collections::{HashMap, VecDeque};
use std::io::ErrorKind;
use std::net::{IpAddr, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{
    sync_channel, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError,
};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tungstenite::client::connect_with_config;
use tungstenite::protocol::WebSocketConfig;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Error as WebSocketError, Message, WebSocket};
use url::Url;
use voktty_collab_protocol::{
    decode_data_frame, decode_server_control, encode_client_control, encode_data_frame,
    Capabilities, ClientControl, DataFrame, Participant, ServerControl, MAX_PARTICIPANT_NAME_BYTES,
    MAX_PTY_DATA_BYTES, PROTOCOL_VERSION,
};

use super::auth::{build_join_proof, generate_client_nonce};
use super::crypto::{SecurePayload, TransportCipher, MAX_SECURE_MESSAGE_BYTES};

const IO_POLL: Duration = Duration::from_millis(50);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const COMMAND_QUEUE: usize = 128;
const MAX_RECONNECT_ATTEMPTS: u32 = 8;
const GUEST_EVENT_OUTPUT: u8 = 1;
const GUEST_EVENT_SNAPSHOT: u8 = 2;
const GUEST_EVENT_RESIZE: u8 = 3;

type GuestSocket = WebSocket<MaybeTlsStream<TcpStream>>;

pub(super) struct GuestCallbacks {
    pub on_data: Channel<Response>,
    pub on_control: Channel<ServerControl>,
    pub on_exit: Channel<i32>,
    pub on_status: Channel<GuestConnectionStatus>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GuestConnectionStatus {
    Connected,
    Reconnecting,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestWelcome {
    pub connection_id: u64,
    pub participant: Participant,
    pub cols: u16,
    pub rows: u16,
    pub capabilities: Capabilities,
}

enum GuestCommand {
    Input(Vec<u8>),
    Control(ClientControl),
    Close,
}

struct GuestRuntime {
    sender: SyncSender<GuestCommand>,
    worker: Option<JoinHandle<()>>,
}

struct GuestConnectionConfig {
    connection_id: u64,
    connection_url: String,
    session_id: String,
    invite_code: String,
    participant_name: String,
}

struct ConnectedGuest {
    socket: GuestSocket,
    cipher: TransportCipher,
    welcome: GuestWelcome,
}

enum ConnectionEnd {
    UserClosed,
    HostClosed,
    TerminalExit(i32),
    Retryable(String),
    Fatal(String),
}

enum PayloadOutcome {
    Continue,
    HostClosed,
    TerminalExit(i32),
}

impl Drop for GuestRuntime {
    fn drop(&mut self) {
        let _ = self.sender.try_send(GuestCommand::Close);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Default)]
pub struct CollabGuestState {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<u64, GuestRuntime>>,
}

impl CollabGuestState {
    pub fn reserve_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub(super) fn connect(
        &self,
        connection_id: u64,
        connection_url: &str,
        session_id: &str,
        invite_code: &str,
        participant_name: &str,
        callbacks: GuestCallbacks,
    ) -> Result<GuestWelcome, String> {
        let (welcome, runtime) = connect_guest(
            connection_id,
            connection_url,
            session_id,
            invite_code,
            participant_name,
            callbacks,
        )?;
        self.sessions
            .lock()
            .map_err(|_| "collaboration guest state is poisoned".to_string())?
            .insert(connection_id, runtime);
        Ok(welcome)
    }

    pub fn write(&self, connection_id: u64, data: &[u8]) -> Result<(), String> {
        if data.is_empty() {
            return Ok(());
        }
        if data.len() > MAX_PTY_DATA_BYTES {
            return Err("collaboration input exceeds maximum size".to_string());
        }
        self.send(connection_id, GuestCommand::Input(data.to_vec()))
    }

    pub fn request_control(&self, connection_id: u64) -> Result<(), String> {
        self.send(
            connection_id,
            GuestCommand::Control(ClientControl::RequestControl {
                protocol: PROTOCOL_VERSION,
            }),
        )
    }

    pub fn release_control(&self, connection_id: u64) -> Result<(), String> {
        self.send(
            connection_id,
            GuestCommand::Control(ClientControl::ReleaseControl {
                protocol: PROTOCOL_VERSION,
            }),
        )
    }

    pub fn file_search(
        &self,
        connection_id: u64,
        request_id: String,
        query: String,
        limit: u16,
    ) -> Result<(), String> {
        let control = ClientControl::FileSearch {
            protocol: PROTOCOL_VERSION,
            request_id,
            query,
            limit,
        };
        voktty_collab_protocol::encode_client_control(&control)
            .map_err(|error| error.to_string())?;
        self.send(connection_id, GuestCommand::Control(control))
    }

    pub fn file_read(
        &self,
        connection_id: u64,
        request_id: String,
        path: String,
    ) -> Result<(), String> {
        let control = ClientControl::FileRead {
            protocol: PROTOCOL_VERSION,
            request_id,
            path,
        };
        voktty_collab_protocol::encode_client_control(&control)
            .map_err(|error| error.to_string())?;
        self.send(connection_id, GuestCommand::Control(control))
    }

    pub fn close(&self, connection_id: u64) -> Result<bool, String> {
        let runtime = self
            .sessions
            .lock()
            .map_err(|_| "collaboration guest state is poisoned".to_string())?
            .remove(&connection_id);
        let existed = runtime.is_some();
        drop(runtime);
        Ok(existed)
    }

    pub fn stop_all(&self) -> usize {
        let sessions: Vec<GuestRuntime> = self
            .sessions
            .lock()
            .map(|mut sessions| sessions.drain().map(|(_, runtime)| runtime).collect())
            .unwrap_or_default();
        let count = sessions.len();
        drop(sessions);
        count
    }

    fn send(&self, connection_id: u64, command: GuestCommand) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "collaboration guest state is poisoned".to_string())?;
        let runtime = sessions
            .get(&connection_id)
            .ok_or_else(|| "collaboration connection not found".to_string())?;
        runtime
            .sender
            .try_send(command)
            .map_err(|error| match error {
                TrySendError::Full(_) => "collaboration command queue is full".to_string(),
                TrySendError::Disconnected(_) => "collaboration connection is closed".to_string(),
            })
    }
}

fn connect_guest(
    connection_id: u64,
    connection_url: &str,
    session_id: &str,
    invite_code: &str,
    participant_name: &str,
    callbacks: GuestCallbacks,
) -> Result<(GuestWelcome, GuestRuntime), String> {
    let name = participant_name.trim();
    if name.is_empty()
        || name.len() > MAX_PARTICIPANT_NAME_BYTES
        || name.chars().any(char::is_control)
    {
        return Err(
            "participant name must be printable and contain between 1 and 64 bytes".to_string(),
        );
    }
    let config = GuestConnectionConfig {
        connection_id,
        connection_url: connection_url.to_string(),
        session_id: session_id.to_string(),
        invite_code: invite_code.to_string(),
        participant_name: name.to_string(),
    };
    let connected = open_guest_socket(&config, None)?;
    let welcome = connected.welcome.clone();
    let (sender, receiver) = sync_channel(COMMAND_QUEUE);
    let worker = thread::Builder::new()
        .name(format!("voktty-collab-guest-{connection_id}"))
        .spawn(move || run_guest(connected, config, receiver, callbacks))
        .map_err(|error| format!("could not start collaboration connection: {error}"))?;
    Ok((
        welcome,
        GuestRuntime {
            sender,
            worker: Some(worker),
        },
    ))
}

fn open_guest_socket(
    config: &GuestConnectionConfig,
    resume_after: Option<u64>,
) -> Result<ConnectedGuest, String> {
    validate_connection_url(&config.connection_url, &config.session_id)?;
    let client_nonce = generate_client_nonce().map_err(|error| error.to_string())?;
    let proof = build_join_proof(
        &config.invite_code,
        &config.session_id,
        &config.participant_name,
        &client_nonce,
        resume_after,
    )
    .map_err(|_| "invalid invitation code".to_string())?;
    let mut cipher =
        TransportCipher::for_guest(&config.invite_code, &config.session_id, &client_nonce)
            .map_err(|_| "invalid invitation code".to_string())?;
    let socket_config = WebSocketConfig::default()
        .read_buffer_size(16 * 1024)
        .write_buffer_size(0)
        .max_write_buffer_size(2 * MAX_SECURE_MESSAGE_BYTES)
        .max_message_size(Some(MAX_SECURE_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_SECURE_MESSAGE_BYTES));
    let (mut socket, _) = connect_with_config(&config.connection_url, Some(socket_config), 0)
        .map_err(|_| "could not connect to the collaboration host".to_string())?;
    set_socket_timeout(&mut socket, HANDSHAKE_TIMEOUT)?;
    let join = ClientControl::Join {
        protocol: PROTOCOL_VERSION,
        session_id: config.session_id.clone(),
        participant_name: config.participant_name.clone(),
        client_nonce,
        proof,
        resume_after,
    };
    let join = encode_client_control(&join).map_err(|error| error.to_string())?;
    let join = String::from_utf8(join).map_err(|_| "invalid join message".to_string())?;
    socket
        .send(Message::text(join))
        .map_err(|_| "could not authenticate with the collaboration host".to_string())?;

    let control = read_initial_control(&mut socket, &mut cipher)?;
    let ServerControl::Joined {
        participant,
        cols,
        rows,
        capabilities,
        ..
    } = control
    else {
        return Err("collaboration invitation was rejected".to_string());
    };
    set_socket_timeout(&mut socket, IO_POLL)?;
    let welcome = GuestWelcome {
        connection_id: config.connection_id,
        participant,
        cols,
        rows,
        capabilities,
    };
    Ok(ConnectedGuest {
        socket,
        cipher,
        welcome,
    })
}

fn run_guest(
    mut connected: ConnectedGuest,
    config: GuestConnectionConfig,
    receiver: Receiver<GuestCommand>,
    callbacks: GuestCallbacks,
) {
    let mut output_sequence = 0_u64;
    let mut pending = VecDeque::new();
    let exit_code = loop {
        match run_connected_guest(
            &mut connected.socket,
            &mut connected.cipher,
            &receiver,
            &mut pending,
            &callbacks,
            &mut output_sequence,
        ) {
            ConnectionEnd::UserClosed | ConnectionEnd::HostClosed => break -1,
            ConnectionEnd::TerminalExit(code) => break code,
            ConnectionEnd::Fatal(error) => {
                log::debug!("collaboration guest connection rejected: {error}");
                let _ = callbacks.on_status.send(GuestConnectionStatus::Failed);
                break -1;
            }
            ConnectionEnd::Retryable(error) => {
                log::debug!("collaboration guest connection interrupted: {error}");
                let _ = callbacks
                    .on_status
                    .send(GuestConnectionStatus::Reconnecting);
            }
        }

        let mut reconnected = None;
        for attempt in 0..MAX_RECONNECT_ATTEMPTS {
            if !wait_for_reconnect(&receiver, &mut pending, reconnect_delay(attempt)) {
                break;
            }
            match open_guest_socket(&config, Some(output_sequence)) {
                Ok(next) => {
                    let joined = ServerControl::Joined {
                        protocol: PROTOCOL_VERSION,
                        participant: next.welcome.participant.clone(),
                        cols: next.welcome.cols,
                        rows: next.welcome.rows,
                        capabilities: next.welcome.capabilities.clone(),
                    };
                    if callbacks.on_control.send(joined).is_err() {
                        break;
                    }
                    let _ = callbacks.on_status.send(GuestConnectionStatus::Connected);
                    reconnected = Some(next);
                    break;
                }
                Err(error) => {
                    log::debug!("collaboration reconnect attempt failed: {error}");
                }
            }
        }
        let Some(next) = reconnected else {
            let _ = callbacks.on_status.send(GuestConnectionStatus::Failed);
            break -1;
        };
        connected = next;
    };
    let _ = callbacks.on_exit.send(exit_code);
}

fn run_connected_guest(
    socket: &mut GuestSocket,
    cipher: &mut TransportCipher,
    receiver: &Receiver<GuestCommand>,
    pending: &mut VecDeque<GuestCommand>,
    callbacks: &GuestCallbacks,
    output_sequence: &mut u64,
) -> ConnectionEnd {
    let mut input_sequence = 0_u64;
    let mut last_heartbeat = Instant::now();
    loop {
        loop {
            let command = pending.pop_front().map_or_else(|| receiver.try_recv(), Ok);
            match command {
                Ok(GuestCommand::Input(data)) => {
                    let Some(sequence) = input_sequence.checked_add(1) else {
                        return ConnectionEnd::Fatal(
                            "collaboration input sequence exhausted".to_string(),
                        );
                    };
                    input_sequence = sequence;
                    let frame = DataFrame::PtyInput { sequence, data };
                    if let Err(error) = send_data(socket, cipher, &frame) {
                        return ConnectionEnd::Retryable(error);
                    }
                }
                Ok(GuestCommand::Control(control)) => {
                    if let Err(error) = send_control(socket, cipher, &control) {
                        return ConnectionEnd::Retryable(error);
                    }
                }
                Ok(GuestCommand::Close) | Err(TryRecvError::Disconnected) => {
                    let _ = socket.close(None);
                    return ConnectionEnd::UserClosed;
                }
                Err(TryRecvError::Empty) => break,
            }
        }

        if last_heartbeat.elapsed() >= HEARTBEAT_INTERVAL {
            let heartbeat = ClientControl::Heartbeat {
                protocol: PROTOCOL_VERSION,
            };
            if let Err(error) = send_control(socket, cipher, &heartbeat) {
                return ConnectionEnd::Retryable(error);
            }
            last_heartbeat = Instant::now();
        }

        match socket.read() {
            Ok(Message::Binary(encrypted)) => {
                let payload = match cipher.open(&encrypted) {
                    Ok(payload) => payload,
                    Err(_) => {
                        return ConnectionEnd::Fatal(
                            "encrypted collaboration message rejected".to_string(),
                        )
                    }
                };
                match handle_payload(payload, callbacks, output_sequence) {
                    Ok(PayloadOutcome::Continue) => {}
                    Ok(PayloadOutcome::HostClosed) => return ConnectionEnd::HostClosed,
                    Ok(PayloadOutcome::TerminalExit(code)) => {
                        return ConnectionEnd::TerminalExit(code)
                    }
                    Err(error) => return ConnectionEnd::Fatal(error),
                }
            }
            Ok(Message::Ping(payload)) => {
                if socket.send(Message::Pong(payload)).is_err() {
                    return ConnectionEnd::Retryable("collaboration connection closed".to_string());
                }
            }
            Ok(Message::Pong(_) | Message::Frame(_)) => {}
            Ok(Message::Close(_)) => {
                return ConnectionEnd::Retryable("collaboration connection closed".to_string())
            }
            Ok(Message::Text(_)) => {
                return ConnectionEnd::Fatal(
                    "host sent an unencrypted collaboration message".to_string(),
                );
            }
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed) => {
                return ConnectionEnd::Retryable("collaboration connection closed".to_string())
            }
            Err(_) => {
                return ConnectionEnd::Retryable("collaboration connection failed".to_string())
            }
        }
    }
}

fn wait_for_reconnect(
    receiver: &Receiver<GuestCommand>,
    pending: &mut VecDeque<GuestCommand>,
    delay: Duration,
) -> bool {
    let deadline = Instant::now() + delay;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return true;
        }
        match receiver.recv_timeout(remaining.min(IO_POLL)) {
            Ok(GuestCommand::Close) | Err(RecvTimeoutError::Disconnected) => return false,
            Ok(command) => pending.push_back(command),
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

fn reconnect_delay(attempt: u32) -> Duration {
    Duration::from_millis((250_u64.saturating_mul(1_u64 << attempt.min(4))).min(4_000))
}

fn handle_payload(
    payload: SecurePayload,
    callbacks: &GuestCallbacks,
    output_sequence: &mut u64,
) -> Result<PayloadOutcome, String> {
    match payload {
        SecurePayload::Control(bytes) => {
            let control = decode_server_control(&bytes).map_err(|error| error.to_string())?;
            let closes = matches!(control, ServerControl::Closed { .. });
            callbacks
                .on_control
                .send(control)
                .map_err(|_| "collaboration control channel closed".to_string())?;
            Ok(if closes {
                PayloadOutcome::HostClosed
            } else {
                PayloadOutcome::Continue
            })
        }
        SecurePayload::Data(bytes) => match decode_data_frame(&bytes)
            .map_err(|error| error.to_string())?
        {
            DataFrame::PtyOutput { sequence, data } => {
                accept_output_sequence(output_sequence, sequence)?;
                callbacks
                    .on_data
                    .send(Response::new(encode_guest_output(data)))
                    .map_err(|_| "collaboration data channel closed".to_string())?;
                Ok(PayloadOutcome::Continue)
            }
            DataFrame::Snapshot {
                sequence,
                cols,
                rows,
                data,
            } => {
                accept_snapshot_sequence(output_sequence, sequence)?;
                callbacks
                    .on_data
                    .send(Response::new(encode_guest_snapshot(cols, rows, data)))
                    .map_err(|_| "collaboration data channel closed".to_string())?;
                Ok(PayloadOutcome::Continue)
            }
            DataFrame::TerminalResize {
                sequence,
                cols,
                rows,
            } => {
                accept_output_sequence(output_sequence, sequence)?;
                callbacks
                    .on_data
                    .send(Response::new(encode_guest_resize(cols, rows)))
                    .map_err(|_| "collaboration data channel closed".to_string())?;
                Ok(PayloadOutcome::Continue)
            }
            DataFrame::TerminalExit { sequence, code } => {
                accept_output_sequence(output_sequence, sequence)?;
                Ok(PayloadOutcome::TerminalExit(code))
            }
            DataFrame::PtyInput { .. } => Err("host sent an invalid terminal frame".to_string()),
        },
    }
}

fn encode_guest_output(data: Vec<u8>) -> Vec<u8> {
    let mut event = Vec::with_capacity(data.len() + 1);
    event.push(GUEST_EVENT_OUTPUT);
    event.extend_from_slice(&data);
    event
}

fn encode_guest_snapshot(cols: u16, rows: u16, data: Vec<u8>) -> Vec<u8> {
    let mut event = Vec::with_capacity(data.len() + 7);
    event.push(GUEST_EVENT_SNAPSHOT);
    event.extend_from_slice(&cols.to_be_bytes());
    event.extend_from_slice(&rows.to_be_bytes());
    event.extend_from_slice(b"\x1bc");
    event.extend_from_slice(&data);
    event
}

fn encode_guest_resize(cols: u16, rows: u16) -> Vec<u8> {
    let mut event = Vec::with_capacity(5);
    event.push(GUEST_EVENT_RESIZE);
    event.extend_from_slice(&cols.to_be_bytes());
    event.extend_from_slice(&rows.to_be_bytes());
    event
}

fn accept_output_sequence(current: &mut u64, sequence: u64) -> Result<(), String> {
    if sequence != current.saturating_add(1) {
        return Err("invalid collaboration output sequence".to_string());
    }
    *current = sequence;
    Ok(())
}

fn accept_snapshot_sequence(current: &mut u64, sequence: u64) -> Result<(), String> {
    if sequence < *current {
        return Err("invalid collaboration snapshot sequence".to_string());
    }
    *current = sequence;
    Ok(())
}

fn send_control(
    socket: &mut GuestSocket,
    cipher: &mut TransportCipher,
    control: &ClientControl,
) -> Result<(), String> {
    let bytes = encode_client_control(control).map_err(|error| error.to_string())?;
    let encrypted = cipher
        .seal(SecurePayload::Control(bytes))
        .map_err(|error| error.to_string())?;
    socket
        .send(Message::binary(encrypted))
        .map_err(|_| "collaboration connection closed".to_string())
}

fn send_data(
    socket: &mut GuestSocket,
    cipher: &mut TransportCipher,
    frame: &DataFrame,
) -> Result<(), String> {
    let bytes = encode_data_frame(frame).map_err(|error| error.to_string())?;
    let encrypted = cipher
        .seal(SecurePayload::Data(bytes))
        .map_err(|error| error.to_string())?;
    socket
        .send(Message::binary(encrypted))
        .map_err(|_| "collaboration connection closed".to_string())
}

fn read_initial_control(
    socket: &mut GuestSocket,
    cipher: &mut TransportCipher,
) -> Result<ServerControl, String> {
    match socket.read() {
        Ok(Message::Binary(encrypted)) => {
            let SecurePayload::Control(bytes) = cipher
                .open(&encrypted)
                .map_err(|_| "encrypted collaboration handshake rejected".to_string())?
            else {
                return Err("invalid collaboration handshake".to_string());
            };
            decode_server_control(&bytes).map_err(|error| error.to_string())
        }
        Ok(Message::Text(text)) => {
            let control = decode_server_control(text.as_bytes())
                .map_err(|_| "collaboration invitation was rejected".to_string())?;
            match control {
                ServerControl::Error { .. } => {
                    Err("collaboration invitation was rejected".to_string())
                }
                _ => Err("host sent an unencrypted collaboration handshake".to_string()),
            }
        }
        _ => Err("invalid collaboration handshake".to_string()),
    }
}

fn set_socket_timeout(socket: &mut GuestSocket, timeout: Duration) -> Result<(), String> {
    #[allow(unreachable_patterns)]
    let stream = match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => &mut stream.sock,
        _ => return Err("unsupported collaboration TLS backend".to_string()),
    };
    stream
        .set_read_timeout(Some(timeout))
        .and_then(|_| stream.set_write_timeout(Some(timeout)))
        .map_err(|error| format!("could not configure collaboration socket: {error}"))
}

fn validate_connection_url(connection_url: &str, session_id: &str) -> Result<(), String> {
    let url = Url::parse(connection_url).map_err(|_| "invalid collaboration URL".to_string())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("collaboration URL cannot contain credentials, query, or fragment".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "collaboration URL requires a host".to_string())?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    if url.scheme() != "wss" && !(url.scheme() == "ws" && loopback) {
        return Err("public collaboration URLs must use wss".to_string());
    }
    let expected_path = format!("/v1/session/{session_id}");
    if url.path() != expected_path {
        return Err("collaboration URL does not match the session".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "MDEyMzQ1Njc4OWFiY2RlZg";

    #[test]
    fn public_connections_require_wss_and_the_exact_session_path() {
        assert!(validate_connection_url(
            &format!("wss://example.trycloudflare.com/v1/session/{SESSION}"),
            SESSION,
        )
        .is_ok());
        assert!(validate_connection_url(
            &format!("ws://example.trycloudflare.com/v1/session/{SESSION}"),
            SESSION,
        )
        .is_err());
        assert!(validate_connection_url(
            "wss://example.trycloudflare.com/v1/session/another",
            SESSION,
        )
        .is_err());
    }

    #[test]
    fn loopback_ws_is_allowed_for_local_testing_only() {
        assert!(validate_connection_url(
            &format!("ws://127.0.0.1:43125/v1/session/{SESSION}"),
            SESSION,
        )
        .is_ok());
        assert!(validate_connection_url(
            &format!("ws://localhost:43125/v1/session/{SESSION}"),
            SESSION,
        )
        .is_ok());
    }

    #[test]
    fn connection_urls_reject_credentials_queries_and_fragments() {
        for url in [
            format!("wss://user:pass@example.com/v1/session/{SESSION}"),
            format!("wss://example.com/v1/session/{SESSION}?code=secret"),
            format!("wss://example.com/v1/session/{SESSION}#secret"),
        ] {
            assert!(validate_connection_url(&url, SESSION).is_err(), "{url}");
        }
    }

    #[test]
    fn an_empty_initial_snapshot_can_start_at_sequence_zero() {
        let mut sequence = 0;
        accept_snapshot_sequence(&mut sequence, 0).expect("accept initial snapshot");
        accept_output_sequence(&mut sequence, 1).expect("accept first output");
        assert_eq!(sequence, 1);
    }

    #[test]
    fn output_sequences_must_be_contiguous() {
        let mut sequence = 4;
        assert!(accept_output_sequence(&mut sequence, 5).is_ok());
        assert!(accept_output_sequence(&mut sequence, 7).is_err());
        assert_eq!(sequence, 5);
    }

    #[test]
    fn reconnect_backoff_is_bounded() {
        assert_eq!(reconnect_delay(0), Duration::from_millis(250));
        assert_eq!(reconnect_delay(4), Duration::from_secs(4));
        assert_eq!(reconnect_delay(20), Duration::from_secs(4));
    }

    #[test]
    fn guest_events_keep_grid_metadata_with_snapshot_data() {
        assert_eq!(encode_guest_output(vec![1, 2]), vec![1, 1, 2]);
        assert_eq!(
            encode_guest_resize(120, 40),
            vec![GUEST_EVENT_RESIZE, 0, 120, 0, 40]
        );
        assert_eq!(
            encode_guest_snapshot(120, 40, b"screen".to_vec()),
            [
                vec![GUEST_EVENT_SNAPSHOT, 0, 120, 0, 40],
                b"\x1bcscreen".to_vec(),
            ]
            .concat()
        );
    }
}
