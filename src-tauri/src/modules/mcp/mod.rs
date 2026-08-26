mod http;
pub(crate) mod manager;
mod oauth;
mod protocol;
pub(crate) mod runtime;
mod schema;
mod sse;
mod stdio;

pub use http::{BearerToken, HttpClient, HttpServerConfig};
pub use manager::McpManagerState;
pub use oauth::{
    AuthorizationRequest, OAuthDiscovery, OAuthManager, OAuthTokenSet, OAuthTokenVault,
};
pub use protocol::McpNotification;
pub use stdio::{
    CancellationToken, DiscoveredPrompt, DiscoveredResource, DiscoveredTool, McpError,
    McpErrorKind, ProtocolEra, ServerDescriptor, StdioClient, StdioServerConfig, ToolCallOutcome,
};
