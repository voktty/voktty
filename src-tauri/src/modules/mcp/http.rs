use std::collections::{BTreeSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, LOCATION, WWW_AUTHENTICATE};
use reqwest::{Method, StatusCode, Url};
use serde_json::{json, Map, Value};
use tokio::sync::Semaphore;
use voktty_tool_policy::{ToolIdentity, ToolOrigin, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES};

use crate::modules::net::{build_pinned_http_client, resolve_safe_http_target};

use super::protocol::{
    notification_message, parse_server_message, request_message, McpNotification, RpcReply,
    ServerMessage, MAX_MESSAGE_BYTES,
};
use super::sse::{SseDecoder, SseError};
use super::stdio::{
    cursor_params, measure_discovery, modern_metadata, next_cursor, parse_modern_descriptor,
    parse_prompt, parse_resource, parse_tool, reply_to_result, require_result_type,
    CancellationToken, DiscoveredPrompt, DiscoveredResource, DiscoveredTool, McpError,
    McpErrorKind, ProtocolEra, ServerDescriptor, ToolCallOutcome, CLIENT_NAME, CLIENT_VERSION,
    LEGACY_PROTOCOL_VERSION, MODERN_PROTOCOL_VERSION,
};

const MAX_REDIRECTS: usize = 5;
const MAX_HEADERS_BYTES: usize = 64 * 1024;
const MAX_LOCATION_BYTES: usize = 8 * 1024;
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
const MAX_SESSION_ID_BYTES: usize = 256;
const MAX_PAGES: usize = 100;
const MAX_TOOLS: usize = 512;
const MAX_DISCOVERY_BYTES: usize = 8 * 1024 * 1024;
const MAX_REQUESTS_PER_MINUTE: usize = 60;
const MAX_CONCURRENT_REQUESTS: usize = 4;
const NOTIFICATION_QUEUE: usize = 128;

#[derive(Clone)]
pub struct BearerToken(String);

impl BearerToken {
    pub fn new(value: impl Into<String>) -> Result<Self, McpError> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 16 * 1024
            || value.as_bytes().iter().any(|byte| byte.is_ascii_control())
        {
            return Err(McpError::new(
                McpErrorKind::Authentication,
                "MCP bearer token is invalid",
            ));
        }
        Ok(Self(value))
    }

    fn header_value(&self) -> Result<reqwest::header::HeaderValue, McpError> {
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", self.0)).map_err(|_| {
            McpError::new(
                McpErrorKind::Authentication,
                "MCP bearer token cannot be encoded",
            )
        })
    }
}

pub struct HttpServerConfig {
    pub server_id: String,
    pub endpoint: String,
    pub allow_private_network: bool,
    pub request_timeout: Duration,
    pub authorization: Option<BearerToken>,
}

impl HttpServerConfig {
    pub fn new(server_id: impl Into<String>, endpoint: impl Into<String>) -> Self {
        Self {
            server_id: server_id.into(),
            endpoint: endpoint.into(),
            allow_private_network: false,
            request_timeout: Duration::from_secs(30),
            authorization: None,
        }
    }

    fn validate(&self) -> Result<(), McpError> {
        ToolIdentity::new(ToolOrigin::Mcp, &self.server_id, "server")
            .map_err(|_| McpError::new(McpErrorKind::Configuration, "invalid MCP server id"))?;
        if self.endpoint.len() > MAX_LOCATION_BYTES {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP endpoint is too long",
            ));
        }
        let parsed = Url::parse(&self.endpoint)
            .map_err(|_| McpError::new(McpErrorKind::Configuration, "MCP endpoint is invalid"))?;
        if parsed.fragment().is_some() {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP endpoint cannot contain a fragment",
            ));
        }
        if self.request_timeout.is_zero() || self.request_timeout > Duration::from_secs(60) {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP HTTP timeout is outside the allowed range",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum RequestFlavor {
    Modern,
    Legacy,
}

struct HttpResponseEnvelope {
    reply: Option<RpcReply>,
    session_id: Option<String>,
}

pub struct HttpClient {
    server_id: String,
    endpoint: Url,
    allow_private_network: bool,
    request_timeout: Duration,
    authorization: Option<BearerToken>,
    descriptor: ServerDescriptor,
    session_id: Mutex<Option<String>>,
    next_id: AtomicU64,
    concurrency: Arc<Semaphore>,
    rate_window: Mutex<VecDeque<Instant>>,
    notifications: Mutex<VecDeque<McpNotification>>,
    legacy_last_event_id: Mutex<Option<String>>,
}

impl HttpClient {
    pub async fn connect(config: HttpServerConfig) -> Result<Self, McpError> {
        config.validate()?;
        let endpoint = resolve_endpoint(&config.endpoint, config.allow_private_network).await?;
        let mut client = Self {
            server_id: config.server_id,
            endpoint,
            allow_private_network: config.allow_private_network,
            request_timeout: config.request_timeout,
            authorization: config.authorization,
            descriptor: ServerDescriptor {
                era: ProtocolEra::Modern,
                protocol_version: MODERN_PROTOCOL_VERSION.into(),
                server_name: None,
                server_version: None,
                capabilities: Value::Object(Map::new()),
            },
            session_id: Mutex::new(None),
            next_id: AtomicU64::new(1),
            concurrency: Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS)),
            rate_window: Mutex::new(VecDeque::new()),
            notifications: Mutex::new(VecDeque::new()),
            legacy_last_event_id: Mutex::new(None),
        };
        client.descriptor = client.negotiate().await?;
        Ok(client)
    }

    pub fn descriptor(&self) -> &ServerDescriptor {
        &self.descriptor
    }

    pub async fn list_tools(&self) -> Result<Vec<DiscoveredTool>, McpError> {
        let mut tools = Vec::new();
        let mut names = BTreeSet::new();
        let mut cursors = BTreeSet::new();
        let mut cursor: Option<String> = None;
        let mut discovery_bytes = 0usize;

        for _ in 0..MAX_PAGES {
            let mut params = Map::new();
            if let Some(cursor) = &cursor {
                params.insert("cursor".into(), Value::String(cursor.clone()));
            }
            let result = self.request_result("tools/list", params, None).await?;
            require_result_type(&result, false)?;
            let page = result
                .get("tools")
                .and_then(Value::as_array)
                .ok_or_else(|| McpError::protocol("tools/list result has no tools array"))?;
            for value in page {
                if tools.len() >= MAX_TOOLS {
                    return Err(McpError::resource("MCP server exposed more than 512 tools"));
                }
                discovery_bytes = discovery_bytes.saturating_add(
                    serde_json::to_vec(value)
                        .map_err(|_| McpError::protocol("could not measure MCP tool"))?
                        .len(),
                );
                if discovery_bytes > MAX_DISCOVERY_BYTES {
                    return Err(McpError::resource(
                        "MCP tool discovery exceeded its byte budget",
                    ));
                }
                let tool = parse_tool(&self.server_id, value)?;
                if !names.insert(tool.identity.name.clone()) {
                    return Err(McpError::protocol("MCP server repeated a tool name"));
                }
                tools.push(tool);
            }
            cursor = match result.get("nextCursor") {
                None | Some(Value::Null) => return Ok(tools),
                Some(Value::String(value)) => Some(value.clone()),
                Some(_) => {
                    return Err(McpError::protocol(
                        "tools/list nextCursor is not an opaque string",
                    ))
                }
            };
            let next = cursor.as_ref().expect("cursor assigned");
            if !cursors.insert(next.clone()) {
                return Err(McpError::protocol("MCP pagination cursor repeated"));
            }
        }
        Err(McpError::resource("MCP tool discovery exceeded 100 pages"))
    }

    pub async fn list_resources(&self) -> Result<Vec<DiscoveredResource>, McpError> {
        let mut resources = Vec::new();
        let mut names = BTreeSet::new();
        let mut cursors = BTreeSet::new();
        let mut cursor = None;
        let mut discovery_bytes = 0usize;

        for _ in 0..MAX_PAGES {
            let result = self
                .request_result("resources/list", cursor_params(&cursor), None)
                .await?;
            require_result_type(&result, false)?;
            let page = result
                .get("resources")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    McpError::protocol("resources/list result has no resources array")
                })?;
            for value in page {
                if resources.len() >= MAX_TOOLS {
                    return Err(McpError::resource("MCP server exposed too many resources"));
                }
                measure_discovery(value, &mut discovery_bytes, "resource")?;
                let resource = parse_resource(value)?;
                if !names.insert(resource.name.clone()) {
                    return Err(McpError::protocol("MCP server repeated a resource name"));
                }
                resources.push(resource);
            }
            cursor = next_cursor(&result, &mut cursors)?;
            if cursor.is_none() {
                return Ok(resources);
            }
        }
        Err(McpError::resource(
            "MCP resource discovery exceeded 100 pages",
        ))
    }

    pub async fn list_prompts(&self) -> Result<Vec<DiscoveredPrompt>, McpError> {
        let mut prompts = Vec::new();
        let mut names = BTreeSet::new();
        let mut cursors = BTreeSet::new();
        let mut cursor = None;
        let mut discovery_bytes = 0usize;

        for _ in 0..MAX_PAGES {
            let result = self
                .request_result("prompts/list", cursor_params(&cursor), None)
                .await?;
            require_result_type(&result, false)?;
            let page = result
                .get("prompts")
                .and_then(Value::as_array)
                .ok_or_else(|| McpError::protocol("prompts/list result has no prompts array"))?;
            for value in page {
                if prompts.len() >= MAX_TOOLS {
                    return Err(McpError::resource("MCP server exposed too many prompts"));
                }
                measure_discovery(value, &mut discovery_bytes, "prompt")?;
                let prompt = parse_prompt(value)?;
                if !names.insert(prompt.name.clone()) {
                    return Err(McpError::protocol("MCP server repeated a prompt name"));
                }
                prompts.push(prompt);
            }
            cursor = next_cursor(&result, &mut cursors)?;
            if cursor.is_none() {
                return Ok(prompts);
            }
        }
        Err(McpError::resource(
            "MCP prompt discovery exceeded 100 pages",
        ))
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Value,
        cancellation: Option<&CancellationToken>,
    ) -> Result<ToolCallOutcome, McpError> {
        ToolIdentity::new(ToolOrigin::Mcp, &self.server_id, name)
            .map_err(|_| McpError::protocol("invalid MCP tool name"))?;
        if !arguments.is_object() {
            return Err(McpError::protocol("MCP tool arguments must be an object"));
        }
        if serde_json::to_vec(&arguments)
            .map_err(|_| McpError::protocol("could not serialize MCP tool arguments"))?
            .len()
            > MAX_INPUT_BYTES
        {
            return Err(McpError::resource("MCP tool arguments exceeded 64 KiB"));
        }
        let mut params = Map::new();
        params.insert("name".into(), Value::String(name.into()));
        params.insert("arguments".into(), arguments);
        let result = self
            .request_result("tools/call", params, cancellation)
            .await?;
        if serde_json::to_vec(&result)
            .map_err(|_| McpError::protocol("could not measure MCP tool result"))?
            .len()
            > MAX_OUTPUT_BYTES
        {
            return Err(McpError::resource("MCP tool result exceeded 512 KiB"));
        }
        match result.get("resultType").and_then(Value::as_str) {
            None | Some("complete") => Ok(ToolCallOutcome::Complete(result)),
            Some("input_required") => Ok(ToolCallOutcome::InputRequired(result)),
            Some(_) => Err(McpError::protocol(
                "MCP tool returned an unsupported resultType",
            )),
        }
    }

    pub async fn listen_for_tool_changes(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<(), McpError> {
        if self.descriptor.era != ProtocolEra::Modern {
            return self.listen_legacy(cancellation).await;
        }
        let mut params = Map::new();
        params.insert("notifications".into(), json!({ "toolsListChanged": true }));
        match self
            .send_request(
                RequestFlavor::Modern,
                "subscriptions/listen",
                params,
                Some(cancellation),
                true,
            )
            .await
        {
            Err(error) if error.kind == McpErrorKind::Cancelled => Ok(()),
            Ok(_) => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub fn try_notification(&self) -> Option<McpNotification> {
        self.notifications.lock().unwrap().pop_front()
    }

    async fn negotiate(&self) -> Result<ServerDescriptor, McpError> {
        match self
            .send_request(
                RequestFlavor::Modern,
                "server/discover",
                Map::new(),
                None,
                false,
            )
            .await
        {
            Ok(envelope) => {
                if envelope.session_id.is_some() {
                    return Err(McpError::protocol(
                        "modern MCP response unexpectedly created a session",
                    ));
                }
                match required_reply(envelope)? {
                    RpcReply::Result(result) => parse_modern_descriptor(result),
                    RpcReply::Error(error) if error.code == -32601 => {
                        self.initialize_legacy().await
                    }
                    RpcReply::Error(error) if error.code == -32022 => Err(McpError::new(
                        McpErrorKind::IncompatibleVersion,
                        "MCP server does not support protocol 2026-07-28",
                    )),
                    RpcReply::Error(error) => Err(McpError::remote(error)),
                }
            }
            Err(error) => Err(error),
        }
    }

    async fn initialize_legacy(&self) -> Result<ServerDescriptor, McpError> {
        let mut params = Map::new();
        params.insert(
            "protocolVersion".into(),
            Value::String(LEGACY_PROTOCOL_VERSION.into()),
        );
        params.insert("capabilities".into(), Value::Object(Map::new()));
        params.insert(
            "clientInfo".into(),
            json!({ "name": CLIENT_NAME, "version": CLIENT_VERSION }),
        );
        let envelope = self
            .send_request(RequestFlavor::Legacy, "initialize", params, None, false)
            .await?;
        let session_id = envelope.session_id.clone();
        let result = reply_to_result(required_reply(envelope)?)?;
        if result.get("protocolVersion").and_then(Value::as_str) != Some(LEGACY_PROTOCOL_VERSION) {
            return Err(McpError::new(
                McpErrorKind::IncompatibleVersion,
                "legacy MCP server selected an unsupported protocol version",
            ));
        }
        let capabilities = result
            .get("capabilities")
            .filter(|value| value.is_object())
            .cloned()
            .ok_or_else(|| McpError::protocol("legacy initialize omitted capabilities"))?;
        *self.session_id.lock().unwrap() = session_id;
        self.send_notification(
            RequestFlavor::Legacy,
            "notifications/initialized",
            Map::new(),
        )
        .await?;
        let server_info = result.get("serverInfo").and_then(Value::as_object);
        Ok(ServerDescriptor {
            era: ProtocolEra::Legacy,
            protocol_version: LEGACY_PROTOCOL_VERSION.into(),
            server_name: server_info
                .and_then(|info| info.get("name"))
                .and_then(Value::as_str)
                .map(bounded_text),
            server_version: server_info
                .and_then(|info| info.get("version"))
                .and_then(Value::as_str)
                .map(bounded_text),
            capabilities,
        })
    }

    async fn request_result(
        &self,
        method: &str,
        params: Map<String, Value>,
        cancellation: Option<&CancellationToken>,
    ) -> Result<Value, McpError> {
        let flavor = if self.descriptor.era == ProtocolEra::Modern {
            RequestFlavor::Modern
        } else {
            RequestFlavor::Legacy
        };
        let envelope = self
            .send_request(flavor, method, params, cancellation, false)
            .await?;
        reply_to_result(required_reply(envelope)?)
    }

    async fn send_request(
        &self,
        flavor: RequestFlavor,
        method: &str,
        mut params: Map<String, Value>,
        cancellation: Option<&CancellationToken>,
        require_ack: bool,
    ) -> Result<HttpResponseEnvelope, McpError> {
        self.reserve_rate()?;
        let permit = acquire_permit(&self.concurrency, cancellation).await?;
        if flavor == RequestFlavor::Modern {
            params.insert("_meta".into(), modern_metadata());
        } else {
            params.remove("_meta");
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let body = serde_json::to_vec(&request_message(id, method, params))
            .map_err(|_| McpError::protocol("could not serialize MCP request"))?;
        let response = self
            .send_http(Method::POST, Some(body), flavor, cancellation)
            .await?;
        let envelope = self
            .decode_response(response, Some(id), cancellation, require_ack)
            .await;
        drop(permit);
        let envelope = envelope?;
        if flavor == RequestFlavor::Modern && envelope.session_id.is_some() {
            return Err(McpError::protocol(
                "modern MCP response unexpectedly created a session",
            ));
        }
        if flavor == RequestFlavor::Legacy {
            let expected = self.session_id.lock().unwrap().clone();
            if expected.is_some()
                && envelope.session_id.is_some()
                && envelope.session_id != expected
            {
                return Err(McpError::protocol("legacy MCP session id changed"));
            }
        }
        Ok(envelope)
    }

    async fn send_notification(
        &self,
        flavor: RequestFlavor,
        method: &str,
        mut params: Map<String, Value>,
    ) -> Result<(), McpError> {
        if flavor == RequestFlavor::Modern {
            params.insert("_meta".into(), modern_metadata());
        }
        let body = serde_json::to_vec(&notification_message(method, params))
            .map_err(|_| McpError::protocol("could not serialize MCP notification"))?;
        let response = self
            .send_http(Method::POST, Some(body), flavor, None)
            .await?;
        if response.status() == StatusCode::ACCEPTED || response.status() == StatusCode::NO_CONTENT
        {
            return Ok(());
        }
        let _ = self.decode_response(response, None, None, false).await?;
        Ok(())
    }

    async fn send_http(
        &self,
        method: Method,
        body: Option<Vec<u8>>,
        flavor: RequestFlavor,
        cancellation: Option<&CancellationToken>,
    ) -> Result<reqwest::Response, McpError> {
        if body
            .as_ref()
            .is_some_and(|body| body.len() > MAX_MESSAGE_BYTES)
        {
            return Err(McpError::resource("outbound MCP message exceeds 1 MiB"));
        }
        let mut current = self.endpoint.clone();
        for redirect_count in 0..=MAX_REDIRECTS {
            let target = resolve_endpoint(current.as_str(), self.allow_private_network).await?;
            if !same_origin(&self.endpoint, &target) {
                return Err(McpError::new(
                    McpErrorKind::Configuration,
                    "MCP redirect changed origin",
                ));
            }
            let safe = resolve_safe_http_target(target.as_str(), self.allow_private_network)
                .await
                .map_err(network_error)?;
            let client =
                build_pinned_http_client(&safe, self.request_timeout).map_err(network_error)?;
            let mut request = client
                .request(method.clone(), safe.url)
                .header(ACCEPT, "application/json, text/event-stream");
            if let Some(body) = &body {
                request = request
                    .header(CONTENT_TYPE, "application/json")
                    .body(body.clone());
            }
            if flavor == RequestFlavor::Legacy {
                request = request.header("MCP-Protocol-Version", LEGACY_PROTOCOL_VERSION);
                if let Some(session_id) = self.session_id.lock().unwrap().clone() {
                    request = request.header("MCP-Session-Id", session_id);
                }
                if method == Method::GET {
                    if let Some(event_id) = self.legacy_last_event_id.lock().unwrap().clone() {
                        request = request.header("Last-Event-ID", event_id);
                    }
                }
            }
            if let Some(token) = &self.authorization {
                request = request.header(AUTHORIZATION, token.header_value()?);
            }
            let sent = request.send();
            let response = if let Some(cancellation) = cancellation {
                tokio::select! {
                    response = sent => response.map_err(network_error)?,
                    _ = cancellation.cancelled() => {
                        return Err(McpError::new(McpErrorKind::Cancelled, "MCP HTTP request was cancelled"));
                    }
                }
            } else {
                sent.await.map_err(network_error)?
            };
            validate_header_budget(response.headers())?;
            if !response.status().is_redirection() {
                return Ok(response);
            }
            if redirect_count == MAX_REDIRECTS {
                return Err(McpError::resource("MCP endpoint exceeded five redirects"));
            }
            let preserves_request = if method == Method::GET {
                matches!(
                    response.status(),
                    StatusCode::MOVED_PERMANENTLY
                        | StatusCode::FOUND
                        | StatusCode::SEE_OTHER
                        | StatusCode::TEMPORARY_REDIRECT
                        | StatusCode::PERMANENT_REDIRECT
                )
            } else {
                matches!(
                    response.status(),
                    StatusCode::TEMPORARY_REDIRECT | StatusCode::PERMANENT_REDIRECT
                )
            };
            if !preserves_request {
                return Err(McpError::protocol(
                    "MCP POST redirect must preserve method and body",
                ));
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .filter(|value| value.len() <= MAX_LOCATION_BYTES)
                .ok_or_else(|| McpError::protocol("MCP redirect has no safe location"))?;
            current = current
                .join(location)
                .map_err(|_| McpError::protocol("MCP redirect location is invalid"))?;
        }
        Err(McpError::resource("MCP endpoint exceeded redirect budget"))
    }

    async fn decode_response(
        &self,
        response: reqwest::Response,
        expected_id: Option<u64>,
        cancellation: Option<&CancellationToken>,
        require_ack: bool,
    ) -> Result<HttpResponseEnvelope, McpError> {
        if response.status() == StatusCode::UNAUTHORIZED {
            let challenge = response
                .headers()
                .get(WWW_AUTHENTICATE)
                .and_then(|value| value.to_str().ok())
                .filter(|value| value.len() <= 8 * 1024)
                .map(str::to_string);
            return Err(McpError::new(
                McpErrorKind::Authentication,
                "MCP server requires authorization",
            )
            .with_authorization_challenge(challenge));
        }
        if !response.status().is_success() {
            return Err(McpError::new(
                McpErrorKind::Remote,
                format!("MCP HTTP server returned status {}", response.status()),
            ));
        }
        let session_id = parse_session_id(response.headers())?;
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or_default().trim())
            .ok_or_else(|| McpError::protocol("MCP HTTP response omitted content type"))?
            .to_string();

        let mut stream = response.bytes_stream();
        let mut bytes_seen = 0usize;
        let mut raw = Vec::new();
        let mut decoder = SseDecoder::default();
        let mut reply = None;
        let mut acknowledged = !require_ack;
        while let Some(item) = next_chunk(&mut stream, cancellation).await? {
            let chunk = item.map_err(network_error)?;
            bytes_seen = bytes_seen.saturating_add(chunk.len());
            if bytes_seen > MAX_STREAM_BYTES {
                return Err(McpError::resource("MCP HTTP response exceeded 8 MiB"));
            }
            if content_type == "application/json" {
                raw.extend_from_slice(&chunk);
                if raw.len() > MAX_MESSAGE_BYTES {
                    return Err(McpError::resource("MCP JSON response exceeded 1 MiB"));
                }
                continue;
            }
            if content_type != "text/event-stream" {
                return Err(McpError::protocol(
                    "MCP HTTP response has an unsupported content type",
                ));
            }
            for event in decoder.push(&chunk).map_err(sse_error)? {
                if let Some(id) = event.id.as_ref() {
                    *self.legacy_last_event_id.lock().unwrap() = Some(id.clone());
                }
                self.consume_server_message(
                    event.data.as_bytes(),
                    expected_id,
                    &mut reply,
                    &mut acknowledged,
                    require_ack,
                )?;
                if reply.is_some() && !require_ack {
                    break;
                }
            }
            if reply.is_some() && !require_ack {
                break;
            }
        }

        if content_type == "application/json" {
            self.consume_server_message(
                &raw,
                expected_id,
                &mut reply,
                &mut acknowledged,
                require_ack,
            )?;
        } else if let Some(event) = decoder.finish().map_err(sse_error)? {
            if let Some(id) = event.id.as_ref() {
                *self.legacy_last_event_id.lock().unwrap() = Some(id.clone());
            }
            self.consume_server_message(
                event.data.as_bytes(),
                expected_id,
                &mut reply,
                &mut acknowledged,
                require_ack,
            )?;
        }
        if require_ack && !acknowledged {
            return Err(McpError::protocol(
                "MCP subscription omitted its acknowledgement",
            ));
        }
        Ok(HttpResponseEnvelope { reply, session_id })
    }

    fn consume_server_message(
        &self,
        bytes: &[u8],
        expected_id: Option<u64>,
        reply: &mut Option<RpcReply>,
        acknowledged: &mut bool,
        require_ack: bool,
    ) -> Result<(), McpError> {
        match parse_server_message(bytes)
            .map_err(|_| McpError::protocol("MCP HTTP body contained invalid JSON-RPC"))?
        {
            ServerMessage::Response { id, reply: value } => {
                if Some(id) != expected_id || reply.is_some() {
                    return Err(McpError::protocol(
                        "MCP HTTP response id is duplicate or unexpected",
                    ));
                }
                *reply = Some(value);
            }
            ServerMessage::Notification(notification) => {
                if require_ack && !*acknowledged {
                    if notification.method != "notifications/acknowledged" {
                        return Err(McpError::protocol(
                            "MCP subscription did not acknowledge before events",
                        ));
                    }
                    *acknowledged = true;
                } else {
                    let mut queue = self.notifications.lock().unwrap();
                    if queue.len() >= NOTIFICATION_QUEUE {
                        return Err(McpError::resource(
                            "MCP notification queue exceeded 128 entries",
                        ));
                    }
                    queue.push_back(notification);
                }
            }
            ServerMessage::Request { .. } => {
                return Err(McpError::protocol(
                    "MCP server initiated an unsupported request",
                ))
            }
        }
        Ok(())
    }

    async fn listen_legacy(&self, cancellation: &CancellationToken) -> Result<(), McpError> {
        let response = self
            .send_http(Method::GET, None, RequestFlavor::Legacy, Some(cancellation))
            .await?;
        match self
            .decode_response(response, None, Some(cancellation), false)
            .await
        {
            Err(error) if error.kind == McpErrorKind::Cancelled => Ok(()),
            Ok(envelope) => {
                let expected = self.session_id.lock().unwrap().clone();
                if envelope.session_id.is_some() && envelope.session_id != expected {
                    return Err(McpError::protocol("legacy MCP session id changed"));
                }
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    fn reserve_rate(&self) -> Result<(), McpError> {
        let now = Instant::now();
        let mut rate = self.rate_window.lock().unwrap();
        while rate
            .front()
            .is_some_and(|started| now.duration_since(*started) >= Duration::from_secs(60))
        {
            rate.pop_front();
        }
        if rate.len() >= MAX_REQUESTS_PER_MINUTE {
            return Err(McpError::resource("MCP server request rate exceeded"));
        }
        rate.push_back(now);
        Ok(())
    }
}

async fn acquire_permit<'a>(
    semaphore: &'a Semaphore,
    cancellation: Option<&CancellationToken>,
) -> Result<tokio::sync::SemaphorePermit<'a>, McpError> {
    if let Some(cancellation) = cancellation {
        tokio::select! {
            permit = semaphore.acquire() => permit.map_err(|_| McpError::new(McpErrorKind::Cancelled, "MCP HTTP client stopped")),
            _ = cancellation.cancelled() => Err(McpError::new(McpErrorKind::Cancelled, "MCP HTTP request was cancelled")),
        }
    } else {
        semaphore
            .acquire()
            .await
            .map_err(|_| McpError::new(McpErrorKind::Cancelled, "MCP HTTP client stopped"))
    }
}

async fn next_chunk<S>(
    stream: &mut S,
    cancellation: Option<&CancellationToken>,
) -> Result<Option<Result<bytes::Bytes, reqwest::Error>>, McpError>
where
    S: futures_util::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Unpin,
{
    if let Some(cancellation) = cancellation {
        tokio::select! {
            item = stream.next() => Ok(item),
            _ = cancellation.cancelled() => Err(McpError::new(McpErrorKind::Cancelled, "MCP HTTP request was cancelled")),
        }
    } else {
        Ok(stream.next().await)
    }
}

async fn resolve_endpoint(value: &str, allow_private: bool) -> Result<Url, McpError> {
    let target = resolve_safe_http_target(value, allow_private)
        .await
        .map_err(network_error)?;
    if target.url.scheme() != "https" && !target.is_private_network {
        return Err(McpError::new(
            McpErrorKind::Configuration,
            "non-private MCP endpoints require HTTPS",
        ));
    }
    Ok(target.url)
}

fn required_reply(envelope: HttpResponseEnvelope) -> Result<RpcReply, McpError> {
    envelope
        .reply
        .ok_or_else(|| McpError::protocol("MCP HTTP response omitted JSON-RPC reply"))
}

fn parse_session_id(headers: &reqwest::header::HeaderMap) -> Result<Option<String>, McpError> {
    let Some(value) = headers.get("MCP-Session-Id") else {
        return Ok(None);
    };
    let value = value
        .to_str()
        .map_err(|_| McpError::protocol("MCP session id is not ASCII"))?;
    if value.is_empty()
        || value.len() > MAX_SESSION_ID_BYTES
        || value.as_bytes().iter().any(|byte| byte.is_ascii_control())
    {
        return Err(McpError::protocol("MCP session id is invalid"));
    }
    Ok(Some(value.into()))
}

fn validate_header_budget(headers: &reqwest::header::HeaderMap) -> Result<(), McpError> {
    let bytes = headers.iter().fold(0usize, |total, (name, value)| {
        total
            .saturating_add(name.as_str().len())
            .saturating_add(value.as_bytes().len())
    });
    if bytes > MAX_HEADERS_BYTES {
        return Err(McpError::resource("MCP HTTP headers exceeded 64 KiB"));
    }
    Ok(())
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn network_error(error: impl std::fmt::Display) -> McpError {
    let _ = error;
    McpError::new(McpErrorKind::Io, "MCP HTTP transport failed")
}

fn sse_error(error: SseError) -> McpError {
    match error {
        SseError::LineTooLarge | SseError::EventTooLarge => {
            McpError::resource("MCP SSE event exceeded its budget")
        }
        _ => McpError::protocol("MCP SSE stream is invalid"),
    }
}

fn bounded_text(value: &str) -> String {
    const MAX: usize = 1024;
    if value.len() <= MAX {
        return value.into();
    }
    let mut end = MAX;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].into()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::convert::Infallible;

    use bytes::Bytes;
    use futures_util::{stream, StreamExt};
    use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
    use hyper::body::{Frame, Incoming};
    use hyper::service::service_fn;
    use hyper::{Request, Response};
    use hyper_util::rt::TokioIo;
    use tokio::net::TcpListener;
    use tokio::sync::watch;

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build HTTP test runtime")
    }

    use super::*;

    struct TestRequest {
        method: String,
        headers: HashMap<String, String>,
        body: Value,
    }

    struct TestResponse {
        status: &'static str,
        content_type: Option<&'static str>,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
        hold_open: bool,
    }

    impl TestResponse {
        fn json(value: Value) -> Self {
            Self {
                status: "200 OK",
                content_type: Some("application/json"),
                headers: Vec::new(),
                body: serde_json::to_vec(&value).unwrap(),
                hold_open: false,
            }
        }

        fn accepted() -> Self {
            Self {
                status: "202 Accepted",
                content_type: None,
                headers: Vec::new(),
                body: Vec::new(),
                hold_open: false,
            }
        }
    }

    struct TestServer {
        endpoint: String,
        requests: Arc<Mutex<Vec<TestRequest>>>,
        shutdown: watch::Sender<bool>,
        runtime: Option<tokio::runtime::Runtime>,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            let _ = self.shutdown.send(true);
            if let Some(runtime) = self.runtime.take() {
                runtime.shutdown_timeout(Duration::from_secs(1));
            }
        }
    }

    fn spawn_server<F>(handler: F) -> TestServer
    where
        F: Fn(&TestRequest) -> TestResponse + Send + Sync + 'static,
    {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("build HTTP fixture runtime");
        let listener = runtime
            .block_on(TcpListener::bind("127.0.0.1:0"))
            .expect("bind HTTP fixture listener");
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(handler);
        let (shutdown, mut shutdown_receiver) = watch::channel(false);
        let requests_for_server = requests.clone();
        runtime.spawn(async move {
            loop {
                tokio::select! {
                    changed = shutdown_receiver.changed() => {
                        if changed.is_err() || *shutdown_receiver.borrow() {
                            break;
                        }
                    }
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else {
                            break;
                        };
                        let handler = handler.clone();
                        let requests = requests_for_server.clone();
                        tokio::spawn(async move {
                            let service = service_fn(move |request| {
                                serve_test_request(request, handler.clone(), requests.clone())
                            });
                            let _ = hyper::server::conn::http1::Builder::new()
                                .serve_connection(TokioIo::new(stream), service)
                                .await;
                        });
                    }
                }
            }
        });
        TestServer {
            endpoint,
            requests,
            shutdown,
            runtime: Some(runtime),
        }
    }

    async fn serve_test_request<F>(
        request: Request<Incoming>,
        handler: Arc<F>,
        requests: Arc<Mutex<Vec<TestRequest>>>,
    ) -> Result<Response<BoxBody<Bytes, Infallible>>, Infallible>
    where
        F: Fn(&TestRequest) -> TestResponse + Send + Sync + 'static,
    {
        let (parts, body) = request.into_parts();
        let bytes = body
            .collect()
            .await
            .map(|collected| collected.to_bytes())
            .unwrap_or_default();
        let mut headers = HashMap::new();
        for (name, value) in &parts.headers {
            if let Ok(value) = value.to_str() {
                headers.insert(name.as_str().to_ascii_lowercase(), value.to_string());
            }
        }
        let request = TestRequest {
            method: parts.method.to_string(),
            headers,
            body: if bytes.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&bytes).unwrap_or(Value::Null)
            },
        };
        let response = handler(&request);
        requests.lock().unwrap().push(request);

        let body = if response.hold_open {
            let stream = stream::once(async move {
                Ok::<_, Infallible>(Frame::data(Bytes::from(response.body)))
            })
            .chain(stream::pending());
            BodyExt::boxed(StreamBody::new(stream))
        } else {
            BodyExt::boxed(Full::new(Bytes::from(response.body)))
        };
        let status = response
            .status
            .split_whitespace()
            .next()
            .and_then(|status| status.parse::<u16>().ok())
            .unwrap_or(500);
        let mut builder = Response::builder().status(status);
        if let Some(content_type) = response.content_type {
            builder = builder.header(CONTENT_TYPE.as_str(), content_type);
        }
        for (name, value) in response.headers {
            builder = builder.header(name, value);
        }
        Ok(builder.body(body).expect("build HTTP fixture response"))
    }

    fn rpc_result(request: &TestRequest, value: Value, result_type: bool) -> Value {
        let result = if result_type {
            json!({ "resultType": "complete", "value": value })
        } else {
            value
        };
        json!({ "jsonrpc": "2.0", "id": request.body["id"], "result": result })
    }

    fn modern_handler(request: &TestRequest) -> TestResponse {
        let method = request.body["method"].as_str().unwrap_or_default();
        match method {
            "server/discover" => TestResponse::json(json!({
                "jsonrpc": "2.0",
                "id": request.body["id"],
                "result": {
                    "resultType": "complete",
                    "supportedVersions": [MODERN_PROTOCOL_VERSION],
                    "capabilities": { "tools": { "listChanged": true } },
                    "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "http-fixture", "version": "1" } }
                }
            })),
            "tools/list" => {
                let cursor = request.body["params"].get("cursor").and_then(Value::as_str);
                let result = if cursor == Some("") {
                    json!({ "resultType": "complete", "tools": [fixture_tool("delay")] })
                } else {
                    json!({ "resultType": "complete", "tools": [fixture_tool("echo")], "nextCursor": "" })
                };
                let message =
                    json!({ "jsonrpc": "2.0", "id": request.body["id"], "result": result });
                let body = format!("event: message\ndata: {}\n\n", message).into_bytes();
                TestResponse {
                    status: "200 OK",
                    content_type: Some("text/event-stream"),
                    headers: Vec::new(),
                    body,
                    hold_open: false,
                }
            }
            "tools/call" => TestResponse::json(json!({
                "jsonrpc": "2.0",
                "id": request.body["id"],
                "result": {
                    "resultType": "complete",
                    "content": [{ "type": "text", "text": "ok" }],
                    "structuredContent": request.body["params"]["arguments"],
                    "isError": false
                }
            })),
            "subscriptions/listen" => {
                let body = concat!(
                    "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/acknowledged\",\"params\":{}}\n\n",
                    "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/tools/list_changed\",\"params\":{}}\n\n"
                )
                .as_bytes()
                .to_vec();
                TestResponse {
                    status: "200 OK",
                    content_type: Some("text/event-stream"),
                    headers: Vec::new(),
                    body,
                    hold_open: true,
                }
            }
            _ => TestResponse::json(json!({
                "jsonrpc": "2.0", "id": request.body["id"],
                "error": { "code": -32601, "message": "Method not found" }
            })),
        }
    }

    fn legacy_handler(request: &TestRequest) -> TestResponse {
        if request.method == "GET" {
            let body = concat!(
                "id: legacy-event-9\n",
                "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/tools/list_changed\",\"params\":{}}\n\n"
            )
            .as_bytes()
            .to_vec();
            return TestResponse {
                status: "200 OK",
                content_type: Some("text/event-stream"),
                headers: vec![("MCP-Session-Id".into(), "fixture-session".into())],
                body,
                hold_open: false,
            };
        }
        let method = request.body["method"].as_str().unwrap_or_default();
        match method {
            "server/discover" => TestResponse::json(json!({
                "jsonrpc": "2.0", "id": request.body["id"],
                "error": { "code": -32601, "message": "Method not found" }
            })),
            "initialize" => {
                let mut response = TestResponse::json(rpc_result(
                    request,
                    json!({
                        "protocolVersion": LEGACY_PROTOCOL_VERSION,
                        "capabilities": { "tools": { "listChanged": true } },
                        "serverInfo": { "name": "legacy-http", "version": "1" }
                    }),
                    false,
                ));
                response
                    .headers
                    .push(("MCP-Session-Id".into(), "fixture-session".into()));
                response
            }
            "notifications/initialized" => TestResponse::accepted(),
            "tools/list" => TestResponse::json(rpc_result(
                request,
                json!({ "tools": [fixture_tool("echo")] }),
                false,
            )),
            _ => TestResponse::json(json!({
                "jsonrpc": "2.0", "id": request.body["id"],
                "error": { "code": -32601, "message": "Method not found" }
            })),
        }
    }

    fn fixture_tool(name: &str) -> Value {
        json!({
            "name": name,
            "description": "fixture tool",
            "inputSchema": { "type": "object", "additionalProperties": true }
        })
    }

    fn loopback_config(server: &TestServer) -> HttpServerConfig {
        let mut config = HttpServerConfig::new("fixture", &server.endpoint);
        config.allow_private_network = true;
        config.request_timeout = Duration::from_secs(5);
        config
    }

    fn fixture_transport_guard() -> std::sync::MutexGuard<'static, ()> {
        super::super::fixture_transport_guard()
    }

    #[test]
    fn modern_loopback_supports_json_sse_pagination_and_tool_calls() {
        let _guard = fixture_transport_guard();
        let server = spawn_server(modern_handler);
        test_runtime().block_on(async {
            let client = HttpClient::connect(loopback_config(&server))
                .await
                .expect("connect modern HTTP fixture");
            let tools = client.list_tools().await.expect("list tools");
            let outcome = client
                .call_tool("echo", json!({ "text": "hello" }), None)
                .await
                .expect("call tool");

            assert_eq!(client.descriptor().era, ProtocolEra::Modern);
            assert_eq!(tools.len(), 2);
            assert!(matches!(outcome, ToolCallOutcome::Complete(_)));
        });
        let requests = server.requests.lock().unwrap();
        assert!(requests.iter().all(|request| request.method == "POST"));
        assert!(requests.iter().all(|request| {
            request.body["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"]
                == MODERN_PROTOCOL_VERSION
        }));
    }

    #[test]
    fn legacy_sessions_are_isolated_and_bound_to_followup_requests() {
        let _guard = fixture_transport_guard();
        let server = spawn_server(legacy_handler);
        test_runtime().block_on(async {
            let client = HttpClient::connect(loopback_config(&server))
                .await
                .expect("connect legacy HTTP fixture");
            assert_eq!(client.descriptor().era, ProtocolEra::Legacy);
            assert_eq!(client.list_tools().await.expect("list tools").len(), 1);
        });
        let requests = server.requests.lock().unwrap();
        let initialized = requests
            .iter()
            .find(|request| request.body["method"] == "notifications/initialized")
            .expect("initialized request");
        let list = requests
            .iter()
            .find(|request| request.body["method"] == "tools/list")
            .expect("list request");
        assert_eq!(
            initialized
                .headers
                .get("mcp-session-id")
                .map(String::as_str),
            Some("fixture-session")
        );
        assert_eq!(
            list.headers.get("mcp-session-id").map(String::as_str),
            Some("fixture-session")
        );
    }

    #[test]
    fn modern_subscription_requires_ack_and_stops_on_cancellation() {
        let _guard = fixture_transport_guard();
        let server = spawn_server(modern_handler);
        test_runtime().block_on(async {
            let client = Arc::new(
                HttpClient::connect(loopback_config(&server))
                    .await
                    .expect("connect modern HTTP fixture"),
            );
            let cancellation = CancellationToken::new();
            let worker_client = client.clone();
            let worker_cancellation = cancellation.clone();
            let worker = tokio::spawn(async move {
                worker_client
                    .listen_for_tool_changes(&worker_cancellation)
                    .await
            });
            tokio::time::sleep(Duration::from_millis(50)).await;
            cancellation.cancel();

            worker.await.expect("join subscription").unwrap();
            assert_eq!(
                client.try_notification().map(|value| value.method),
                Some("notifications/tools/list_changed".into())
            );
        });
    }

    #[test]
    fn legacy_get_stream_resumes_from_last_event_id() {
        let _guard = fixture_transport_guard();
        let server = spawn_server(legacy_handler);
        test_runtime().block_on(async {
            let client = Arc::new(
                HttpClient::connect(loopback_config(&server))
                    .await
                    .expect("connect legacy HTTP fixture"),
            );
            for _ in 0..2 {
                let cancellation = CancellationToken::new();
                let worker_client = client.clone();
                let worker_cancellation = cancellation.clone();
                let worker = tokio::spawn(async move {
                    worker_client
                        .listen_for_tool_changes(&worker_cancellation)
                        .await
                });
                tokio::time::sleep(Duration::from_millis(50)).await;
                cancellation.cancel();
                worker.await.expect("join legacy stream").unwrap();
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });
        let requests = server.requests.lock().unwrap();
        let get_requests: Vec<_> = requests
            .iter()
            .filter(|request| request.method == "GET")
            .collect();
        assert_eq!(get_requests.len(), 2);
        assert_eq!(
            get_requests[1]
                .headers
                .get("last-event-id")
                .map(String::as_str),
            Some("legacy-event-9")
        );
    }

    #[test]
    fn loopback_requires_explicit_private_network_opt_in() {
        let _guard = fixture_transport_guard();
        let server = spawn_server(modern_handler);
        let config = HttpServerConfig::new("fixture", &server.endpoint);

        let error = test_runtime()
            .block_on(HttpClient::connect(config))
            .err()
            .expect("loopback without opt-in must fail");

        assert_eq!(error.kind, McpErrorKind::Io);
        assert!(server.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn private_opt_in_does_not_allow_plain_http_to_public_hosts() {
        let error = test_runtime()
            .block_on(resolve_endpoint("http://8.8.8.8", true))
            .expect_err("public plaintext endpoint must fail");

        assert_eq!(error.kind, McpErrorKind::Configuration);
    }

    #[test]
    fn legacy_session_hijack_is_rejected() {
        let _guard = fixture_transport_guard();
        let server = spawn_server(|request| {
            let mut response = legacy_handler(request);
            if request.body["method"] == "tools/list" {
                response
                    .headers
                    .push(("MCP-Session-Id".into(), "attacker-session".into()));
            }
            response
        });
        test_runtime().block_on(async {
            let client = HttpClient::connect(loopback_config(&server))
                .await
                .expect("connect legacy fixture");
            let error = client
                .list_tools()
                .await
                .expect_err("changed session must fail");

            assert_eq!(error.kind, McpErrorKind::Protocol);
        });
    }

    #[test]
    fn authorization_challenge_is_structured_and_bounded() {
        let _guard = fixture_transport_guard();
        let server = spawn_server(|_| {
            TestResponse {
            status: "401 Unauthorized",
            content_type: None,
            headers: vec![(
                "WWW-Authenticate".into(),
                "Bearer resource_metadata=\"https://mcp.example/.well-known/oauth-protected-resource\""
                    .into(),
            )],
            body: Vec::new(),
            hold_open: false,
        }
        });

        let error = test_runtime()
            .block_on(HttpClient::connect(loopback_config(&server)))
            .err()
            .expect("authorization must be required");

        assert_eq!(error.kind, McpErrorKind::Authentication);
        assert_eq!(error.message, "MCP server requires authorization");
        assert!(error
            .authorization_challenge
            .as_deref()
            .is_some_and(|value| value.starts_with("Bearer ")));
    }

    #[test]
    fn cross_origin_redirect_is_rejected_before_forwarding_token() {
        let _guard = fixture_transport_guard();
        let target = spawn_server(modern_handler);
        let target_url = target.endpoint.clone();
        let redirect = spawn_server(move |_| TestResponse {
            status: "307 Temporary Redirect",
            content_type: None,
            headers: vec![("Location".into(), target_url.clone())],
            body: Vec::new(),
            hold_open: false,
        });
        let mut config = loopback_config(&redirect);
        config.authorization = Some(BearerToken::new("secret-token").unwrap());

        let error = test_runtime()
            .block_on(HttpClient::connect(config))
            .err()
            .expect("cross-origin redirect must fail");

        assert_eq!(
            error.kind,
            McpErrorKind::Configuration,
            "redirect requests received: {}",
            redirect.requests.lock().unwrap().len()
        );
        assert!(target.requests.lock().unwrap().is_empty());
        let requests = redirect.requests.lock().unwrap();
        assert_eq!(
            requests[0].headers.get("authorization").map(String::as_str),
            Some("Bearer secret-token")
        );
    }
}
