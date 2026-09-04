use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const PROTOCOL_VERSION: u16 = 2;
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
pub const METHOD_HANDSHAKE: &str = "handshake";
pub const METHOD_LIST_DIR: &str = "fs.readDir";
pub const METHOD_READ_FILE: &str = "fs.readFile";
pub const METHOD_READ_BINARY_FILE: &str = "fs.readBinaryFile";
pub const METHOD_WRITE_FILE: &str = "fs.writeFile";
pub const METHOD_STAT: &str = "fs.stat";
pub const METHOD_CREATE_FILE: &str = "fs.createFile";
pub const METHOD_CREATE_DIR: &str = "fs.createDir";
pub const METHOD_RENAME: &str = "fs.rename";
pub const METHOD_DELETE: &str = "fs.delete";
pub const METHOD_GREP: &str = "fs.grep";
pub const METHOD_GREP_CANCEL: &str = "fs.grepCancel";
pub const METHOD_REPLACE_PREVIEW: &str = "fs.replacePreview";
pub const METHOD_REPLACE_APPLY: &str = "fs.replaceApply";
pub const METHOD_WORKSPACE_EDIT_PREVIEW: &str = "fs.workspaceEditPreview";
pub const METHOD_WORKSPACE_EDIT_APPLY: &str = "fs.workspaceEditApply";
pub const METHOD_WATCH_ADD: &str = "fs.watchAdd";
pub const METHOD_WATCH_REMOVE: &str = "fs.watchRemove";
pub const METHOD_PTY_OPEN: &str = "pty.open";
pub const METHOD_PTY_RESIZE: &str = "pty.resize";
pub const METHOD_PTY_CLOSE: &str = "pty.close";
pub const METHOD_PTY_GET_CWD: &str = "pty.getCwd";
pub const METHOD_GIT_EXEC: &str = "git.exec";
pub const REMOTE_SHELL_INTEGRATION_VERSION: &str = "3";

const FRAME_REQUEST: u8 = 1;
const FRAME_RESPONSE: u8 = 2;
const FRAME_PTY_INPUT: u8 = 3;
const FRAME_PTY_OUTPUT: u8 = 4;
const FRAME_PTY_EXIT: u8 = 5;
const FRAME_FS_CHANGED: u8 = 6;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RemoteRequest {
    pub protocol: u16,
    pub id: String,
    pub method: String,
    #[serde(default = "empty_object")]
    pub params: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Frame {
    Request(RemoteRequest),
    Response(RemoteResponse),
    PtyInput { pty_id: u64, data: Vec<u8> },
    PtyOutput { pty_id: u64, data: Vec<u8> },
    PtyExit { pty_id: u64, code: i32 },
    FsChanged(RemoteFsChanged),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RemoteFsChanged {
    pub paths: Vec<String>,
}

pub fn write_frame(writer: &mut impl Write, frame: &Frame) -> io::Result<()> {
    let (kind, payload) = match frame {
        Frame::Request(request) => (FRAME_REQUEST, json_payload(request)?),
        Frame::Response(response) => (FRAME_RESPONSE, json_payload(response)?),
        Frame::PtyInput { pty_id, data } => (FRAME_PTY_INPUT, pty_payload(*pty_id, data)),
        Frame::PtyOutput { pty_id, data } => (FRAME_PTY_OUTPUT, pty_payload(*pty_id, data)),
        Frame::PtyExit { pty_id, code } => {
            let mut payload = Vec::with_capacity(12);
            payload.extend_from_slice(&pty_id.to_be_bytes());
            payload.extend_from_slice(&code.to_be_bytes());
            (FRAME_PTY_EXIT, payload)
        }
        Frame::FsChanged(changed) => (FRAME_FS_CHANGED, json_payload(changed)?),
    };
    let frame_len = payload
        .len()
        .checked_add(1)
        .ok_or_else(|| invalid_data("frame length overflow"))?;
    if frame_len > MAX_FRAME_BYTES {
        return Err(invalid_data("frame exceeds maximum size"));
    }
    let frame_len = u32::try_from(frame_len).map_err(|_| invalid_data("frame is too large"))?;
    writer.write_all(&frame_len.to_be_bytes())?;
    writer.write_all(&[kind])?;
    writer.write_all(&payload)
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Frame>> {
    let mut length = [0u8; 4];
    match reader.read(&mut length[..1])? {
        0 => return Ok(None),
        1 => reader.read_exact(&mut length[1..])?,
        _ => unreachable!(),
    }
    let frame_len = u32::from_be_bytes(length) as usize;
    if frame_len == 0 || frame_len > MAX_FRAME_BYTES {
        return Err(invalid_data("invalid frame length"));
    }
    let mut body = vec![0u8; frame_len];
    reader.read_exact(&mut body)?;
    let (&kind, payload) = body
        .split_first()
        .ok_or_else(|| invalid_data("frame has no type"))?;
    let frame = match kind {
        FRAME_REQUEST => Frame::Request(parse_json(payload)?),
        FRAME_RESPONSE => Frame::Response(parse_json(payload)?),
        FRAME_PTY_INPUT => {
            let (pty_id, data) = parse_pty_payload(payload)?;
            Frame::PtyInput { pty_id, data }
        }
        FRAME_PTY_OUTPUT => {
            let (pty_id, data) = parse_pty_payload(payload)?;
            Frame::PtyOutput { pty_id, data }
        }
        FRAME_PTY_EXIT => {
            if payload.len() != 12 {
                return Err(invalid_data("invalid PTY exit payload"));
            }
            let pty_id = u64::from_be_bytes(payload[..8].try_into().expect("checked length"));
            let code = i32::from_be_bytes(payload[8..].try_into().expect("checked length"));
            Frame::PtyExit { pty_id, code }
        }
        FRAME_FS_CHANGED => Frame::FsChanged(parse_json(payload)?),
        _ => return Err(invalid_data("unknown frame type")),
    };
    Ok(Some(frame))
}

fn json_payload(value: &impl Serialize) -> io::Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|error| invalid_data(error.to_string()))
}

fn parse_json<T: for<'de> Deserialize<'de>>(payload: &[u8]) -> io::Result<T> {
    serde_json::from_slice(payload).map_err(|error| invalid_data(error.to_string()))
}

fn pty_payload(pty_id: u64, data: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(8 + data.len());
    payload.extend_from_slice(&pty_id.to_be_bytes());
    payload.extend_from_slice(data);
    payload
}

fn parse_pty_payload(payload: &[u8]) -> io::Result<(u64, Vec<u8>)> {
    if payload.len() < 8 {
        return Err(invalid_data("invalid PTY data payload"));
    }
    let pty_id = u64::from_be_bytes(payload[..8].try_into().expect("checked length"));
    Ok((pty_id, payload[8..].to_vec()))
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RemoteError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RemoteResponse {
    pub protocol: u16,
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RemoteError>,
}

impl RemoteResponse {
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: impl Into<String>, code: &str, message: impl Into<String>) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: false,
            result: None,
            error: Some(RemoteError {
                code: code.to_string(),
                message: message.into(),
            }),
        }
    }
}

fn empty_object() -> Value {
    json!({})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, ErrorKind};

    #[test]
    fn request_defaults_params_to_an_object() {
        let request: RemoteRequest =
            serde_json::from_str(r#"{"protocol":2,"id":"1","method":"handshake"}"#)
                .expect("request should deserialize");

        assert_eq!(request.params, json!({}));
    }

    #[test]
    fn responses_keep_success_and_failure_disjoint() {
        let success = RemoteResponse::success("1", json!({ "ready": true }));
        assert!(success.ok);
        assert!(success.error.is_none());

        let failure = RemoteResponse::failure("2", "invalid_request", "bad request");
        assert!(!failure.ok);
        assert!(failure.result.is_none());
        assert_eq!(failure.error.expect("error").code, "invalid_request");
    }

    #[test]
    fn framed_messages_round_trip_json_and_raw_pty_bytes() {
        let frames = [
            Frame::Request(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: "request-1".to_string(),
                method: METHOD_HANDSHAKE.to_string(),
                params: json!({ "workspaceRoot": "/srv/app" }),
            }),
            Frame::Response(RemoteResponse::success(
                "request-1",
                json!({ "ready": true }),
            )),
            Frame::PtyInput {
                pty_id: 42,
                data: vec![0, 1, 2, 255],
            },
            Frame::PtyOutput {
                pty_id: 42,
                data: b"hello\r\n".to_vec(),
            },
            Frame::PtyExit {
                pty_id: 42,
                code: 130,
            },
            Frame::FsChanged(RemoteFsChanged {
                paths: vec!["/srv/app/src/main.rs".to_string()],
            }),
        ];

        let mut encoded = Vec::new();
        for frame in &frames {
            write_frame(&mut encoded, frame).expect("frame should encode");
        }

        let mut cursor = Cursor::new(encoded);
        for expected in frames {
            assert_eq!(
                read_frame(&mut cursor).expect("frame should decode"),
                Some(expected)
            );
        }
        assert_eq!(read_frame(&mut cursor).expect("clean eof"), None);
    }

    #[test]
    fn framed_messages_reject_unknown_types_and_oversized_payloads() {
        let mut unknown = Cursor::new([0, 0, 0, 1, 255]);
        assert_eq!(
            read_frame(&mut unknown)
                .expect_err("unknown frame must fail")
                .kind(),
            ErrorKind::InvalidData
        );

        let length = (MAX_FRAME_BYTES as u32 + 1).to_be_bytes();
        let mut oversized = Cursor::new(length);
        assert_eq!(
            read_frame(&mut oversized)
                .expect_err("oversized frame must fail")
                .kind(),
            ErrorKind::InvalidData
        );
    }

    #[test]
    fn framed_messages_reject_truncated_payloads() {
        let mut truncated = Cursor::new([0, 0, 0, 4, 3, 0]);
        assert_eq!(
            read_frame(&mut truncated)
                .expect_err("truncated frame must fail")
                .kind(),
            ErrorKind::UnexpectedEof
        );
    }
}
