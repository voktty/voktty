use serde::{Deserialize, Serialize};
use std::fmt;

/// One hop of a connection. The last hop is the destination; the ones before
/// it are jump hosts, traversed in order.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshNativeHop {
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub identity_file: Option<String>,
}

impl SshNativeHop {
    pub fn port(&self) -> u16 {
        self.port.unwrap_or(22)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshNativeTarget {
    #[serde(flatten)]
    pub destination: SshNativeHop,
    /// Traversed in order before the destination.
    #[serde(default)]
    pub jumps: Vec<SshNativeHop>,
    #[serde(default)]
    pub legacy_algorithms: bool,
}

/// Secrets reach Rust from an interactive prompt and stay in memory for the
/// life of the attempt. Nothing here is ever persisted or logged, and nothing
/// here is ever serialized back towards the webview.
#[derive(Clone, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum SshCredential {
    Agent,
    PrivateKey {
        path: String,
        #[serde(default)]
        passphrase: Option<String>,
    },
    Password {
        secret: String,
    },
}

impl fmt::Debug for SshCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Agent => f.write_str("Agent"),
            Self::PrivateKey { path, passphrase } => f
                .debug_struct("PrivateKey")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "[redacted]"))
                .finish(),
            Self::Password { .. } => f.write_str("Password([redacted])"),
        }
    }
}

/// What the user already decided about this host's key. `None` means only
/// `known_hosts` may vouch for it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum HostKeyApproval {
    #[default]
    None,
    /// Bound to the exact key the user was shown, so a different key presented
    /// on the retry is still refused.
    Approve {
        key_base64: String,
        #[serde(default)]
        remember: bool,
    },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectPhase {
    Connecting,
    VerifyingHost,
    Authenticating,
    Ready,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPrompt {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub key_base64: String,
    pub fingerprint: String,
    pub changed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum SshNativeEvent {
    Phase { phase: ConnectPhase, hop: String },
    Failed { code: SshErrorCode, message: String },
    Ready { session_id: String },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SshErrorCode {
    Unreachable,
    HostKeyUnknown,
    HostKeyChanged,
    HostKeyRevoked,
    AuthFailed,
    /// The file is not valid UTF-8; the caller should read it as bytes.
    BinaryFile,
    /// The server reported the path does not exist. Distinct from any other
    /// refusal: treating a permission error as "missing" would let a write
    /// clobber a file the user cannot read.
    NotFound,
    Timeout,
    Protocol,
    Cancelled,
    Config,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshNativeError {
    pub code: SshErrorCode,
    pub message: String,
    /// Present only for the host key codes, so the UI can show exactly which
    /// key it is asking the user about. Boxed to keep the error small enough to
    /// return by value everywhere.
    pub prompt: Option<Box<HostKeyPrompt>>,
}

impl SshNativeError {
    pub fn new(code: SshErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            prompt: None,
        }
    }

    pub fn host_key(code: SshErrorCode, prompt: HostKeyPrompt) -> Self {
        let message = match code {
            SshErrorCode::HostKeyChanged => {
                format!("host key for {} has changed", prompt.host)
            }
            SshErrorCode::HostKeyRevoked => {
                format!("host key for {} is revoked", prompt.host)
            }
            _ => format!("host key for {} is not known", prompt.host),
        };
        Self {
            code,
            message,
            prompt: Some(Box::new(prompt)),
        }
    }
}

impl fmt::Display for SshNativeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SshNativeError {}

impl From<SshNativeError> for String {
    fn from(value: SshNativeError) -> Self {
        value.message
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_never_print_their_secret() {
        let password = format!(
            "{:?}",
            SshCredential::Password {
                secret: "hunter2".into()
            }
        );
        assert!(!password.contains("hunter2"));

        let key = format!(
            "{:?}",
            SshCredential::PrivateKey {
                path: "/home/u/.ssh/id_ed25519".into(),
                passphrase: Some("s3cret".into()),
            }
        );
        assert!(!key.contains("s3cret"));
        assert!(key.contains("id_ed25519"));
    }

    #[test]
    fn a_hop_defaults_to_port_22() {
        let hop = SshNativeHop {
            host: "example.com".into(),
            ..Default::default()
        };
        assert_eq!(hop.port(), 22);
        assert_eq!(
            SshNativeHop {
                port: Some(2222),
                ..hop
            }
            .port(),
            2222
        );
    }

    #[test]
    fn a_target_deserializes_a_flat_destination_with_jumps() {
        let target: SshNativeTarget = serde_json::from_str(
            r#"{"host":"dest.example","port":2222,"jumps":[{"host":"bastion.example"}]}"#,
        )
        .expect("target parses");
        assert_eq!(target.destination.host, "dest.example");
        assert_eq!(target.destination.port(), 2222);
        assert_eq!(target.jumps.len(), 1);
        assert_eq!(target.jumps[0].port(), 22);
        assert!(!target.legacy_algorithms);
    }

    #[test]
    fn approval_defaults_to_known_hosts_only() {
        assert_eq!(HostKeyApproval::default(), HostKeyApproval::None);
        let approval: HostKeyApproval =
            serde_json::from_str(r#"{"kind":"approve","keyBase64":"AAAA"}"#)
                .expect("approval parses");
        assert_eq!(
            approval,
            HostKeyApproval::Approve {
                key_base64: "AAAA".into(),
                remember: false,
            }
        );
    }
}
