//! Versioned, terminal-free contract for the Android companion.
//!
//! This crate deliberately has no PTY, shell, filesystem, Git, or workspace
//! operations. The desktop runtime may only expose agents through the typed
//! inventory and message operations defined here.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;
pub const INVITATION_TTL_SECS: u64 = 120;
pub const MAX_FRAME_BYTES: usize = 256 * 1024;
pub const MAX_DEVICE_NAME_BYTES: usize = 64;
pub const MAX_AGENT_ID_BYTES: usize = 128;
pub const MAX_MESSAGE_BYTES: usize = 32 * 1024;
pub const MAX_INVENTORY_AGENTS: usize = 64;
pub const MAX_TRANSCRIPT_DELTA_BYTES: usize = 128 * 1024;
pub const MAX_ENCRYPTED_FRAME_BYTES: usize = MAX_FRAME_BYTES + 17;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrInvitation {
    pub protocol: u16,
    pub public_url: String,
    pub invitation_id: String,
    pub host_public_key: String,
    pub secret: String,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequest {
    pub protocol: u16,
    pub invitation_id: String,
    pub device_name: String,
    pub device_public_key: String,
    pub proof: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedDevice {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub approved_at_ms: u64,
    pub last_connected_at_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameDirection {
    ClientToHost,
    HostToClient,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedFrame {
    pub protocol: u16,
    pub direction: FrameDirection,
    pub counter: u64,
    pub ciphertext: String,
}

impl EncryptedFrame {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.protocol != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion(self.protocol));
        }
        if self.counter == 0 || self.ciphertext.is_empty() {
            return Err(ProtocolError::InvalidField);
        }
        let maximum_base64_bytes = MAX_ENCRYPTED_FRAME_BYTES.saturating_mul(4).div_ceil(3);
        if self.ciphertext.len() > maximum_base64_bytes {
            return Err(ProtocolError::MessageTooLarge);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SessionControl {
    KeyConfirm { protocol: u16 },
    KeyConfirmed { protocol: u16 },
}

impl SessionControl {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        let protocol = match self {
            Self::KeyConfirm { protocol } | Self::KeyConfirmed { protocol } => *protocol,
        };
        if protocol == PROTOCOL_VERSION {
            Ok(())
        } else {
            Err(ProtocolError::UnsupportedVersion(protocol))
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Working,
    Attention,
    Finished,
    #[default]
    Idle,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub can_read: bool,
    pub can_send_message: bool,
    pub can_approve: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    pub agent_id: String,
    pub provider: String,
    pub state: AgentState,
    pub title: String,
    pub transcript_cursor: u64,
    pub capabilities: AgentCapabilities,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ClientMessage {
    InventorySubscribe {
        protocol: u16,
    },
    AgentSnapshot {
        protocol: u16,
        agent_id: String,
        after: u64,
    },
    AgentMessage {
        protocol: u16,
        agent_id: String,
        message: String,
    },
    ApprovalRespond {
        protocol: u16,
        agent_id: String,
        grant_id: String,
        approved: bool,
    },
    Ping {
        protocol: u16,
    },
    Revoke {
        protocol: u16,
        device_id: String,
    },
}

impl ClientMessage {
    pub fn protocol(&self) -> u16 {
        match self {
            Self::InventorySubscribe { protocol }
            | Self::AgentSnapshot { protocol, .. }
            | Self::AgentMessage { protocol, .. }
            | Self::ApprovalRespond { protocol, .. }
            | Self::Ping { protocol }
            | Self::Revoke { protocol, .. } => *protocol,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.protocol() != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion(self.protocol()));
        }
        match self {
            Self::AgentSnapshot { agent_id, .. }
            | Self::AgentMessage { agent_id, .. }
            | Self::ApprovalRespond { agent_id, .. } => validate_len(agent_id, MAX_AGENT_ID_BYTES),
            _ => Ok(()),
        }?;
        if let Self::AgentMessage { message, .. } = self {
            validate_len(message, MAX_MESSAGE_BYTES)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ServerMessage {
    Inventory {
        protocol: u16,
        agents: Vec<AgentSummary>,
    },
    AgentDelta {
        protocol: u16,
        agent_id: String,
        cursor: u64,
        content: String,
    },
    ApprovalRequest {
        protocol: u16,
        agent_id: String,
        grant_id: String,
        prompt: String,
    },
    Pong {
        protocol: u16,
    },
    Error {
        protocol: u16,
        code: String,
        message: String,
    },
    Closed {
        protocol: u16,
        reason: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    InvalidField,
    MessageTooLarge,
    UnsupportedVersion(u16),
}

fn validate_len(value: &str, maximum: usize) -> Result<(), ProtocolError> {
    if value.is_empty() {
        return Err(ProtocolError::InvalidField);
    }
    if value.len() > maximum {
        return Err(ProtocolError::MessageTooLarge);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_an_unsupported_protocol_before_dispatch() {
        let message = ClientMessage::InventorySubscribe { protocol: 0 };
        assert_eq!(
            message.validate(),
            Err(ProtocolError::UnsupportedVersion(0))
        );
    }

    #[test]
    fn bounds_agent_messages() {
        let message = ClientMessage::AgentMessage {
            protocol: PROTOCOL_VERSION,
            agent_id: "agent-1".to_string(),
            message: "x".repeat(MAX_MESSAGE_BYTES + 1),
        };
        assert_eq!(message.validate(), Err(ProtocolError::MessageTooLarge));
    }

    #[test]
    fn contract_has_no_terminal_or_filesystem_operations() {
        let encoded = serde_json::to_string(&ClientMessage::Ping {
            protocol: PROTOCOL_VERSION,
        })
        .expect("serialize");
        assert_eq!(encoded, r#"{"type":"ping","protocol":1}"#);
    }

    #[test]
    fn encrypted_frames_require_a_protocol_counter_and_bounded_ciphertext() {
        let valid = EncryptedFrame {
            protocol: PROTOCOL_VERSION,
            direction: FrameDirection::ClientToHost,
            counter: 1,
            ciphertext: "ciphertext".to_string(),
        };
        assert_eq!(valid.validate(), Ok(()));
        assert_eq!(
            EncryptedFrame {
                counter: 0,
                ..valid.clone()
            }
            .validate(),
            Err(ProtocolError::InvalidField)
        );
        assert_eq!(
            EncryptedFrame {
                ciphertext: "x".repeat(MAX_ENCRYPTED_FRAME_BYTES.saturating_mul(4).div_ceil(3) + 1),
                ..valid
            }
            .validate(),
            Err(ProtocolError::MessageTooLarge)
        );
    }
}
