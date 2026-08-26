use std::io::{self, ErrorKind};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tungstenite::handshake::server::ErrorResponse;
use tungstenite::http::header::{HOST, ORIGIN};
use tungstenite::http::{Request, StatusCode};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{accept_hdr_with_config, Error as WebSocketError, Message, WebSocket};
use voktty_collab_protocol::{
    decode_client_control, decode_data_frame, encode_data_frame, encode_server_control,
    Capabilities, ClientControl, DataFrame, ServerControl, PROTOCOL_VERSION,
};

use super::crypto::{SecurePayload, TransportCipher, MAX_SECURE_MESSAGE_BYTES};
use super::files::CitationFiles;
use super::session::{HostedSession, JoinRequest, OutboundMessage, SessionError};

const ACCEPT_POLL: Duration = Duration::from_millis(10);
const IO_POLL: Duration = Duration::from_millis(50);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_CONNECTIONS: usize = 16;
const MAX_JOIN_ATTEMPTS_PER_MINUTE: u16 = 120;
const OUTBOUND_QUEUE: usize = 128;
const MAX_FILE_REQUESTS_PER_MINUTE: u16 = 60;

pub(super) type TerminalInput =
    Arc<dyn Fn(u32, &[u8]) -> Result<(), String> + Send + Sync + 'static>;

pub(super) struct LoopbackServer {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    accept_thread: Option<JoinHandle<()>>,
    session: Arc<HostedSession>,
}

impl LoopbackServer {
    #[allow(dead_code)]
    pub fn start(session: Arc<HostedSession>, terminal_input: TerminalInput) -> io::Result<Self> {
        Self::start_with_files(session, terminal_input, None)
    }

    pub fn start_with_files(
        session: Arc<HostedSession>,
        terminal_input: TerminalInput,
        citation_files: Option<Arc<CitationFiles>>,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop.clone();
        let session_for_thread = session.clone();
        let active_connections = Arc::new(AtomicUsize::new(0));
        let join_attempts = Arc::new(Mutex::new(JoinAttemptLimiter::new(Instant::now())));
        let accept_thread = thread::Builder::new()
            .name(format!("voktty-collab-accept-{}", address.port()))
            .spawn(move || {
                while !stop_for_thread.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((stream, _peer)) => {
                            if active_connections.fetch_add(1, Ordering::AcqRel) >= MAX_CONNECTIONS
                            {
                                active_connections.fetch_sub(1, Ordering::AcqRel);
                                drop(stream);
                                continue;
                            }
                            let session = session_for_thread.clone();
                            let input = terminal_input.clone();
                            let files = citation_files.clone();
                            let connections = active_connections.clone();
                            let connection_guard = connections.clone();
                            let attempts = join_attempts.clone();
                            if let Err(error) = thread::Builder::new()
                                .name("voktty-collab-connection".into())
                                .spawn(move || {
                                    let _guard = ConnectionGuard(connection_guard);
                                    if let Err(error) =
                                        handle_connection(stream, session, input, files, attempts)
                                    {
                                        log::debug!("collaboration connection ended: {error}");
                                    }
                                })
                            {
                                connections.fetch_sub(1, Ordering::AcqRel);
                                log::warn!("collaboration connection worker failed: {error}");
                            }
                        }
                        Err(error) if error.kind() == ErrorKind::WouldBlock => {
                            thread::sleep(ACCEPT_POLL);
                        }
                        Err(error) => {
                            log::warn!("collaboration accept failed: {error}");
                            break;
                        }
                    }
                }
            })?;
        Ok(Self {
            address,
            stop,
            accept_thread: Some(accept_thread),
            session,
        })
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }
}

impl Drop for LoopbackServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.session.close("host_closed");
        if let Some(thread) = self.accept_thread.take() {
            let _ = thread.join();
        }
    }
}

struct ConnectionGuard(Arc<AtomicUsize>);

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[allow(clippy::result_large_err)]
fn handle_connection(
    stream: TcpStream,
    session: Arc<HostedSession>,
    terminal_input: TerminalInput,
    citation_files: Option<Arc<CitationFiles>>,
    join_attempts: Arc<Mutex<JoinAttemptLimiter>>,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(HANDSHAKE_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(HANDSHAKE_TIMEOUT))
        .map_err(|error| error.to_string())?;
    let loopback_port = stream
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let expected_path = format!("/v1/session/{}", session.session_id);
    let config = WebSocketConfig::default()
        .read_buffer_size(16 * 1024)
        .write_buffer_size(0)
        .max_write_buffer_size(2 * MAX_SECURE_MESSAGE_BYTES)
        .max_message_size(Some(MAX_SECURE_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_SECURE_MESSAGE_BYTES));
    let mut socket = accept_hdr_with_config(
        stream,
        move |request: &Request<()>, response| match validate_upgrade_request(
            request,
            &expected_path,
            loopback_port,
        ) {
            Ok(()) => Ok(response),
            Err(status) => Err(rejection_response(status)),
        },
        Some(config),
    )
    .map_err(|error| error.to_string())?;

    socket
        .get_mut()
        .set_write_timeout(Some(HANDSHAKE_TIMEOUT))
        .map_err(|error| error.to_string())?;

    let join_allowed = join_attempts
        .lock()
        .map_err(|_| "collaboration join limiter is unavailable".to_string())?
        .allow(Instant::now());
    if !join_allowed {
        send_plain_error(&mut socket, "rate_limited", "too many join attempts")?;
        return Err("collaboration join rate limit exceeded".to_string());
    }

    let first = read_initial_message(&mut socket)?;
    let join = match first {
        Message::Text(text) => decode_client_control(text.as_bytes()).map_err(|error| {
            let _ = send_plain_error(&mut socket, "invalid_join", &error.to_string());
            error.to_string()
        })?,
        _ => {
            send_plain_error(&mut socket, "join_required", "first message must be join")?;
            return Err("first message was not join".to_string());
        }
    };
    let ClientControl::Join {
        session_id,
        participant_name,
        client_nonce,
        proof,
        resume_after,
        ..
    } = join
    else {
        send_plain_error(&mut socket, "join_required", "first message must be join")?;
        return Err("first control message was not join".to_string());
    };
    if session_id != session.session_id {
        send_plain_error(&mut socket, "authentication_failed", "invitation rejected")?;
        return Err("join session mismatch".to_string());
    }

    let (sender, receiver) = sync_channel(OUTBOUND_QUEUE);
    let accepted = session
        .join(
            JoinRequest {
                participant_name: &participant_name,
                client_nonce: &client_nonce,
                proof: &proof,
                resume_after,
            },
            sender,
        )
        .map_err(|error| {
            let _ = send_plain_error(
                &mut socket,
                session_error_code(error),
                "invitation rejected",
            );
            format!("join rejected: {error:?}")
        })?;
    let participant_id = accepted.participant.id.clone();
    let mut cipher = session
        .transport_cipher(&client_nonce)
        .map_err(|_| "failed to initialize encrypted transport".to_string())?;
    socket
        .get_mut()
        .set_read_timeout(Some(IO_POLL))
        .map_err(|error| error.to_string())?;
    let (cols, rows) = session.dimensions();
    send_secure_control(
        &mut socket,
        &mut cipher,
        &ServerControl::Joined {
            protocol: PROTOCOL_VERSION,
            participant: accepted.participant,
            cols,
            rows,
            capabilities: Capabilities {
                file_citations: citation_files.is_some(),
            },
        },
    )?;
    for frame in accepted.replay {
        send_secure_data(&mut socket, &mut cipher, &frame)?;
    }

    let result = run_joined_connection(
        &mut socket,
        &session,
        &participant_id,
        &receiver,
        &terminal_input,
        citation_files.as_deref(),
        &mut cipher,
    );
    session.leave(&participant_id);
    result
}

fn run_joined_connection(
    socket: &mut WebSocket<TcpStream>,
    session: &HostedSession,
    participant_id: &str,
    receiver: &Receiver<OutboundMessage>,
    terminal_input: &TerminalInput,
    citation_files: Option<&CitationFiles>,
    cipher: &mut TransportCipher,
) -> Result<(), String> {
    let mut last_activity = Instant::now();
    let mut file_limiter = FileRequestLimiter::new(last_activity);
    loop {
        loop {
            match receiver.try_recv() {
                Ok(message) => {
                    let closes = matches!(
                        message,
                        OutboundMessage::Control(ServerControl::Closed { .. })
                    );
                    send_outbound(socket, cipher, &message)?;
                    if closes {
                        return Ok(());
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return Ok(()),
            }
        }

        match socket.read() {
            Ok(Message::Text(text)) => {
                last_activity = Instant::now();
                let _ = text;
                send_secure_error(
                    socket,
                    cipher,
                    "encryption_required",
                    "joined messages must be encrypted",
                )?;
            }
            Ok(Message::Binary(bytes)) => {
                last_activity = Instant::now();
                let payload = cipher
                    .open(&bytes)
                    .map_err(|_| "encrypted collaboration message rejected".to_string())?;
                match payload {
                    SecurePayload::Control(bytes) => match decode_client_control(&bytes) {
                        Ok(ClientControl::Heartbeat { .. }) => {}
                        Ok(ClientControl::RequestControl { .. }) => {
                            if let Err(error) = session.request_control(participant_id) {
                                send_session_error(socket, cipher, error)?;
                            }
                        }
                        Ok(ClientControl::ReleaseControl { .. }) => {
                            if let Err(error) = session.release_control(participant_id) {
                                send_session_error(socket, cipher, error)?;
                            }
                        }
                        Ok(ClientControl::Join { .. }) => {
                            send_secure_error(
                                socket,
                                cipher,
                                "already_joined",
                                "connection already joined",
                            )?;
                        }
                        Ok(ClientControl::FileSearch {
                            request_id,
                            query,
                            limit,
                            ..
                        }) => handle_file_search(
                            socket,
                            cipher,
                            citation_files,
                            &mut file_limiter,
                            request_id,
                            query,
                            limit,
                        )?,
                        Ok(ClientControl::FileRead {
                            request_id, path, ..
                        }) => handle_file_read(
                            socket,
                            cipher,
                            citation_files,
                            &mut file_limiter,
                            request_id,
                            path,
                        )?,
                        Err(error) => send_secure_error(
                            socket,
                            cipher,
                            "invalid_control",
                            &error.to_string(),
                        )?,
                    },
                    SecurePayload::Data(bytes) => match decode_data_frame(&bytes) {
                        Ok(DataFrame::PtyInput { sequence, data }) => {
                            match session.authorize_input(
                                participant_id,
                                sequence,
                                !data.is_empty(),
                            ) {
                                Ok(pty_id) => {
                                    if terminal_input(pty_id, &data).is_err() {
                                        send_secure_error(
                                            socket,
                                            cipher,
                                            "terminal_unavailable",
                                            "terminal unavailable",
                                        )?;
                                    }
                                }
                                Err(error) => send_session_error(socket, cipher, error)?,
                            }
                        }
                        Ok(_) => send_secure_error(
                            socket,
                            cipher,
                            "invalid_frame",
                            "client data frame is not input",
                        )?,
                        Err(error) => {
                            send_secure_error(socket, cipher, "invalid_frame", &error.to_string())?
                        }
                    },
                }
            }
            Ok(Message::Ping(payload)) => {
                last_activity = Instant::now();
                socket
                    .send(Message::Pong(payload))
                    .map_err(|error| error.to_string())?;
            }
            Ok(Message::Pong(_)) => last_activity = Instant::now(),
            Ok(Message::Close(_)) => return Ok(()),
            Ok(Message::Frame(_)) => {}
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                if connection_timed_out(last_activity, Instant::now()) {
                    send_secure_error(socket, cipher, "timeout", "connection timed out")?;
                    return Ok(());
                }
            }
            Err(WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed) => return Ok(()),
            Err(error) => return Err(error.to_string()),
        }
    }
}

struct JoinAttemptLimiter {
    window_started: Instant,
    count: u16,
}

impl JoinAttemptLimiter {
    fn new(now: Instant) -> Self {
        Self {
            window_started: now,
            count: 0,
        }
    }

    fn allow(&mut self, now: Instant) -> bool {
        if now.saturating_duration_since(self.window_started) >= Duration::from_secs(60) {
            self.window_started = now;
            self.count = 0;
        }
        if self.count >= MAX_JOIN_ATTEMPTS_PER_MINUTE {
            return false;
        }
        self.count += 1;
        true
    }
}

struct FileRequestLimiter {
    window_started: Instant,
    count: u16,
}

impl FileRequestLimiter {
    fn new(now: Instant) -> Self {
        Self {
            window_started: now,
            count: 0,
        }
    }

    fn allow(&mut self, now: Instant) -> bool {
        if now.saturating_duration_since(self.window_started) >= Duration::from_secs(60) {
            self.window_started = now;
            self.count = 0;
        }
        if self.count >= MAX_FILE_REQUESTS_PER_MINUTE {
            return false;
        }
        self.count += 1;
        true
    }
}

fn handle_file_search(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    citation_files: Option<&CitationFiles>,
    limiter: &mut FileRequestLimiter,
    request_id: String,
    query: String,
    limit: u16,
) -> Result<(), String> {
    let Some(files) = citation_files else {
        return send_secure_file_error(
            socket,
            cipher,
            request_id,
            "unsupported",
            "file citations are not enabled",
        );
    };
    if !limiter.allow(Instant::now()) {
        return send_secure_file_error(
            socket,
            cipher,
            request_id,
            "rate_limited",
            "too many file citation requests",
        );
    }
    match files.search(&query, limit) {
        Ok(result) => send_secure_control(
            socket,
            cipher,
            &ServerControl::FileSearchResult {
                protocol: PROTOCOL_VERSION,
                request_id,
                files: result.files,
                truncated: result.truncated,
            },
        ),
        Err(error) => send_secure_file_error(socket, cipher, request_id, error.code, error.message),
    }
}

fn handle_file_read(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    citation_files: Option<&CitationFiles>,
    limiter: &mut FileRequestLimiter,
    request_id: String,
    path: String,
) -> Result<(), String> {
    let Some(files) = citation_files else {
        return send_secure_file_error(
            socket,
            cipher,
            request_id,
            "unsupported",
            "file citations are not enabled",
        );
    };
    if !limiter.allow(Instant::now()) {
        return send_secure_file_error(
            socket,
            cipher,
            request_id,
            "rate_limited",
            "too many file citation requests",
        );
    }
    match files.read(&path) {
        Ok(result) => send_secure_control(
            socket,
            cipher,
            &ServerControl::FileContent {
                protocol: PROTOCOL_VERSION,
                request_id,
                path: result.path,
                content: result.content,
                truncated: result.truncated,
            },
        ),
        Err(error) => send_secure_file_error(socket, cipher, request_id, error.code, error.message),
    }
}

fn connection_timed_out(last_activity: Instant, now: Instant) -> bool {
    now.saturating_duration_since(last_activity) >= HEARTBEAT_TIMEOUT
}

fn read_initial_message(socket: &mut WebSocket<TcpStream>) -> Result<Message, String> {
    let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
        match socket.read() {
            Ok(message) => return Ok(message),
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                if Instant::now() >= deadline {
                    return Err("join timed out".to_string());
                }
                thread::sleep(ACCEPT_POLL);
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn validate_upgrade_request(
    request: &Request<()>,
    expected_path: &str,
    loopback_port: u16,
) -> Result<(), StatusCode> {
    if request.uri().path() != expected_path || request.uri().query().is_some() {
        return Err(StatusCode::NOT_FOUND);
    }
    if request.headers().contains_key(ORIGIN) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut host_values = request.headers().get_all(HOST).iter();
    let host = host_values.next().ok_or(StatusCode::BAD_REQUEST)?;
    if host_values.next().is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let host = host.to_str().map_err(|_| StatusCode::BAD_REQUEST)?;
    if allowed_host(host, loopback_port) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

fn allowed_host(value: &str, loopback_port: u16) -> bool {
    let Ok(authority) = value.parse::<tungstenite::http::uri::Authority>() else {
        return false;
    };
    let host = authority.host();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    if loopback {
        return authority.port_u16() == Some(loopback_port);
    }

    let host = host.to_ascii_lowercase();
    let Some(prefix) = host.strip_suffix(".trycloudflare.com") else {
        return false;
    };
    !prefix.is_empty()
        && authority.port_u16().is_none_or(|port| port == 443)
        && prefix.split('.').all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn rejection_response(status: StatusCode) -> ErrorResponse {
    tungstenite::http::Response::builder()
        .status(status)
        .body(Some("request rejected".to_string()))
        .expect("static WebSocket error response")
}

fn send_outbound(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    message: &OutboundMessage,
) -> Result<(), String> {
    match message {
        OutboundMessage::Control(control) => send_secure_control(socket, cipher, control),
        OutboundMessage::Data(frame) => send_secure_data(socket, cipher, frame),
    }
}

fn send_plain_control(
    socket: &mut WebSocket<TcpStream>,
    control: &ServerControl,
) -> Result<(), String> {
    let bytes = encode_server_control(control).map_err(|error| error.to_string())?;
    let text = String::from_utf8(bytes).map_err(|error| error.to_string())?;
    socket
        .send(Message::text(text))
        .map_err(|error| error.to_string())
}

fn send_secure_control(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    control: &ServerControl,
) -> Result<(), String> {
    let bytes = encode_server_control(control).map_err(|error| error.to_string())?;
    let encrypted = cipher
        .seal(SecurePayload::Control(bytes))
        .map_err(|error| error.to_string())?;
    socket
        .send(Message::binary(encrypted))
        .map_err(|error| error.to_string())
}

fn send_secure_data(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    frame: &DataFrame,
) -> Result<(), String> {
    let bytes = encode_data_frame(frame).map_err(|error| error.to_string())?;
    let encrypted = cipher
        .seal(SecurePayload::Data(bytes))
        .map_err(|error| error.to_string())?;
    socket
        .send(Message::binary(encrypted))
        .map_err(|error| error.to_string())
}

fn send_plain_error(
    socket: &mut WebSocket<TcpStream>,
    code: &str,
    message: &str,
) -> Result<(), String> {
    send_plain_control(
        socket,
        &ServerControl::Error {
            protocol: PROTOCOL_VERSION,
            code: code.to_string(),
            message: message.to_string(),
        },
    )
}

fn send_secure_error(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    code: &str,
    message: &str,
) -> Result<(), String> {
    send_secure_control(
        socket,
        cipher,
        &ServerControl::Error {
            protocol: PROTOCOL_VERSION,
            code: code.to_string(),
            message: message.to_string(),
        },
    )
}

fn send_secure_file_error(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    request_id: String,
    code: &str,
    message: &str,
) -> Result<(), String> {
    send_secure_control(
        socket,
        cipher,
        &ServerControl::FileError {
            protocol: PROTOCOL_VERSION,
            request_id,
            code: code.to_string(),
            message: message.to_string(),
        },
    )
}

fn send_session_error(
    socket: &mut WebSocket<TcpStream>,
    cipher: &mut TransportCipher,
    error: SessionError,
) -> Result<(), String> {
    send_secure_error(
        socket,
        cipher,
        session_error_code(error),
        "request rejected",
    )
}

fn session_error_code(error: SessionError) -> &'static str {
    match error {
        SessionError::Authorization => "forbidden",
        SessionError::Banned => "participant_banned",
        SessionError::Closed => "session_closed",
        SessionError::Expired => "session_expired",
        SessionError::InvalidSequence => "invalid_sequence",
        SessionError::MessageTooLarge => "message_too_large",
        SessionError::ParticipantLimit => "participant_limit",
        SessionError::Replay => "replay",
        SessionError::ReplayUnavailable => "replay_unavailable",
        SessionError::Authentication
        | SessionError::InvalidParticipant
        | SessionError::UnknownParticipant => "authentication_failed",
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use tungstenite::{connect, Message};
    use voktty_collab_protocol::{
        decode_data_frame, decode_server_control, encode_client_control, encode_data_frame,
        ClientControl, DataFrame, ParticipantRole, ServerControl, PROTOCOL_VERSION,
    };

    use super::super::auth::{build_join_proof, generate_client_nonce, GeneratedCredentials};
    use super::*;

    fn fixture() -> (Arc<HostedSession>, GeneratedCredentials) {
        let credentials = GeneratedCredentials::generate().expect("credentials");
        let session = Arc::new(HostedSession::new(
            credentials.session_id.clone(),
            9,
            100,
            30,
            credentials.authenticator.clone(),
            Instant::now() + Duration::from_secs(60),
        ));
        (session, credentials)
    }

    fn join_message(
        credentials: &GeneratedCredentials,
        name: &str,
    ) -> (ClientControl, TransportCipher) {
        join_message_after(credentials, name, None)
    }

    fn join_message_after(
        credentials: &GeneratedCredentials,
        name: &str,
        resume_after: Option<u64>,
    ) -> (ClientControl, TransportCipher) {
        let nonce = generate_client_nonce().expect("nonce");
        let proof = build_join_proof(
            &credentials.invite_code,
            &credentials.session_id,
            name,
            &nonce,
            resume_after,
        )
        .expect("proof");
        let cipher =
            TransportCipher::for_guest(&credentials.invite_code, &credentials.session_id, &nonce)
                .expect("guest cipher");
        (
            ClientControl::Join {
                protocol: PROTOCOL_VERSION,
                session_id: credentials.session_id.clone(),
                participant_name: name.to_string(),
                client_nonce: nonce,
                proof,
                resume_after,
            },
            cipher,
        )
    }

    fn read_control(
        socket: &mut tungstenite::WebSocket<
            tungstenite::stream::MaybeTlsStream<std::net::TcpStream>,
        >,
        cipher: &mut TransportCipher,
    ) -> ServerControl {
        let Message::Binary(encrypted) = socket.read().expect("read control") else {
            panic!("expected encrypted control message");
        };
        let SecurePayload::Control(bytes) = cipher.open(&encrypted).expect("decrypt control")
        else {
            panic!("expected control payload");
        };
        decode_server_control(&bytes).expect("decode control")
    }

    fn send_data(
        socket: &mut tungstenite::WebSocket<
            tungstenite::stream::MaybeTlsStream<std::net::TcpStream>,
        >,
        cipher: &mut TransportCipher,
        frame: &DataFrame,
    ) {
        let bytes = encode_data_frame(frame).expect("encode data");
        let encrypted = cipher
            .seal(SecurePayload::Data(bytes))
            .expect("encrypt data");
        socket
            .send(Message::binary(encrypted))
            .expect("send encrypted data");
    }

    fn send_control(
        socket: &mut tungstenite::WebSocket<
            tungstenite::stream::MaybeTlsStream<std::net::TcpStream>,
        >,
        cipher: &mut TransportCipher,
        control: &ClientControl,
    ) {
        let bytes = encode_client_control(control).expect("encode control");
        let encrypted = cipher
            .seal(SecurePayload::Control(bytes))
            .expect("encrypt control");
        socket
            .send(Message::binary(encrypted))
            .expect("send encrypted control");
    }

    fn read_data(
        socket: &mut tungstenite::WebSocket<
            tungstenite::stream::MaybeTlsStream<std::net::TcpStream>,
        >,
        cipher: &mut TransportCipher,
    ) -> DataFrame {
        let Message::Binary(encrypted) = socket.read().expect("read data") else {
            panic!("expected encrypted data message");
        };
        let SecurePayload::Data(bytes) = cipher.open(&encrypted).expect("decrypt data") else {
            panic!("expected data payload");
        };
        decode_data_frame(&bytes).expect("decode data")
    }

    #[test]
    fn server_binds_only_to_loopback_and_accepts_authenticated_join() {
        let (session, credentials) = fixture();
        let server = LoopbackServer::start(session, Arc::new(|_, _| Ok(()))).expect("server");

        assert!(server.address().ip().is_loopback());
        let url = format!(
            "ws://{}/v1/session/{}",
            server.address(),
            credentials.session_id
        );
        let (mut socket, _) = connect(url).expect("connect");
        let (join, mut cipher) = join_message(&credentials, "Ada");
        socket
            .send(Message::text(
                String::from_utf8(encode_client_control(&join).expect("encode join"))
                    .expect("join utf8"),
            ))
            .expect("send join");

        assert!(matches!(
            read_control(&mut socket, &mut cipher),
            ServerControl::Joined { participant, cols: 100, rows: 30, .. }
                if participant.name == "Ada" && participant.role == ParticipantRole::Observer
        ));
    }

    #[test]
    fn authenticated_join_receives_snapshot_before_incremental_output() {
        let (session, credentials) = fixture();
        session.publish_output(b"before").expect("publish before");
        session
            .set_snapshot(1, 100, 30, b"serialized screen")
            .expect("set snapshot");
        session.publish_output(b"after").expect("publish after");
        let server = LoopbackServer::start(session, Arc::new(|_, _| Ok(()))).expect("server");
        let url = format!(
            "ws://{}/v1/session/{}",
            server.address(),
            credentials.session_id
        );
        let (mut socket, _) = connect(url).expect("connect");
        let (join, mut cipher) = join_message(&credentials, "Ada");
        socket
            .send(Message::text(
                String::from_utf8(encode_client_control(&join).expect("encode join"))
                    .expect("join utf8"),
            ))
            .expect("send join");

        assert!(matches!(
            read_control(&mut socket, &mut cipher),
            ServerControl::Joined { .. }
        ));
        assert_eq!(
            read_data(&mut socket, &mut cipher),
            DataFrame::Snapshot {
                sequence: 1,
                cols: 100,
                rows: 30,
                data: b"serialized screen".to_vec(),
            }
        );
        assert_eq!(
            read_data(&mut socket, &mut cipher),
            DataFrame::PtyOutput {
                sequence: 2,
                data: b"after".to_vec(),
            }
        );
    }

    #[test]
    fn authenticated_reconnect_receives_only_the_missing_tail() {
        let (session, credentials) = fixture();
        session.publish_output(b"one").expect("publish one");
        session.publish_output(b"two").expect("publish two");
        session.publish_output(b"three").expect("publish three");
        let server = LoopbackServer::start(session, Arc::new(|_, _| Ok(()))).expect("server");
        let url = format!(
            "ws://{}/v1/session/{}",
            server.address(),
            credentials.session_id
        );
        let (mut socket, _) = connect(url).expect("connect");
        let (join, mut cipher) = join_message_after(&credentials, "Ada", Some(1));
        socket
            .send(Message::text(
                String::from_utf8(encode_client_control(&join).expect("encode join"))
                    .expect("join utf8"),
            ))
            .expect("send join");

        assert!(matches!(
            read_control(&mut socket, &mut cipher),
            ServerControl::Joined { .. }
        ));
        assert!(matches!(
            read_data(&mut socket, &mut cipher),
            DataFrame::PtyOutput { sequence: 2, data } if data == b"two"
        ));
        assert!(matches!(
            read_data(&mut socket, &mut cipher),
            DataFrame::PtyOutput { sequence: 3, data } if data == b"three"
        ));
    }

    #[test]
    fn server_rejects_an_unrelated_websocket_path() {
        let (session, _) = fixture();
        let server = LoopbackServer::start(session, Arc::new(|_, _| Ok(()))).expect("server");

        assert!(connect(format!("ws://{}/not-a-session", server.address())).is_err());
    }

    #[test]
    fn observer_input_is_rejected_but_controller_input_reaches_the_terminal() {
        let (session, credentials) = fixture();
        let writes = Arc::new(AtomicUsize::new(0));
        let writes_for_handler = writes.clone();
        let server = LoopbackServer::start(
            session.clone(),
            Arc::new(move |pty_id, data| {
                assert_eq!(pty_id, 9);
                writes_for_handler.fetch_add(data.len(), Ordering::SeqCst);
                Ok(())
            }),
        )
        .expect("server");
        let url = format!(
            "ws://{}/v1/session/{}",
            server.address(),
            credentials.session_id
        );
        let (mut socket, _) = connect(url).expect("connect");
        let (join, mut cipher) = join_message(&credentials, "Ada");
        socket
            .send(Message::text(
                String::from_utf8(encode_client_control(&join).expect("encode join"))
                    .expect("join utf8"),
            ))
            .expect("send join");
        let ServerControl::Joined { participant, .. } = read_control(&mut socket, &mut cipher)
        else {
            panic!("expected joined");
        };

        let input = DataFrame::PtyInput {
            sequence: 1,
            data: b"whoami\r".to_vec(),
        };
        send_data(&mut socket, &mut cipher, &input);
        assert!(matches!(
            read_control(&mut socket, &mut cipher),
            ServerControl::Error { code, .. } if code == "forbidden"
        ));
        assert_eq!(writes.load(Ordering::SeqCst), 0);

        session
            .set_controller(&participant.id)
            .expect("grant control");
        loop {
            if matches!(
                read_control(&mut socket, &mut cipher),
                ServerControl::RoleChanged { participant_id, role: ParticipantRole::Controller, .. }
                    if participant_id == participant.id
            ) {
                break;
            }
        }
        send_data(&mut socket, &mut cipher, &input);
        for _ in 0..20 {
            if writes.load(Ordering::SeqCst) > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(writes.load(Ordering::SeqCst), b"whoami\r".len());
    }

    #[test]
    fn enabled_file_citations_search_and_read_over_the_encrypted_channel() {
        let (session, credentials) = fixture();
        let root = tempfile::tempdir().expect("root");
        std::fs::write(root.path().join("README.md"), "shared documentation")
            .expect("workspace file");
        let files = Arc::new(CitationFiles::new(root.path()).expect("citation service"));
        let server =
            LoopbackServer::start_with_files(session, Arc::new(|_, _| Ok(())), Some(files))
                .expect("server");
        let url = format!(
            "ws://{}/v1/session/{}",
            server.address(),
            credentials.session_id
        );
        let (mut socket, _) = connect(url).expect("connect");
        let (join, mut cipher) = join_message(&credentials, "Ada");
        socket
            .send(Message::text(
                String::from_utf8(encode_client_control(&join).expect("encode join"))
                    .expect("join utf8"),
            ))
            .expect("send join");

        assert!(matches!(
            read_control(&mut socket, &mut cipher),
            ServerControl::Joined { capabilities, .. } if capabilities.file_citations
        ));
        send_control(
            &mut socket,
            &mut cipher,
            &ClientControl::FileSearch {
                protocol: PROTOCOL_VERSION,
                request_id: "search-1".into(),
                query: "read".into(),
                limit: 20,
            },
        );
        assert!(matches!(
            read_control(&mut socket, &mut cipher),
            ServerControl::FileSearchResult { request_id, files, .. }
                if request_id == "search-1" && files.iter().any(|file| file.path == "README.md")
        ));
        send_control(
            &mut socket,
            &mut cipher,
            &ClientControl::FileRead {
                protocol: PROTOCOL_VERSION,
                request_id: "read-1".into(),
                path: "README.md".into(),
            },
        );
        assert!(matches!(
            read_control(&mut socket, &mut cipher),
            ServerControl::FileContent { request_id, path, content, truncated: false, .. }
                if request_id == "read-1" && path == "README.md" && content == "shared documentation"
        ));
    }

    #[test]
    fn file_request_rate_limit_is_connection_local_and_bounded() {
        let started = Instant::now();
        let mut limiter = FileRequestLimiter::new(started);
        for _ in 0..MAX_FILE_REQUESTS_PER_MINUTE {
            assert!(limiter.allow(started));
        }
        assert!(!limiter.allow(started));
        assert!(limiter.allow(started + Duration::from_secs(60)));
    }

    #[test]
    fn join_attempt_rate_limit_is_session_wide_and_bounded() {
        let started = Instant::now();
        let mut limiter = JoinAttemptLimiter::new(started);
        for _ in 0..MAX_JOIN_ATTEMPTS_PER_MINUTE {
            assert!(limiter.allow(started));
        }
        assert!(!limiter.allow(started));
        assert!(limiter.allow(started + Duration::from_secs(60)));
    }

    #[test]
    fn upgrade_request_accepts_only_expected_hosts_without_browser_origin() {
        let direct = Request::builder()
            .uri("/v1/session/session-1")
            .header(HOST, "127.0.0.1:43125")
            .body(())
            .expect("direct request");
        assert_eq!(
            validate_upgrade_request(&direct, "/v1/session/session-1", 43125),
            Ok(())
        );

        let tunnel = Request::builder()
            .uri("/v1/session/session-1")
            .header(HOST, "quiet-tree.trycloudflare.com")
            .body(())
            .expect("tunnel request");
        assert_eq!(
            validate_upgrade_request(&tunnel, "/v1/session/session-1", 43125),
            Ok(())
        );

        let browser = Request::builder()
            .uri("/v1/session/session-1")
            .header(HOST, "quiet-tree.trycloudflare.com")
            .header(ORIGIN, "https://attacker.example")
            .body(())
            .expect("browser request");
        assert_eq!(
            validate_upgrade_request(&browser, "/v1/session/session-1", 43125),
            Err(StatusCode::FORBIDDEN)
        );

        let foreign_host = Request::builder()
            .uri("/v1/session/session-1")
            .header(HOST, "attacker.example")
            .body(())
            .expect("foreign host request");
        assert_eq!(
            validate_upgrade_request(&foreign_host, "/v1/session/session-1", 43125),
            Err(StatusCode::FORBIDDEN)
        );
    }

    #[test]
    fn heartbeat_timeout_is_testable_without_waiting_in_real_time() {
        let started = Instant::now();

        assert!(!connection_timed_out(
            started,
            started + HEARTBEAT_TIMEOUT - Duration::from_millis(1)
        ));
        assert!(connection_timed_out(started, started + HEARTBEAT_TIMEOUT));
    }
}
