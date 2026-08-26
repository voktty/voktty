use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelType {
    Local,   // Client -> Server (-L)
    Remote,  // Server -> Client (-R)
    Dynamic, // SOCKS5 Proxy (-D)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelConfig {
    pub id: String,
    pub name: String,
    pub tunnel_type: TunnelType,
    pub local_host: Option<String>,
    pub local_port: u16,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    // SSH Target Server
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
    pub extra_args: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelStatus {
    Stopped,
    Connecting,
    Active,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatusEvent {
    pub id: String,
    pub status: TunnelStatus,
    pub error: Option<String>,
    pub started_at: Option<u64>,
}
