use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use voktty_tool_policy::{conservative_effects, ToolEffect, ToolIdentity, ToolOrigin};

use crate::secrets::{delete_secret, get_secret, set_secret, SecretsState};

use super::{
    AuthorizationRequest, BearerToken, CancellationToken, DiscoveredPrompt, DiscoveredResource,
    DiscoveredTool, HttpClient, HttpServerConfig, McpError, McpErrorKind, OAuthManager,
    OAuthTokenVault, ProtocolEra, ServerDescriptor, StdioClient, StdioServerConfig,
};

const BEARER_SERVICE: &str = "voktty-mcp-bearer";
const MAX_SERVERS: usize = 64;
const MAX_NAME_BYTES: usize = 128;
const MAX_PATH_BYTES: usize = 8 * 1024;
const MAX_ENDPOINT_BYTES: usize = 8 * 1024;
const MAX_ARGS: usize = 128;
const MAX_ARG_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum McpAuthMode {
    None,
    Bearer,
    OAuth,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum McpTransportConfig {
    Stdio {
        executable: String,
        args: Vec<String>,
        cwd: String,
        authorized_root: String,
    },
    Http {
        endpoint: String,
        allow_private_network: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpManagedServerConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub auth_mode: McpAuthMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub oauth_scopes: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub automatic_read_tools: BTreeSet<String>,
    pub transport: McpTransportConfig,
}

impl McpManagedServerConfig {
    fn validate(&self) -> Result<(), McpError> {
        ToolIdentity::new(ToolOrigin::Mcp, &self.id, "server")
            .map_err(|_| configuration_error("invalid MCP server id"))?;
        if self.name.trim() != self.name
            || self.name.is_empty()
            || self.name.len() > MAX_NAME_BYTES
            || self.name.chars().any(char::is_control)
        {
            return Err(configuration_error("invalid MCP server name"));
        }
        if self.automatic_read_tools.len() > 256
            || self
                .automatic_read_tools
                .iter()
                .any(|name| ToolIdentity::new(ToolOrigin::Mcp, &self.id, name).is_err())
        {
            return Err(configuration_error(
                "invalid automatic MCP read tool policy",
            ));
        }
        match &self.transport {
            McpTransportConfig::Stdio {
                executable,
                args,
                cwd,
                authorized_root,
            } => {
                if self.auth_mode != McpAuthMode::None {
                    return Err(configuration_error(
                        "stdio MCP servers cannot use HTTP authorization",
                    ));
                }
                if self.oauth_client_id.is_some() || !self.oauth_scopes.is_empty() {
                    return Err(configuration_error(
                        "stdio MCP servers cannot store OAuth configuration",
                    ));
                }
                validate_path(executable)?;
                validate_path(cwd)?;
                validate_path(authorized_root)?;
                if args.len() > MAX_ARGS
                    || args.iter().any(|argument| {
                        argument.len() > MAX_ARG_BYTES
                            || argument.contains('\0')
                            || argument.chars().any(char::is_control)
                    })
                {
                    return Err(configuration_error("invalid MCP server arguments"));
                }
            }
            McpTransportConfig::Http { endpoint, .. } => {
                if endpoint.is_empty() || endpoint.len() > MAX_ENDPOINT_BYTES {
                    return Err(configuration_error("invalid MCP HTTP endpoint"));
                }
                if self.auth_mode == McpAuthMode::OAuth {
                    let client_id = self.oauth_client_id.as_deref().unwrap_or_default();
                    if client_id.is_empty()
                        || client_id.len() > 1024
                        || client_id.chars().any(char::is_control)
                        || self.oauth_scopes.len() > 32
                        || self.oauth_scopes.iter().any(|scope| {
                            scope.is_empty()
                                || scope.len() > 256
                                || scope.chars().any(char::is_whitespace)
                                || scope.chars().any(char::is_control)
                        })
                    {
                        return Err(configuration_error("invalid MCP OAuth configuration"));
                    }
                } else if self.oauth_client_id.is_some() || !self.oauth_scopes.is_empty() {
                    return Err(configuration_error(
                        "OAuth configuration requires OAuth authorization mode",
                    ));
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum McpConnectionPhase {
    Disabled,
    Disconnected,
    Connecting,
    Connected,
    AuthenticationRequired,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolView {
    pub name: String,
    pub namespaced_name: String,
    pub title: Option<String>,
    pub description: String,
    pub effects: BTreeSet<ToolEffect>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpNamedItemView {
    pub name: String,
    pub title: Option<String>,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    pub id: String,
    pub phase: McpConnectionPhase,
    pub error_kind: Option<McpErrorKind>,
    pub protocol_era: Option<ProtocolEra>,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub capabilities: BTreeSet<String>,
    pub tools: Vec<McpToolView>,
    pub resources: Vec<McpNamedItemView>,
    pub prompts: Vec<McpNamedItemView>,
    pub permissions: BTreeSet<ToolEffect>,
    pub scope: String,
}

#[derive(Clone)]
pub(super) enum ManagedClient {
    Stdio(Arc<StdioClient>),
    Http(Arc<HttpClient>),
}

impl ManagedClient {
    fn strong_count(&self) -> usize {
        match self {
            Self::Stdio(client) => Arc::strong_count(client),
            Self::Http(client) => Arc::strong_count(client),
        }
    }
}

pub(super) struct ManagedServer {
    pub(super) config: McpManagedServerConfig,
    revision: u64,
    phase: McpConnectionPhase,
    error_kind: Option<McpErrorKind>,
    descriptor: Option<ServerDescriptor>,
    tools: Vec<McpToolView>,
    pub(super) discovered_tools: Vec<DiscoveredTool>,
    resources: Vec<McpNamedItemView>,
    prompts: Vec<McpNamedItemView>,
    pub(super) client: Option<ManagedClient>,
    authorization_challenge: Option<String>,
}

impl ManagedServer {
    fn new(config: McpManagedServerConfig) -> Self {
        let phase = if config.enabled {
            McpConnectionPhase::Disconnected
        } else {
            McpConnectionPhase::Disabled
        };
        Self {
            config,
            revision: 1,
            phase,
            error_kind: None,
            descriptor: None,
            tools: Vec::new(),
            discovered_tools: Vec::new(),
            resources: Vec::new(),
            prompts: Vec::new(),
            client: None,
            authorization_challenge: None,
        }
    }

    fn view(&self) -> McpServerView {
        let phase = if self.phase == McpConnectionPhase::Connected
            && self
                .client
                .as_ref()
                .is_none_or(|client| client.strong_count() == 0)
        {
            McpConnectionPhase::Disconnected
        } else {
            self.phase
        };
        let capabilities = self
            .descriptor
            .as_ref()
            .map(|descriptor| capability_names(&descriptor.capabilities))
            .unwrap_or_default();
        let mut permissions = transport_permissions(&self.config.transport);
        for tool in &self.tools {
            permissions.extend(tool.effects.iter().copied());
        }
        let descriptor = self.descriptor.as_ref();
        McpServerView {
            id: self.config.id.clone(),
            phase,
            error_kind: self.error_kind,
            protocol_era: descriptor.map(|value| value.era),
            protocol_version: descriptor.map(|value| value.protocol_version.clone()),
            server_name: descriptor.and_then(|value| value.server_name.clone()),
            server_version: descriptor.and_then(|value| value.server_version.clone()),
            capabilities,
            tools: self.tools.clone(),
            resources: self.resources.clone(),
            prompts: self.prompts.clone(),
            permissions,
            scope: transport_scope(&self.config.transport),
        }
    }
}

#[derive(Default)]
pub struct McpManagerState {
    pub(super) servers: Mutex<BTreeMap<String, ManagedServer>>,
    oauth_flows: Mutex<BTreeMap<String, OAuthFlow>>,
    pub(super) runtime: super::runtime::RuntimeState,
}

impl McpManagerState {
    fn lock(&self) -> Result<MutexGuard<'_, BTreeMap<String, ManagedServer>>, McpError> {
        self.servers
            .lock()
            .map_err(|_| McpError::new(McpErrorKind::Io, "MCP manager state is unavailable"))
    }

    #[cfg(test)]
    pub(crate) fn connected_count(&self) -> usize {
        self.servers
            .lock()
            .map(|servers| {
                servers
                    .values()
                    .filter(|server| {
                        server
                            .client
                            .as_ref()
                            .is_some_and(|client| client.strong_count() > 0)
                    })
                    .count()
            })
            .unwrap_or_default()
    }
}

struct ConnectedServer {
    descriptor: ServerDescriptor,
    tools: Vec<McpToolView>,
    discovered_tools: Vec<DiscoveredTool>,
    resources: Vec<McpNamedItemView>,
    prompts: Vec<McpNamedItemView>,
    client: ManagedClient,
}

struct OAuthFlow {
    revision: u64,
    phase: McpOAuthFlowPhase,
    error_kind: Option<McpErrorKind>,
    cancellation: CancellationToken,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum McpOAuthFlowPhase {
    Pending,
    Completed,
    Error,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthStart {
    pub authorization_url: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthFlowStatus {
    pub phase: McpOAuthFlowPhase,
    pub error_kind: Option<McpErrorKind>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCredentialStatus {
    pub bearer: bool,
    pub oauth: bool,
}

#[tauri::command]
pub fn mcp_upsert_server(
    state: State<'_, McpManagerState>,
    config: McpManagedServerConfig,
) -> Result<McpServerView, McpError> {
    config.validate()?;
    let server_id = config.id.clone();
    let (view, changed) = {
        let mut servers = state.lock()?;
        if !servers.contains_key(&config.id) && servers.len() >= MAX_SERVERS {
            return Err(McpError::resource("MCP server limit reached"));
        }
        let entry = servers
            .entry(config.id.clone())
            .or_insert_with(|| ManagedServer::new(config.clone()));
        let changed = entry.config != config;
        if changed {
            entry.client = None;
            entry.descriptor = None;
            entry.tools.clear();
            entry.discovered_tools.clear();
            entry.resources.clear();
            entry.prompts.clear();
            entry.error_kind = None;
            entry.authorization_challenge = None;
            entry.revision = entry.revision.saturating_add(1);
            entry.config = config;
            entry.phase = if entry.config.enabled {
                McpConnectionPhase::Disconnected
            } else {
                McpConnectionPhase::Disabled
            };
        }
        (entry.view(), changed)
    };
    if changed {
        cancel_oauth_flow(&state, &server_id);
        state.runtime.invalidate_server(&server_id);
    }
    Ok(view)
}

#[tauri::command]
pub fn mcp_list_servers(state: State<'_, McpManagerState>) -> Result<Vec<McpServerView>, McpError> {
    Ok(state.lock()?.values().map(ManagedServer::view).collect())
}

#[tauri::command]
pub async fn mcp_connect_server(
    app: AppHandle,
    secrets: State<'_, SecretsState>,
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<McpServerView, McpError> {
    let (config, revision) = {
        let mut servers = state.lock()?;
        let server = servers
            .get_mut(&server_id)
            .ok_or_else(|| configuration_error("unknown MCP server"))?;
        if !server.config.enabled {
            return Err(configuration_error("MCP server is disabled"));
        }
        server.client = None;
        server.phase = McpConnectionPhase::Connecting;
        server.error_kind = None;
        (server.config.clone(), server.revision)
    };

    let result = match load_authorization(&app, &secrets, &config) {
        Ok(authorization) => connect_config(config, authorization).await,
        Err(error) => Err(error),
    };
    let mut servers = state.lock()?;
    let server = servers
        .get_mut(&server_id)
        .ok_or_else(|| configuration_error("MCP server was removed while connecting"))?;
    if server.revision != revision || !server.config.enabled {
        return Err(McpError::new(
            McpErrorKind::Cancelled,
            "MCP configuration changed while connecting",
        ));
    }
    match result {
        Ok(connected) => {
            server.descriptor = Some(connected.descriptor);
            server.tools = connected.tools;
            server.discovered_tools = connected.discovered_tools;
            server.resources = connected.resources;
            server.prompts = connected.prompts;
            server.client = Some(connected.client);
            server.phase = McpConnectionPhase::Connected;
            server.error_kind = None;
            server.authorization_challenge = None;
        }
        Err(error) => {
            server.client = None;
            server.descriptor = None;
            server.tools.clear();
            server.discovered_tools.clear();
            server.resources.clear();
            server.prompts.clear();
            server.phase = if error.kind == McpErrorKind::Authentication {
                McpConnectionPhase::AuthenticationRequired
            } else {
                McpConnectionPhase::Error
            };
            server.error_kind = Some(error.kind);
            server.authorization_challenge = error.authorization_challenge.clone();
            return Err(observable_error(&error));
        }
    }
    Ok(server.view())
}

#[tauri::command]
pub fn mcp_disconnect_server(
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<McpServerView, McpError> {
    cancel_oauth_flow(&state, &server_id);
    state.runtime.invalidate_server(&server_id);
    let mut servers = state.lock()?;
    let server = servers
        .get_mut(&server_id)
        .ok_or_else(|| configuration_error("unknown MCP server"))?;
    server.client = None;
    server.error_kind = None;
    server.phase = if server.config.enabled {
        McpConnectionPhase::Disconnected
    } else {
        McpConnectionPhase::Disabled
    };
    Ok(server.view())
}

#[tauri::command]
pub async fn mcp_restart_server(
    app: AppHandle,
    secrets: State<'_, SecretsState>,
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<McpServerView, McpError> {
    cancel_oauth_flow(&state, &server_id);
    state.runtime.invalidate_server(&server_id);
    {
        let mut servers = state.lock()?;
        let server = servers
            .get_mut(&server_id)
            .ok_or_else(|| configuration_error("unknown MCP server"))?;
        server.client = None;
        server.phase = McpConnectionPhase::Disconnected;
    }
    mcp_connect_server(app, secrets, state, server_id).await
}

#[tauri::command]
pub fn mcp_remove_server(
    app: AppHandle,
    secrets: State<'_, SecretsState>,
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<(), McpError> {
    validate_server_id(&server_id)?;
    cancel_oauth_flow(&state, &server_id);
    state.runtime.invalidate_server(&server_id);
    revoke_credentials(&app, &secrets, &server_id)?;
    state.lock()?.remove(&server_id);
    Ok(())
}

#[tauri::command]
pub fn mcp_set_bearer_credential(
    app: AppHandle,
    secrets: State<'_, SecretsState>,
    state: State<'_, McpManagerState>,
    server_id: String,
    token: String,
) -> Result<McpCredentialStatus, McpError> {
    validate_server_id(&server_id)?;
    let servers = state.lock()?;
    let server = servers
        .get(&server_id)
        .ok_or_else(|| configuration_error("unknown MCP server"))?;
    if server.config.auth_mode != McpAuthMode::Bearer {
        return Err(configuration_error(
            "MCP server does not use bearer authorization",
        ));
    }
    drop(servers);
    BearerToken::new(token.clone())?;
    set_secret(
        &app,
        &secrets,
        BEARER_SERVICE,
        &bearer_account(&server_id),
        &token,
    )
    .map_err(|_| {
        McpError::new(
            McpErrorKind::Authentication,
            "could not store MCP credential",
        )
    })?;
    credential_status(&app, &secrets, &server_id)
}

#[tauri::command]
pub fn mcp_credential_status(
    app: AppHandle,
    secrets: State<'_, SecretsState>,
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<McpCredentialStatus, McpError> {
    validate_server_id(&server_id)?;
    if !state.lock()?.contains_key(&server_id) {
        return Err(configuration_error("unknown MCP server"));
    }
    credential_status(&app, &secrets, &server_id)
}

#[tauri::command]
pub fn mcp_revoke_credentials(
    app: AppHandle,
    secrets: State<'_, SecretsState>,
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<McpCredentialStatus, McpError> {
    validate_server_id(&server_id)?;
    if !state.lock()?.contains_key(&server_id) {
        return Err(configuration_error("unknown MCP server"));
    }
    cancel_oauth_flow(&state, &server_id);
    state.runtime.invalidate_server(&server_id);
    if let Some(server) = state.lock()?.get_mut(&server_id) {
        server.client = None;
        server.descriptor = None;
        server.tools.clear();
        server.discovered_tools.clear();
        server.resources.clear();
        server.prompts.clear();
        server.authorization_challenge = None;
        server.phase = if server.config.enabled {
            McpConnectionPhase::AuthenticationRequired
        } else {
            McpConnectionPhase::Disabled
        };
        server.error_kind = if server.config.enabled {
            Some(McpErrorKind::Authentication)
        } else {
            None
        };
    }
    revoke_credentials(&app, &secrets, &server_id)?;
    Ok(McpCredentialStatus {
        bearer: false,
        oauth: false,
    })
}

#[tauri::command]
pub async fn mcp_begin_oauth(
    app: AppHandle,
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<McpOAuthStart, McpError> {
    let (endpoint, allow_private_network, challenge, client_id, scopes, revision) = {
        let servers = state.lock()?;
        let server = servers
            .get(&server_id)
            .ok_or_else(|| configuration_error("unknown MCP server"))?;
        if !server.config.enabled || server.config.auth_mode != McpAuthMode::OAuth {
            return Err(configuration_error("MCP OAuth server is not enabled"));
        }
        let McpTransportConfig::Http {
            endpoint,
            allow_private_network,
        } = &server.config.transport
        else {
            return Err(configuration_error("MCP OAuth requires HTTP transport"));
        };
        (
            endpoint.clone(),
            *allow_private_network,
            server.authorization_challenge.clone().ok_or_else(|| {
                McpError::new(
                    McpErrorKind::Authentication,
                    "connect once to obtain the MCP OAuth challenge",
                )
            })?,
            server
                .config
                .oauth_client_id
                .clone()
                .ok_or_else(|| configuration_error("MCP OAuth client id is missing"))?,
            server.config.oauth_scopes.clone(),
            server.revision,
        )
    };

    cancel_oauth_flow(&state, &server_id);
    let oauth = OAuthManager::new(allow_private_network);
    let discovery = oauth.discover(&challenge, &endpoint).await?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| McpError::new(McpErrorKind::Io, "could not bind OAuth callback"))?;
    let port = listener
        .local_addr()
        .map_err(|_| McpError::new(McpErrorKind::Io, "could not inspect OAuth callback"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let request = oauth.start_authorization(&discovery, &client_id, &redirect_uri, &scopes)?;
    let authorization_url = request.url.clone();
    let cancellation = CancellationToken::new();
    state
        .oauth_flows
        .lock()
        .map_err(|_| McpError::new(McpErrorKind::Io, "MCP OAuth state is unavailable"))?
        .insert(
            server_id.clone(),
            OAuthFlow {
                revision,
                phase: McpOAuthFlowPhase::Pending,
                error_kind: None,
                cancellation: cancellation.clone(),
            },
        );

    tauri::async_runtime::spawn(run_oauth_callback(
        app,
        server_id,
        revision,
        allow_private_network,
        listener,
        request,
        cancellation,
    ));
    Ok(McpOAuthStart { authorization_url })
}

#[tauri::command]
pub fn mcp_oauth_flow_status(
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<McpOAuthFlowStatus, McpError> {
    validate_server_id(&server_id)?;
    let flows = state
        .oauth_flows
        .lock()
        .map_err(|_| McpError::new(McpErrorKind::Io, "MCP OAuth state is unavailable"))?;
    let flow = flows
        .get(&server_id)
        .ok_or_else(|| configuration_error("MCP OAuth flow is not active"))?;
    Ok(McpOAuthFlowStatus {
        phase: flow.phase,
        error_kind: flow.error_kind,
    })
}

async fn run_oauth_callback(
    app: AppHandle,
    server_id: String,
    revision: u64,
    allow_private_network: bool,
    listener: tokio::net::TcpListener,
    request: AuthorizationRequest,
    cancellation: CancellationToken,
) {
    let result = tokio::select! {
        _ = cancellation.cancelled() => {
            Err(McpError::new(McpErrorKind::Cancelled, "OAuth flow was cancelled"))
        }
        accepted = tokio::time::timeout(std::time::Duration::from_secs(180), listener.accept()) => {
            match accepted {
                Ok(Ok((mut stream, address))) if address.ip().is_loopback() => {
                    receive_oauth_callback(&mut stream, request, allow_private_network).await
                }
                Ok(Ok(_)) => Err(McpError::new(McpErrorKind::Authentication, "OAuth callback was not loopback")),
                Ok(Err(_)) => Err(McpError::new(McpErrorKind::Io, "OAuth callback failed")),
                Err(_) => Err(McpError::new(McpErrorKind::Timeout, "OAuth callback timed out")),
            }
        }
    };

    let state = app.state::<McpManagerState>();
    let configuration_is_current = state
        .servers
        .lock()
        .ok()
        .and_then(|servers| {
            servers
                .get(&server_id)
                .map(|server| server.revision == revision)
        })
        .unwrap_or(false);
    let mut flows = match state.oauth_flows.lock() {
        Ok(flows) => flows,
        Err(_) => return,
    };
    let Some(flow) = flows.get_mut(&server_id) else {
        return;
    };
    if flow.revision != revision {
        return;
    }
    match result {
        Ok(_) if !configuration_is_current => {
            flow.phase = McpOAuthFlowPhase::Cancelled;
            flow.error_kind = Some(McpErrorKind::Cancelled);
        }
        Ok(tokens) => {
            let secrets = app.state::<SecretsState>();
            match OAuthTokenVault::new(&app, &secrets).save(&server_id, &tokens) {
                Ok(()) => {
                    flow.phase = McpOAuthFlowPhase::Completed;
                    flow.error_kind = None;
                }
                Err(error) => {
                    flow.phase = McpOAuthFlowPhase::Error;
                    flow.error_kind = Some(error.kind);
                }
            }
        }
        Err(error) if error.kind == McpErrorKind::Cancelled => {
            flow.phase = McpOAuthFlowPhase::Cancelled;
            flow.error_kind = Some(error.kind);
        }
        Err(error) => {
            flow.phase = McpOAuthFlowPhase::Error;
            flow.error_kind = Some(error.kind);
        }
    }
}

async fn receive_oauth_callback(
    stream: &mut tokio::net::TcpStream,
    request: AuthorizationRequest,
    allow_private_network: bool,
) -> Result<super::OAuthTokenSet, McpError> {
    const MAX_CALLBACK_BYTES: usize = 16 * 1024;
    let mut bytes = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| McpError::new(McpErrorKind::Io, "OAuth callback could not be read"))?;
        if read == 0 || bytes.len().saturating_add(read) > MAX_CALLBACK_BYTES {
            return Err(McpError::new(
                McpErrorKind::ResourceLimit,
                "OAuth callback exceeded its limit",
            ));
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| McpError::new(McpErrorKind::Authentication, "OAuth callback is invalid"))?;
    let (code, returned_state) = parse_oauth_callback_request(text)?;
    stream
        .write_all(
            b"HTTP/1.1 204 No Content\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        )
        .await
        .map_err(|_| McpError::new(McpErrorKind::Io, "OAuth callback response failed"))?;
    OAuthManager::new(allow_private_network)
        .exchange_code(request, &returned_state, &code)
        .await
}

fn parse_oauth_callback_request(text: &str) -> Result<(String, String), McpError> {
    let target = text
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|line| line.split_once(' ').map(|(target, _)| target))
        .ok_or_else(|| McpError::new(McpErrorKind::Authentication, "OAuth callback is invalid"))?;
    let callback = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| McpError::new(McpErrorKind::Authentication, "OAuth callback is invalid"))?;
    if callback.path() != "/callback" || callback.fragment().is_some() {
        return Err(McpError::new(
            McpErrorKind::Authentication,
            "OAuth callback path is invalid",
        ));
    }
    let mut code = None;
    let mut returned_state = None;
    let mut provider_error = false;
    for (key, value) in callback.query_pairs() {
        match key.as_ref() {
            "code" if code.is_none() => code = Some(value.into_owned()),
            "state" if returned_state.is_none() => returned_state = Some(value.into_owned()),
            "code" | "state" => {
                return Err(McpError::new(
                    McpErrorKind::Authentication,
                    "OAuth callback repeated a security parameter",
                ));
            }
            "error" => provider_error = true,
            _ => {}
        }
    }
    if provider_error {
        return Err(McpError::new(
            McpErrorKind::Authentication,
            "OAuth provider rejected authorization",
        ));
    }
    let code = code.ok_or_else(|| {
        McpError::new(McpErrorKind::Authentication, "OAuth callback omitted code")
    })?;
    let returned_state = returned_state.ok_or_else(|| {
        McpError::new(McpErrorKind::Authentication, "OAuth callback omitted state")
    })?;
    Ok((code, returned_state))
}

fn cancel_oauth_flow(state: &McpManagerState, server_id: &str) {
    if let Ok(mut flows) = state.oauth_flows.lock() {
        if let Some(flow) = flows.remove(server_id) {
            flow.cancellation.cancel();
        }
    }
}

async fn connect_config(
    config: McpManagedServerConfig,
    authorization: Option<BearerToken>,
) -> Result<ConnectedServer, McpError> {
    match config.transport {
        McpTransportConfig::Stdio {
            executable,
            args,
            cwd,
            authorized_root,
        } => {
            let server_id = config.id;
            tauri::async_runtime::spawn_blocking(move || {
                let mut stdio = StdioServerConfig::new(
                    server_id,
                    PathBuf::from(executable),
                    PathBuf::from(cwd),
                    PathBuf::from(authorized_root),
                );
                stdio.args = args;
                let client = Arc::new(StdioClient::connect(stdio)?);
                let descriptor = client.descriptor().clone();
                let discovered_tools = if advertises(&descriptor, "tools") {
                    client.list_tools()?
                } else {
                    Vec::new()
                };
                let tools = summarize_tools(&discovered_tools);
                let resources = if advertises(&descriptor, "resources") {
                    summarize_resources(client.list_resources()?)
                } else {
                    Vec::new()
                };
                let prompts = if advertises(&descriptor, "prompts") {
                    summarize_prompts(client.list_prompts()?)
                } else {
                    Vec::new()
                };
                Ok(ConnectedServer {
                    descriptor,
                    tools,
                    discovered_tools,
                    resources,
                    prompts,
                    client: ManagedClient::Stdio(client),
                })
            })
            .await
            .map_err(|_| McpError::new(McpErrorKind::Io, "MCP stdio worker failed"))?
        }
        McpTransportConfig::Http {
            endpoint,
            allow_private_network,
        } => {
            let mut http = HttpServerConfig::new(config.id, endpoint);
            http.allow_private_network = allow_private_network;
            http.authorization = authorization;
            let client = Arc::new(HttpClient::connect(http).await?);
            let descriptor = client.descriptor().clone();
            let discovered_tools = if advertises(&descriptor, "tools") {
                client.list_tools().await?
            } else {
                Vec::new()
            };
            let tools = summarize_tools(&discovered_tools);
            let resources = if advertises(&descriptor, "resources") {
                summarize_resources(client.list_resources().await?)
            } else {
                Vec::new()
            };
            let prompts = if advertises(&descriptor, "prompts") {
                summarize_prompts(client.list_prompts().await?)
            } else {
                Vec::new()
            };
            Ok(ConnectedServer {
                descriptor,
                tools,
                discovered_tools,
                resources,
                prompts,
                client: ManagedClient::Http(client),
            })
        }
    }
}

fn summarize_tools(tools: &[DiscoveredTool]) -> Vec<McpToolView> {
    tools
        .iter()
        .map(|tool| {
            let annotations = tool
                .annotations
                .clone()
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or_default();
            let effects = conservative_effects(&BTreeSet::from([ToolEffect::Read]), &annotations);
            McpToolView {
                name: tool.identity.name.clone(),
                namespaced_name: tool.identity.namespaced_name.clone(),
                title: tool.title.clone(),
                description: tool.description.clone(),
                effects,
            }
        })
        .collect()
}

fn summarize_resources(resources: Vec<DiscoveredResource>) -> Vec<McpNamedItemView> {
    resources
        .into_iter()
        .map(|resource| McpNamedItemView {
            name: resource.name,
            title: resource.title,
            description: resource.description,
        })
        .collect()
}

fn summarize_prompts(prompts: Vec<DiscoveredPrompt>) -> Vec<McpNamedItemView> {
    prompts
        .into_iter()
        .map(|prompt| McpNamedItemView {
            name: prompt.name,
            title: prompt.title,
            description: prompt.description,
        })
        .collect()
}

fn advertises(descriptor: &ServerDescriptor, capability: &str) -> bool {
    descriptor.capabilities.get(capability).is_some()
}

fn capability_names(value: &Value) -> BTreeSet<String> {
    value
        .as_object()
        .map(|object| {
            object
                .keys()
                .filter(|key| {
                    key.len() <= 64 && key.chars().all(|character| !character.is_control())
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn transport_permissions(transport: &McpTransportConfig) -> BTreeSet<ToolEffect> {
    match transport {
        McpTransportConfig::Stdio { .. } => BTreeSet::from([ToolEffect::Process]),
        McpTransportConfig::Http { .. } => BTreeSet::from([ToolEffect::Network]),
    }
}

fn transport_scope(transport: &McpTransportConfig) -> String {
    match transport {
        McpTransportConfig::Stdio {
            authorized_root, ..
        } => authorized_root.clone(),
        McpTransportConfig::Http { endpoint, .. } => reqwest::Url::parse(endpoint)
            .ok()
            .and_then(|url| {
                let host = url.host_str()?;
                Some(format!(
                    "{}://{}:{}",
                    url.scheme(),
                    host,
                    url.port_or_known_default()?
                ))
            })
            .unwrap_or_else(|| endpoint.clone()),
    }
}

fn load_authorization(
    app: &AppHandle,
    secrets: &SecretsState,
    config: &McpManagedServerConfig,
) -> Result<Option<BearerToken>, McpError> {
    match config.auth_mode {
        McpAuthMode::None => Ok(None),
        McpAuthMode::Bearer => {
            let token = get_secret(app, secrets, BEARER_SERVICE, &bearer_account(&config.id))
                .map_err(|_| {
                    McpError::new(
                        McpErrorKind::Authentication,
                        "could not read MCP credential",
                    )
                })?
                .ok_or_else(|| {
                    McpError::new(
                        McpErrorKind::Authentication,
                        "MCP bearer credential is missing",
                    )
                })?;
            BearerToken::new(token).map(Some)
        }
        McpAuthMode::OAuth => OAuthTokenVault::new(app, secrets)
            .load(&config.id)?
            .map(|tokens| tokens.bearer_token())
            .transpose(),
    }
}

fn credential_status(
    app: &AppHandle,
    secrets: &SecretsState,
    server_id: &str,
) -> Result<McpCredentialStatus, McpError> {
    let bearer = get_secret(app, secrets, BEARER_SERVICE, &bearer_account(server_id))
        .map_err(|_| {
            McpError::new(
                McpErrorKind::Authentication,
                "could not read MCP credential",
            )
        })?
        .is_some();
    let oauth = OAuthTokenVault::new(app, secrets)
        .load(server_id)?
        .is_some();
    Ok(McpCredentialStatus { bearer, oauth })
}

fn revoke_credentials(
    app: &AppHandle,
    secrets: &SecretsState,
    server_id: &str,
) -> Result<(), McpError> {
    delete_secret(app, secrets, BEARER_SERVICE, &bearer_account(server_id)).map_err(|_| {
        McpError::new(
            McpErrorKind::Authentication,
            "could not revoke MCP credential",
        )
    })?;
    OAuthTokenVault::new(app, secrets).delete(server_id)
}

fn validate_server_id(server_id: &str) -> Result<(), McpError> {
    ToolIdentity::new(ToolOrigin::Mcp, server_id, "server")
        .map(|_| ())
        .map_err(|_| configuration_error("invalid MCP server id"))
}

fn bearer_account(server_id: &str) -> String {
    format!("mcp-bearer:{server_id}")
}

fn validate_path(value: &str) -> Result<(), McpError> {
    if value.is_empty()
        || value.len() > MAX_PATH_BYTES
        || value.contains('\0')
        || value.chars().any(char::is_control)
    {
        return Err(configuration_error("invalid MCP path"));
    }
    Ok(())
}

fn configuration_error(message: &str) -> McpError {
    McpError::new(McpErrorKind::Configuration, message)
}

fn observable_error(error: &McpError) -> McpError {
    let message = match error.kind {
        McpErrorKind::Configuration => "MCP configuration is invalid",
        McpErrorKind::Authentication => "MCP authorization is required",
        McpErrorKind::Spawn => "MCP process could not be started",
        McpErrorKind::Io => "MCP server could not be reached",
        McpErrorKind::Protocol => "MCP server returned an invalid response",
        McpErrorKind::Remote => "MCP server rejected the request",
        McpErrorKind::Timeout => "MCP server timed out",
        McpErrorKind::Cancelled => "MCP operation was cancelled",
        McpErrorKind::Busy => "MCP server is busy",
        McpErrorKind::ResourceLimit => "MCP server exceeded a safety limit",
        McpErrorKind::IncompatibleVersion => "MCP protocol version is incompatible",
        McpErrorKind::ProcessExited => "MCP process exited",
    };
    McpError::new(error.kind, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn http_config() -> McpManagedServerConfig {
        McpManagedServerConfig {
            id: "docs".into(),
            name: "Documentation".into(),
            enabled: false,
            auth_mode: McpAuthMode::None,
            oauth_client_id: None,
            oauth_scopes: Vec::new(),
            automatic_read_tools: BTreeSet::new(),
            transport: McpTransportConfig::Http {
                endpoint: "https://mcp.example.test/api".into(),
                allow_private_network: false,
            },
        }
    }

    #[test]
    fn empty_manager_has_no_clients_or_background_work() {
        let state = McpManagerState::default();

        assert_eq!(state.connected_count(), 0);
        assert!(state.servers.lock().unwrap().is_empty());
        assert!(state.oauth_flows.lock().unwrap().is_empty());
    }

    #[test]
    fn config_validation_rejects_credentials_in_stdio_transport() {
        let mut config = http_config();
        config.auth_mode = McpAuthMode::Bearer;
        config.transport = McpTransportConfig::Stdio {
            executable: "node".into(),
            args: Vec::new(),
            cwd: "C:\\workspace".into(),
            authorized_root: "C:\\workspace".into(),
        };

        assert_eq!(
            config.validate().unwrap_err().kind,
            McpErrorKind::Configuration
        );
    }

    #[test]
    fn automatic_read_policy_accepts_only_bounded_exact_tool_names() {
        let mut invalid_name = http_config();
        invalid_name
            .automatic_read_tools
            .insert("line\nbreak".into());
        assert_eq!(
            invalid_name.validate().unwrap_err().kind,
            McpErrorKind::Configuration
        );

        let mut oversized = http_config();
        oversized.automatic_read_tools = (0..257).map(|index| format!("read-{index}")).collect();
        assert_eq!(
            oversized.validate().unwrap_err().kind,
            McpErrorKind::Configuration
        );
    }

    #[test]
    fn observation_never_exposes_schemas_or_raw_annotations() {
        let identity = ToolIdentity::new(ToolOrigin::Mcp, "docs", "remove").unwrap();
        let views = summarize_tools(&[DiscoveredTool {
            identity,
            title: Some("Remove".into()),
            description: "Remove one item".into(),
            input_schema: json!({ "secretSchema": "must-not-escape" }),
            output_schema: Some(json!({ "sensitive": true })),
            annotations: Some(json!({
                "readOnlyHint": false,
                "destructiveHint": true,
                "openWorldHint": true,
                "private": "must-not-escape"
            })),
        }]);
        let encoded = serde_json::to_string(&views).unwrap();

        assert!(views[0].effects.contains(&ToolEffect::Write));
        assert!(views[0].effects.contains(&ToolEffect::Delete));
        assert!(views[0].effects.contains(&ToolEffect::Network));
        assert!(!encoded.contains("must-not-escape"));
        assert!(!encoded.contains("secretSchema"));
    }

    #[test]
    fn observation_never_exposes_resource_uris_or_prompt_arguments() {
        let resources = summarize_resources(vec![DiscoveredResource {
            name: "private-doc".into(),
            title: Some("Private document".into()),
            description: "A bounded summary".into(),
            uri: "file:///secret/workspace/token.txt".into(),
        }]);
        let prompts = summarize_prompts(vec![DiscoveredPrompt {
            name: "review".into(),
            title: None,
            description: "Review selected code".into(),
        }]);
        let encoded = serde_json::to_string(&(resources, prompts)).unwrap();

        assert!(!encoded.contains("file:///"));
        assert!(!encoded.contains("token.txt"));
        assert!(!encoded.contains("arguments"));
    }

    #[test]
    fn observable_errors_strip_challenges_and_remote_content() {
        let raw = McpError::new(McpErrorKind::Remote, "provider-secret-response")
            .with_authorization_challenge(Some("Bearer resource_metadata=secret".into()));
        let observable = observable_error(&raw);
        let encoded = serde_json::to_string(&observable).unwrap();

        assert_eq!(observable.kind, McpErrorKind::Remote);
        assert!(!encoded.contains("provider-secret-response"));
        assert!(!encoded.contains("resource_metadata"));
        assert!(!encoded.contains("authorizationChallenge"));
    }

    #[test]
    fn server_view_reports_only_capability_names_and_bounded_scope() {
        let mut server = ManagedServer::new(http_config());
        server.descriptor = Some(ServerDescriptor {
            era: ProtocolEra::Modern,
            protocol_version: "2026-07-28".into(),
            server_name: Some("fixture".into()),
            server_version: Some("1".into()),
            capabilities: json!({
                "tools": { "listChanged": true, "private": "hidden" },
                "resources": { "payload": "hidden" },
                "prompts": {}
            }),
        });

        let view = server.view();
        let encoded = serde_json::to_string(&view).unwrap();

        assert_eq!(
            view.capabilities,
            BTreeSet::from(["prompts".into(), "resources".into(), "tools".into()])
        );
        assert_eq!(view.scope, "https://mcp.example.test:443");
        assert!(!encoded.contains("private"));
        assert!(!encoded.contains("payload"));
    }

    #[test]
    fn oauth_callback_parser_accepts_only_the_expected_callback_shape() {
        let (code, state) = parse_oauth_callback_request(
            "GET /callback?code=code%2Dvalue&state=state%2Dvalue HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        )
        .unwrap();

        assert_eq!(code, "code-value");
        assert_eq!(state, "state-value");
        for hostile in [
            "POST /callback?code=a&state=b HTTP/1.1\r\n\r\n",
            "GET /other?code=a&state=b HTTP/1.1\r\n\r\n",
            "GET /callback?error=denied&state=b HTTP/1.1\r\n\r\n",
            "GET /callback?code=a HTTP/1.1\r\n\r\n",
            "GET /callback?code=a&code=b&state=c HTTP/1.1\r\n\r\n",
            "GET /callback?code=a&state=b&state=c HTTP/1.1\r\n\r\n",
        ] {
            assert_eq!(
                parse_oauth_callback_request(hostile).unwrap_err().kind,
                McpErrorKind::Authentication
            );
        }
    }
}
