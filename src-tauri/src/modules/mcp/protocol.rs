use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_ERROR_MESSAGE_BYTES: usize = 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RpcReply {
    Result(Value),
    Error(RpcError),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpNotification {
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, PartialEq)]
pub enum ServerMessage {
    Response { id: u64, reply: RpcReply },
    Notification(McpNotification),
    Request { id: Value, method: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WireError {
    EmptyMessage,
    MessageTooLarge,
    InvalidUtf8,
    InvalidJson,
    InvalidEnvelope,
    InvalidResponseId,
    InvalidError,
}

#[derive(Default)]
pub struct LineDecoder {
    buffer: Vec<u8>,
}

impl LineDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, WireError> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_MESSAGE_BYTES
            && !bytes.contains(&b'\n')
        {
            return Err(WireError::MessageTooLarge);
        }
        self.buffer.extend_from_slice(bytes);
        let mut messages = Vec::new();
        while let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=position).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                return Err(WireError::EmptyMessage);
            }
            if line.len() > MAX_MESSAGE_BYTES {
                return Err(WireError::MessageTooLarge);
            }
            messages.push(line);
        }
        if self.buffer.len() > MAX_MESSAGE_BYTES {
            return Err(WireError::MessageTooLarge);
        }
        Ok(messages)
    }
}

pub fn parse_server_message(bytes: &[u8]) -> Result<ServerMessage, WireError> {
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(WireError::MessageTooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| WireError::InvalidUtf8)?;
    let value: Value = serde_json::from_str(text).map_err(|_| WireError::InvalidJson)?;
    let object = value.as_object().ok_or(WireError::InvalidEnvelope)?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err(WireError::InvalidEnvelope);
    }

    match (object.get("id"), object.get("method")) {
        (Some(id), Some(method)) => {
            if object.contains_key("result") || object.contains_key("error") {
                return Err(WireError::InvalidEnvelope);
            }
            let method = method.as_str().ok_or(WireError::InvalidEnvelope)?;
            Ok(ServerMessage::Request {
                id: id.clone(),
                method: method.into(),
            })
        }
        (None, Some(method)) => {
            if object.contains_key("result") || object.contains_key("error") {
                return Err(WireError::InvalidEnvelope);
            }
            let method = method.as_str().ok_or(WireError::InvalidEnvelope)?;
            Ok(ServerMessage::Notification(McpNotification {
                method: method.into(),
                params: object.get("params").cloned(),
            }))
        }
        (Some(id), None) => {
            let id = id.as_u64().ok_or(WireError::InvalidResponseId)?;
            match (object.get("result"), object.get("error")) {
                (Some(result), None) if result.is_object() => Ok(ServerMessage::Response {
                    id,
                    reply: RpcReply::Result(result.clone()),
                }),
                (None, Some(error)) => Ok(ServerMessage::Response {
                    id,
                    reply: RpcReply::Error(parse_error(error)?),
                }),
                _ => Err(WireError::InvalidEnvelope),
            }
        }
        (None, None) => Err(WireError::InvalidEnvelope),
    }
}

fn parse_error(value: &Value) -> Result<RpcError, WireError> {
    let object = value.as_object().ok_or(WireError::InvalidError)?;
    let code = object
        .get("code")
        .and_then(Value::as_i64)
        .ok_or(WireError::InvalidError)?;
    let message = object
        .get("message")
        .and_then(Value::as_str)
        .ok_or(WireError::InvalidError)?;
    Ok(RpcError {
        code,
        message: truncate_utf8(message, MAX_ERROR_MESSAGE_BYTES),
        data: object.get("data").cloned(),
    })
}

pub fn request_message(id: u64, method: &str, params: Map<String, Value>) -> Value {
    let mut object = Map::new();
    object.insert("jsonrpc".into(), Value::String("2.0".into()));
    object.insert("id".into(), Value::Number(id.into()));
    object.insert("method".into(), Value::String(method.into()));
    object.insert("params".into(), Value::Object(params));
    Value::Object(object)
}

pub fn notification_message(method: &str, params: Map<String, Value>) -> Value {
    let mut object = Map::new();
    object.insert("jsonrpc".into(), Value::String("2.0".into()));
    object.insert("method".into(), Value::String(method.into()));
    object.insert("params".into(), Value::Object(params));
    Value::Object(object)
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.into();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmented_lines_are_reassembled() {
        let mut decoder = LineDecoder::default();
        assert!(decoder.push(b"{\"json").unwrap().is_empty());
        assert_eq!(
            decoder.push(b"rpc\":\"2.0\"}\n").unwrap(),
            vec![b"{\"jsonrpc\":\"2.0\"}".to_vec()]
        );
    }

    #[test]
    fn oversized_unterminated_line_fails() {
        let mut decoder = LineDecoder::default();
        assert_eq!(
            decoder.push(&vec![b'x'; MAX_MESSAGE_BYTES + 1]),
            Err(WireError::MessageTooLarge)
        );
    }

    #[test]
    fn parses_out_of_order_numeric_responses_independently() {
        let second =
            parse_server_message(br#"{"jsonrpc":"2.0","id":2,"result":{"resultType":"complete"}}"#)
                .unwrap();
        let first =
            parse_server_message(br#"{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete"}}"#)
                .unwrap();

        assert!(matches!(second, ServerMessage::Response { id: 2, .. }));
        assert!(matches!(first, ServerMessage::Response { id: 1, .. }));
    }

    #[test]
    fn rejects_stdout_that_is_not_protocol_json() {
        assert_eq!(
            parse_server_message(b"server started"),
            Err(WireError::InvalidJson)
        );
    }

    #[test]
    fn rejects_null_and_fractional_response_ids() {
        for message in [
            br#"{"jsonrpc":"2.0","id":null,"result":{}}"#.as_slice(),
            br#"{"jsonrpc":"2.0","id":1.5,"result":{}}"#.as_slice(),
        ] {
            assert_eq!(
                parse_server_message(message),
                Err(WireError::InvalidResponseId)
            );
        }
    }
}
