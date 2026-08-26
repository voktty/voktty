use std::error::Error;
use std::fmt;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 4;
pub const MAX_CONTROL_BYTES: usize = 1024 * 1024;
pub const MAX_PTY_DATA_BYTES: usize = 64 * 1024;
pub const MAX_SNAPSHOT_DATA_BYTES: usize = 512 * 1024;
pub const MAX_FILE_CONTENT_BYTES: usize = 512 * 1024;
pub const MAX_FILE_RESULTS: u16 = 200;
pub const MAX_FILE_QUERY_BYTES: usize = 256;
pub const MAX_FILE_PATH_BYTES: usize = 4_096;
pub const MAX_REQUEST_ID_BYTES: usize = 128;
pub const MAX_PARTICIPANTS: usize = 8;
pub const MAX_SESSION_ID_BYTES: usize = 128;
pub const MAX_PARTICIPANT_NAME_BYTES: usize = 64;
pub const MIN_CLIENT_NONCE_BYTES: usize = 16;
pub const MAX_CLIENT_NONCE_BYTES: usize = 128;
pub const MAX_JOIN_PROOF_BYTES: usize = 128;

const FRAME_PTY_INPUT: u8 = 1;
const FRAME_PTY_OUTPUT: u8 = 2;
const FRAME_SNAPSHOT: u8 = 3;
const FRAME_TERMINAL_EXIT: u8 = 4;
const FRAME_TERMINAL_RESIZE: u8 = 5;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Host,
    Controller,
    #[default]
    Observer,
}

impl ParticipantRole {
    pub fn can_write(self) -> bool {
        matches!(self, Self::Host | Self::Controller)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub file_citations: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientControl {
    Join {
        protocol: u16,
        session_id: String,
        participant_name: String,
        client_nonce: String,
        proof: String,
        #[serde(default)]
        resume_after: Option<u64>,
    },
    Heartbeat {
        protocol: u16,
    },
    RequestControl {
        protocol: u16,
    },
    ReleaseControl {
        protocol: u16,
    },
    FileSearch {
        protocol: u16,
        request_id: String,
        query: String,
        limit: u16,
    },
    FileRead {
        protocol: u16,
        request_id: String,
        path: String,
    },
}

impl ClientControl {
    pub fn protocol(&self) -> u16 {
        match self {
            Self::Join { protocol, .. }
            | Self::Heartbeat { protocol }
            | Self::RequestControl { protocol }
            | Self::ReleaseControl { protocol }
            | Self::FileSearch { protocol, .. }
            | Self::FileRead { protocol, .. } => *protocol,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub name: String,
    pub role: ParticipantRole,
    #[serde(default)]
    pub control_requested: bool,
    #[serde(default)]
    pub typing: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ServerControl {
    JoinPending {
        protocol: u16,
        participant_id: String,
    },
    Joined {
        protocol: u16,
        participant: Participant,
        cols: u16,
        rows: u16,
        capabilities: Capabilities,
    },
    ParticipantJoined {
        protocol: u16,
        participant: Participant,
    },
    ParticipantLeft {
        protocol: u16,
        participant_id: String,
    },
    ControlRequested {
        protocol: u16,
        participant_id: String,
    },
    RoleChanged {
        protocol: u16,
        participant_id: String,
        role: ParticipantRole,
    },
    FileSearchResult {
        protocol: u16,
        request_id: String,
        files: Vec<FileMatch>,
        truncated: bool,
    },
    FileContent {
        protocol: u16,
        request_id: String,
        path: String,
        content: String,
        truncated: bool,
    },
    FileError {
        protocol: u16,
        request_id: String,
        code: String,
        message: String,
    },
    Closed {
        protocol: u16,
        reason: String,
    },
    Error {
        protocol: u16,
        code: String,
        message: String,
    },
}

impl ServerControl {
    pub fn protocol(&self) -> u16 {
        match self {
            Self::JoinPending { protocol, .. }
            | Self::Joined { protocol, .. }
            | Self::ParticipantJoined { protocol, .. }
            | Self::ParticipantLeft { protocol, .. }
            | Self::ControlRequested { protocol, .. }
            | Self::RoleChanged { protocol, .. }
            | Self::FileSearchResult { protocol, .. }
            | Self::FileContent { protocol, .. }
            | Self::FileError { protocol, .. }
            | Self::Closed { protocol, .. }
            | Self::Error { protocol, .. } => *protocol,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataFrame {
    PtyInput {
        sequence: u64,
        data: Vec<u8>,
    },
    PtyOutput {
        sequence: u64,
        data: Vec<u8>,
    },
    Snapshot {
        sequence: u64,
        cols: u16,
        rows: u16,
        data: Vec<u8>,
    },
    TerminalResize {
        sequence: u64,
        cols: u16,
        rows: u16,
    },
    TerminalExit {
        sequence: u64,
        code: i32,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    InvalidJson,
    UnsupportedVersion(u16),
    MessageTooLarge,
    MalformedFrame,
    UnknownFrameType(u8),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson => formatter.write_str("invalid control message"),
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported protocol version {version}")
            }
            Self::MessageTooLarge => formatter.write_str("message exceeds maximum size"),
            Self::MalformedFrame => formatter.write_str("malformed data frame"),
            Self::UnknownFrameType(kind) => write!(formatter, "unknown data frame type {kind}"),
        }
    }
}

impl Error for ProtocolError {}

pub fn encode_client_control(message: &ClientControl) -> Result<Vec<u8>, ProtocolError> {
    encode_control(message)
}

pub fn decode_client_control(bytes: &[u8]) -> Result<ClientControl, ProtocolError> {
    let message: ClientControl = decode_control(bytes)?;
    ensure_version(message.protocol())?;
    validate_client_control(&message)?;
    Ok(message)
}

pub fn encode_server_control(message: &ServerControl) -> Result<Vec<u8>, ProtocolError> {
    validate_server_control(message)?;
    encode_control(message)
}

pub fn decode_server_control(bytes: &[u8]) -> Result<ServerControl, ProtocolError> {
    let message: ServerControl = decode_control(bytes)?;
    ensure_version(message.protocol())?;
    validate_server_control(&message)?;
    Ok(message)
}

pub fn encode_data_frame(frame: &DataFrame) -> Result<Vec<u8>, ProtocolError> {
    let mut encoded = Vec::new();
    match frame {
        DataFrame::PtyInput { sequence, data } => {
            validate_pty_data(data)?;
            encoded.push(FRAME_PTY_INPUT);
            encoded.extend_from_slice(&sequence.to_be_bytes());
            encoded.extend_from_slice(data);
        }
        DataFrame::PtyOutput { sequence, data } => {
            validate_pty_data(data)?;
            encoded.push(FRAME_PTY_OUTPUT);
            encoded.extend_from_slice(&sequence.to_be_bytes());
            encoded.extend_from_slice(data);
        }
        DataFrame::Snapshot {
            sequence,
            cols,
            rows,
            data,
        } => {
            validate_snapshot_data(data)?;
            if *cols == 0 || *rows == 0 {
                return Err(ProtocolError::MalformedFrame);
            }
            encoded.push(FRAME_SNAPSHOT);
            encoded.extend_from_slice(&sequence.to_be_bytes());
            encoded.extend_from_slice(&cols.to_be_bytes());
            encoded.extend_from_slice(&rows.to_be_bytes());
            encoded.extend_from_slice(data);
        }
        DataFrame::TerminalResize {
            sequence,
            cols,
            rows,
        } => {
            if *cols == 0 || *rows == 0 {
                return Err(ProtocolError::MalformedFrame);
            }
            encoded.push(FRAME_TERMINAL_RESIZE);
            encoded.extend_from_slice(&sequence.to_be_bytes());
            encoded.extend_from_slice(&cols.to_be_bytes());
            encoded.extend_from_slice(&rows.to_be_bytes());
        }
        DataFrame::TerminalExit { sequence, code } => {
            encoded.push(FRAME_TERMINAL_EXIT);
            encoded.extend_from_slice(&sequence.to_be_bytes());
            encoded.extend_from_slice(&code.to_be_bytes());
        }
    }
    Ok(encoded)
}

pub fn decode_data_frame(bytes: &[u8]) -> Result<DataFrame, ProtocolError> {
    let (&kind, payload) = bytes.split_first().ok_or(ProtocolError::MalformedFrame)?;
    match kind {
        FRAME_PTY_INPUT | FRAME_PTY_OUTPUT => {
            if payload.len() < 8 {
                return Err(ProtocolError::MalformedFrame);
            }
            if payload.len() - 8 > MAX_PTY_DATA_BYTES {
                return Err(ProtocolError::MessageTooLarge);
            }
            let sequence = read_u64(&payload[..8])?;
            let data = payload[8..].to_vec();
            Ok(if kind == FRAME_PTY_INPUT {
                DataFrame::PtyInput { sequence, data }
            } else {
                DataFrame::PtyOutput { sequence, data }
            })
        }
        FRAME_SNAPSHOT => {
            if payload.len() < 12 {
                return Err(ProtocolError::MalformedFrame);
            }
            if payload.len() - 12 > MAX_SNAPSHOT_DATA_BYTES {
                return Err(ProtocolError::MessageTooLarge);
            }
            let sequence = read_u64(&payload[..8])?;
            let cols = read_u16(&payload[8..10])?;
            let rows = read_u16(&payload[10..12])?;
            if cols == 0 || rows == 0 {
                return Err(ProtocolError::MalformedFrame);
            }
            Ok(DataFrame::Snapshot {
                sequence,
                cols,
                rows,
                data: payload[12..].to_vec(),
            })
        }
        FRAME_TERMINAL_EXIT => {
            if payload.len() != 12 {
                return Err(ProtocolError::MalformedFrame);
            }
            let sequence = read_u64(&payload[..8])?;
            let code = i32::from_be_bytes(
                payload[8..]
                    .try_into()
                    .map_err(|_| ProtocolError::MalformedFrame)?,
            );
            Ok(DataFrame::TerminalExit { sequence, code })
        }
        FRAME_TERMINAL_RESIZE => {
            if payload.len() != 12 {
                return Err(ProtocolError::MalformedFrame);
            }
            let sequence = read_u64(&payload[..8])?;
            let cols = read_u16(&payload[8..10])?;
            let rows = read_u16(&payload[10..12])?;
            if cols == 0 || rows == 0 {
                return Err(ProtocolError::MalformedFrame);
            }
            Ok(DataFrame::TerminalResize {
                sequence,
                cols,
                rows,
            })
        }
        _ => Err(ProtocolError::UnknownFrameType(kind)),
    }
}

fn encode_control(message: &impl Serialize) -> Result<Vec<u8>, ProtocolError> {
    let bytes = serde_json::to_vec(message).map_err(|_| ProtocolError::InvalidJson)?;
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    Ok(bytes)
}

fn decode_control<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, ProtocolError> {
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    serde_json::from_slice(bytes).map_err(|_| ProtocolError::InvalidJson)
}

fn ensure_version(version: u16) -> Result<(), ProtocolError> {
    if version == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(ProtocolError::UnsupportedVersion(version))
    }
}

fn validate_client_control(message: &ClientControl) -> Result<(), ProtocolError> {
    match message {
        ClientControl::Join {
            session_id,
            participant_name,
            client_nonce,
            proof,
            ..
        } if session_id.is_empty()
            || session_id.len() > MAX_SESSION_ID_BYTES
            || participant_name.trim().is_empty()
            || participant_name.len() > MAX_PARTICIPANT_NAME_BYTES
            || participant_name.chars().any(char::is_control)
            || client_nonce.len() < MIN_CLIENT_NONCE_BYTES
            || client_nonce.len() > MAX_CLIENT_NONCE_BYTES
            || client_nonce.chars().any(char::is_control)
            || proof.is_empty()
            || proof.len() > MAX_JOIN_PROOF_BYTES
            || proof.chars().any(char::is_control) =>
        {
            Err(ProtocolError::MalformedFrame)
        }
        ClientControl::FileSearch { limit, .. } if *limit == 0 || *limit > MAX_FILE_RESULTS => {
            Err(ProtocolError::MalformedFrame)
        }
        ClientControl::FileSearch {
            request_id, query, ..
        } if !valid_request_id(request_id)
            || query.len() > MAX_FILE_QUERY_BYTES
            || query.chars().any(char::is_control) =>
        {
            Err(ProtocolError::MalformedFrame)
        }
        ClientControl::FileRead {
            request_id, path, ..
        } if !valid_request_id(request_id)
            || path.is_empty()
            || path.len() > MAX_FILE_PATH_BYTES =>
        {
            Err(ProtocolError::MalformedFrame)
        }
        _ => Ok(()),
    }
}

fn validate_server_control(message: &ServerControl) -> Result<(), ProtocolError> {
    match message {
        ServerControl::FileSearchResult { files, .. }
            if files.len() > MAX_FILE_RESULTS as usize =>
        {
            Err(ProtocolError::MessageTooLarge)
        }
        ServerControl::FileContent { content, .. } if content.len() > MAX_FILE_CONTENT_BYTES => {
            Err(ProtocolError::MessageTooLarge)
        }
        ServerControl::FileSearchResult { request_id, .. }
        | ServerControl::FileContent { request_id, .. }
        | ServerControl::FileError { request_id, .. }
            if !valid_request_id(request_id) =>
        {
            Err(ProtocolError::MalformedFrame)
        }
        _ => Ok(()),
    }
}

fn valid_request_id(request_id: &str) -> bool {
    !request_id.is_empty()
        && request_id.len() <= MAX_REQUEST_ID_BYTES
        && !request_id.chars().any(char::is_control)
}

fn validate_pty_data(data: &[u8]) -> Result<(), ProtocolError> {
    if data.len() > MAX_PTY_DATA_BYTES {
        Err(ProtocolError::MessageTooLarge)
    } else {
        Ok(())
    }
}

fn validate_snapshot_data(data: &[u8]) -> Result<(), ProtocolError> {
    if data.len() > MAX_SNAPSHOT_DATA_BYTES {
        Err(ProtocolError::MessageTooLarge)
    } else {
        Ok(())
    }
}

fn read_u64(bytes: &[u8]) -> Result<u64, ProtocolError> {
    Ok(u64::from_be_bytes(
        bytes
            .try_into()
            .map_err(|_| ProtocolError::MalformedFrame)?,
    ))
}

fn read_u16(bytes: &[u8]) -> Result<u16, ProtocolError> {
    Ok(u16::from_be_bytes(
        bytes
            .try_into()
            .map_err(|_| ProtocolError::MalformedFrame)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observer_is_the_only_default_guest_role() {
        assert_eq!(ParticipantRole::default(), ParticipantRole::Observer);
        assert!(!ParticipantRole::Observer.can_write());
        assert!(ParticipantRole::Controller.can_write());
        assert!(ParticipantRole::Host.can_write());
    }

    #[test]
    fn control_messages_round_trip_with_strict_versioning() {
        let message = ClientControl::Join {
            protocol: PROTOCOL_VERSION,
            session_id: "session-1".to_string(),
            participant_name: "Ada".to_string(),
            client_nonce: "nonce-000000000001".to_string(),
            proof: "proof-000000000001".to_string(),
            resume_after: Some(41),
        };

        let encoded = encode_client_control(&message).expect("encode client control");
        assert_eq!(
            decode_client_control(&encoded).expect("decode client control"),
            message
        );

        let incompatible = br#"{"type":"heartbeat","protocol":1}"#;
        assert_eq!(
            decode_client_control(incompatible).expect_err("reject version"),
            ProtocolError::UnsupportedVersion(1)
        );
    }

    #[test]
    fn server_control_fields_match_the_frontend_contract() {
        let message = ServerControl::RoleChanged {
            protocol: PROTOCOL_VERSION,
            participant_id: "guest-1".to_string(),
            role: ParticipantRole::Controller,
        };

        let encoded = encode_server_control(&message).expect("encode role change");
        let json: serde_json::Value =
            serde_json::from_slice(&encoded).expect("decode role change json");

        assert_eq!(json["type"], "role_changed");
        assert_eq!(json["participantId"], "guest-1");
        assert!(json.get("participant_id").is_none());
        assert_eq!(
            decode_server_control(&encoded).expect("round trip role change"),
            message
        );
    }

    #[test]
    fn control_messages_reject_oversized_payloads() {
        let oversized = vec![b'x'; MAX_CONTROL_BYTES + 1];
        assert_eq!(
            decode_client_control(&oversized).expect_err("reject oversized control"),
            ProtocolError::MessageTooLarge
        );
    }

    #[test]
    fn join_fields_reject_controls_and_unbounded_values() {
        let invalid_name = ClientControl::Join {
            protocol: PROTOCOL_VERSION,
            session_id: "session-1".into(),
            participant_name: "Ada\nAdmin".into(),
            client_nonce: "nonce-000000000001".into(),
            proof: "proof-000000000001".into(),
            resume_after: None,
        };
        assert_eq!(
            decode_client_control(&encode_control(&invalid_name).expect("raw encode"))
                .expect_err("control character"),
            ProtocolError::MalformedFrame
        );

        let short_nonce = ClientControl::Join {
            protocol: PROTOCOL_VERSION,
            session_id: "session-1".into(),
            participant_name: "Ada".into(),
            client_nonce: "short".into(),
            proof: "proof-000000000001".into(),
            resume_after: None,
        };
        assert_eq!(
            decode_client_control(&encode_control(&short_nonce).expect("raw encode"))
                .expect_err("short nonce"),
            ProtocolError::MalformedFrame
        );
    }

    #[test]
    fn file_requests_require_bounded_correlation_ids_and_paths() {
        let empty_id = ClientControl::FileSearch {
            protocol: PROTOCOL_VERSION,
            request_id: String::new(),
            query: "src".into(),
            limit: 20,
        };
        assert_eq!(
            decode_client_control(&encode_control(&empty_id).expect("raw encode"))
                .expect_err("empty request id"),
            ProtocolError::MalformedFrame
        );

        let long_path = ClientControl::FileRead {
            protocol: PROTOCOL_VERSION,
            request_id: "read-1".into(),
            path: "x".repeat(MAX_FILE_PATH_BYTES + 1),
        };
        assert_eq!(
            decode_client_control(&encode_control(&long_path).expect("raw encode"))
                .expect_err("long path"),
            ProtocolError::MalformedFrame
        );
    }

    #[test]
    fn terminal_frames_preserve_sequence_and_raw_bytes() {
        let frame = DataFrame::PtyOutput {
            sequence: 42,
            data: vec![0, 1, 2, 255],
        };
        let encoded = encode_data_frame(&frame).expect("encode data frame");
        assert_eq!(
            decode_data_frame(&encoded).expect("decode data frame"),
            frame
        );
    }

    #[test]
    fn terminal_frames_reject_empty_and_oversized_payloads() {
        assert_eq!(
            decode_data_frame(&[]).expect_err("reject empty frame"),
            ProtocolError::MalformedFrame
        );
        let oversized = DataFrame::PtyInput {
            sequence: 1,
            data: vec![0; MAX_PTY_DATA_BYTES + 1],
        };
        assert_eq!(
            encode_data_frame(&oversized).expect_err("reject oversized frame"),
            ProtocolError::MessageTooLarge
        );
    }

    #[test]
    fn snapshots_allow_a_bounded_serialized_terminal() {
        let maximum = DataFrame::Snapshot {
            sequence: 7,
            cols: 120,
            rows: 40,
            data: vec![b'x'; MAX_SNAPSHOT_DATA_BYTES],
        };
        assert_eq!(
            decode_data_frame(&encode_data_frame(&maximum).expect("encode snapshot"))
                .expect("decode snapshot"),
            maximum
        );

        let oversized = DataFrame::Snapshot {
            sequence: 7,
            cols: 120,
            rows: 40,
            data: vec![b'x'; MAX_SNAPSHOT_DATA_BYTES + 1],
        };
        assert_eq!(
            encode_data_frame(&oversized).expect_err("reject oversized snapshot"),
            ProtocolError::MessageTooLarge
        );
    }

    #[test]
    fn terminal_resize_preserves_sequence_and_dimensions() {
        let frame = DataFrame::TerminalResize {
            sequence: 43,
            cols: 132,
            rows: 46,
        };
        assert_eq!(
            decode_data_frame(&encode_data_frame(&frame).expect("encode resize"))
                .expect("decode resize"),
            frame
        );

        let invalid = DataFrame::TerminalResize {
            sequence: 44,
            cols: 0,
            rows: 46,
        };
        assert_eq!(
            encode_data_frame(&invalid).expect_err("reject zero columns"),
            ProtocolError::MalformedFrame
        );
    }

    #[test]
    fn file_content_is_read_only_and_bounded() {
        let response = ServerControl::FileContent {
            protocol: PROTOCOL_VERSION,
            request_id: "request-1".to_string(),
            path: "src/main.rs".to_string(),
            content: "fn main() {}".to_string(),
            truncated: false,
        };
        assert!(encode_server_control(&response).is_ok());

        let oversized = ServerControl::FileContent {
            protocol: PROTOCOL_VERSION,
            request_id: "request-2".to_string(),
            path: "large.txt".to_string(),
            content: "x".repeat(MAX_FILE_CONTENT_BYTES + 1),
            truncated: false,
        };
        assert_eq!(
            encode_server_control(&oversized).expect_err("reject oversized file"),
            ProtocolError::MessageTooLarge
        );
    }
}
