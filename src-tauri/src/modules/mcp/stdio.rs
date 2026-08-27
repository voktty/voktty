use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map, Value};
use voktty_tool_policy::{
    ToolIdentity, ToolOrigin, UntrustedToolMetadata, MAX_ANNOTATIONS_BYTES, MAX_DESCRIPTION_BYTES,
    MAX_IDENTITY_COMPONENT_BYTES, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES,
};

use super::protocol::{
    notification_message, parse_server_message, request_message, LineDecoder, McpNotification,
    RpcError, RpcReply, ServerMessage, WireError, MAX_MESSAGE_BYTES,
};
use super::schema::{validate_schema, SchemaError};

pub(crate) const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";
pub(crate) const LEGACY_PROTOCOL_VERSION: &str = "2025-11-25";
pub(crate) const CLIENT_NAME: &str = "Voktty";
pub(crate) const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const READ_BUFFER_BYTES: usize = 16 * 1024;
const STDERR_BYTES: usize = 256 * 1024;
const NOTIFICATION_QUEUE: usize = 128;
const CANCELLED_TOMBSTONES: usize = 128;
const MAX_CONCURRENT_REQUESTS: usize = 4;
const MAX_REQUESTS_PER_MINUTE: usize = 60;
const MAX_PAGES: usize = 100;
const MAX_TOOLS: usize = 512;
const MAX_DISCOVERY_BYTES: usize = 8 * 1024 * 1024;
const MAX_ARGS: usize = 128;
const MAX_ARG_BYTES: usize = 4 * 1024;
const MAX_ENV_ENTRIES: usize = 64;
const MAX_ENV_BYTES: usize = 64 * 1024;
const MAX_ENV_VALUE_BYTES: usize = 16 * 1024;
const MAX_ERROR_BYTES: usize = 1024;
const SHUTDOWN_GRACE: Duration = Duration::from_millis(250);
const WAIT_POLL: Duration = Duration::from_millis(20);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum McpErrorKind {
    Configuration,
    Authentication,
    Spawn,
    Io,
    Protocol,
    Remote,
    Timeout,
    Cancelled,
    Busy,
    ResourceLimit,
    IncompatibleVersion,
    ProcessExited,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpError {
    pub kind: McpErrorKind,
    pub message: String,
    #[serde(skip)]
    pub authorization_challenge: Option<String>,
}

impl McpError {
    pub(crate) fn new(kind: McpErrorKind, message: impl AsRef<str>) -> Self {
        Self {
            kind,
            message: bounded_text(message.as_ref(), MAX_ERROR_BYTES),
            authorization_challenge: None,
        }
    }

    pub(crate) fn with_authorization_challenge(mut self, challenge: Option<String>) -> Self {
        self.authorization_challenge = challenge;
        self
    }

    pub(crate) fn protocol(message: impl AsRef<str>) -> Self {
        Self::new(McpErrorKind::Protocol, message)
    }

    pub(crate) fn resource(message: impl AsRef<str>) -> Self {
        Self::new(McpErrorKind::ResourceLimit, message)
    }

    pub(crate) fn remote(error: RpcError) -> Self {
        Self::new(
            McpErrorKind::Remote,
            format!("MCP server error {}: {}", error.code, error.message),
        )
    }
}

impl fmt::Display for McpError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for McpError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProtocolEra {
    Modern,
    Legacy,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDescriptor {
    pub era: ProtocolEra,
    pub protocol_version: String,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub capabilities: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTool {
    pub identity: ToolIdentity,
    pub title: Option<String>,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Option<Value>,
    pub annotations: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredResource {
    pub name: String,
    pub title: Option<String>,
    pub description: String,
    pub uri: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPrompt {
    pub name: String,
    pub title: Option<String>,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "resultType", content = "result", rename_all = "snake_case")]
pub enum ToolCallOutcome {
    Complete(Value),
    InputRequired(Value),
}

struct CancellationState {
    cancelled: AtomicBool,
    notify: tokio::sync::Notify,
}

impl Default for CancellationState {
    fn default() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: tokio::sync::Notify::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<CancellationState>);

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::Release);
        self.0.notify.notify_waiters();
        self.0.notify.notify_one();
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.0.notify.notified().await;
    }
}

pub struct StdioServerConfig {
    pub server_id: String,
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub authorized_root: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub probe_timeout: Duration,
    pub request_timeout: Duration,
}

impl StdioServerConfig {
    pub fn new(
        server_id: impl Into<String>,
        executable: impl Into<PathBuf>,
        cwd: impl Into<PathBuf>,
        authorized_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            server_id: server_id.into(),
            executable: executable.into(),
            args: Vec::new(),
            cwd: cwd.into(),
            authorized_root: authorized_root.into(),
            environment: BTreeMap::new(),
            probe_timeout: Duration::from_secs(2),
            request_timeout: Duration::from_secs(30),
        }
    }

    fn resolve(self) -> Result<ResolvedConfig, McpError> {
        ToolIdentity::new(ToolOrigin::Mcp, &self.server_id, "server")
            .map_err(|_| McpError::new(McpErrorKind::Configuration, "invalid MCP server id"))?;
        if self.args.len() > MAX_ARGS
            || self
                .args
                .iter()
                .any(|argument| argument.len() > MAX_ARG_BYTES || argument.contains('\0'))
        {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP server arguments exceed their limit",
            ));
        }
        validate_environment(&self.environment)?;
        if self.probe_timeout.is_zero()
            || self.probe_timeout > Duration::from_secs(5)
            || self.request_timeout.is_zero()
            || self.request_timeout > Duration::from_secs(30)
        {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP server timeout is outside the allowed range",
            ));
        }

        let executable = canonical_file(&self.executable, "MCP executable")?;
        let cwd = canonical_directory(&self.cwd, "MCP working directory")?;
        let authorized_root = canonical_directory(&self.authorized_root, "MCP authorized root")?;
        if !cwd.starts_with(&authorized_root) {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP working directory is outside its authorized root",
            ));
        }
        Ok(ResolvedConfig {
            server_id: self.server_id,
            executable,
            args: self.args,
            cwd,
            environment: self.environment,
            probe_timeout: self.probe_timeout,
            request_timeout: self.request_timeout,
        })
    }
}

struct ResolvedConfig {
    server_id: String,
    executable: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    environment: BTreeMap<String, String>,
    probe_timeout: Duration,
    request_timeout: Duration,
}

struct PendingRequest {
    sender: SyncSender<Result<RpcReply, McpError>>,
}

struct ByteRing {
    bytes: VecDeque<u8>,
    capacity: usize,
}

impl ByteRing {
    fn new(capacity: usize) -> Self {
        Self {
            bytes: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        if bytes.len() >= self.capacity {
            self.bytes.clear();
            self.bytes
                .extend(bytes[bytes.len() - self.capacity..].iter().copied());
            return;
        }
        let overflow = self
            .bytes
            .len()
            .saturating_add(bytes.len())
            .saturating_sub(self.capacity);
        self.bytes.drain(..overflow);
        self.bytes.extend(bytes.iter().copied());
    }
}

struct SharedState {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    #[cfg(windows)]
    job: Mutex<Option<crate::modules::proc::job::ProcessJob>>,
    pending: Mutex<BTreeMap<u64, PendingRequest>>,
    cancelled: Mutex<VecDeque<u64>>,
    rate_window: Mutex<VecDeque<Instant>>,
    fatal: Mutex<Option<McpError>>,
    shutting_down: AtomicBool,
    notification_tx: SyncSender<McpNotification>,
    _stderr: Arc<Mutex<ByteRing>>,
}

impl SharedState {
    fn check_fatal(&self) -> Result<(), McpError> {
        match self.fatal.lock().unwrap().clone() {
            Some(error) => Err(error),
            None if self.shutting_down.load(Ordering::Acquire) => Err(McpError::new(
                McpErrorKind::Cancelled,
                "MCP server is shutting down",
            )),
            None => Ok(()),
        }
    }

    fn reserve_request(
        &self,
        id: u64,
        sender: SyncSender<Result<RpcReply, McpError>>,
    ) -> Result<(), McpError> {
        self.check_fatal()?;
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
        let mut pending = self.pending.lock().unwrap();
        if pending.len() >= MAX_CONCURRENT_REQUESTS {
            return Err(McpError::new(
                McpErrorKind::Busy,
                "MCP server concurrency limit reached",
            ));
        }
        pending.insert(id, PendingRequest { sender });
        rate.push_back(now);
        Ok(())
    }

    fn send_json(&self, message: &Value) -> Result<(), McpError> {
        self.check_fatal()?;
        let mut bytes = serde_json::to_vec(message)
            .map_err(|_| McpError::protocol("could not serialize MCP message"))?;
        if bytes.len() > MAX_MESSAGE_BYTES {
            return Err(McpError::resource("outbound MCP message exceeds 1 MiB"));
        }
        bytes.push(b'\n');
        let mut writer = self.stdin.lock().unwrap();
        let stdin = writer.as_mut().ok_or_else(|| {
            McpError::new(McpErrorKind::ProcessExited, "MCP server stdin is closed")
        })?;
        stdin
            .write_all(&bytes)
            .and_then(|_| stdin.flush())
            .map_err(|_| McpError::new(McpErrorKind::Io, "failed to write MCP message"))
    }

    fn dispatch(&self, message: ServerMessage) {
        match message {
            ServerMessage::Response { id, reply } => {
                let pending = self.pending.lock().unwrap().remove(&id);
                if let Some(pending) = pending {
                    let _ = pending.sender.send(Ok(reply));
                    return;
                }
                if self.cancelled.lock().unwrap().contains(&id) {
                    return;
                }
                self.fail(McpError::protocol(
                    "MCP server sent a duplicate or unexpected response id",
                ));
            }
            ServerMessage::Notification(notification) => {
                match self.notification_tx.try_send(notification) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => self.fail(McpError::resource(
                        "MCP notification queue exceeded 128 entries",
                    )),
                    Err(TrySendError::Disconnected(_)) => self.fail(McpError::new(
                        McpErrorKind::Cancelled,
                        "MCP notification receiver closed",
                    )),
                }
            }
            ServerMessage::Request { id, method } => self.fail(McpError::protocol(format!(
                "MCP server initiated unsupported request {method} with id {id}",
            ))),
        }
    }

    fn cancel_pending(&self, id: u64, reason: &str) {
        self.pending.lock().unwrap().remove(&id);
        let mut cancelled = self.cancelled.lock().unwrap();
        if cancelled.len() >= CANCELLED_TOMBSTONES {
            cancelled.pop_front();
        }
        cancelled.push_back(id);
        drop(cancelled);
        let mut params = Map::new();
        params.insert("requestId".into(), Value::Number(id.into()));
        params.insert("reason".into(), Value::String(reason.into()));
        let _ = self.send_json(&notification_message("notifications/cancelled", params));
    }

    fn fail(&self, error: McpError) {
        let mut fatal = self.fatal.lock().unwrap();
        if fatal.is_some() {
            return;
        }
        *fatal = Some(error.clone());
        drop(fatal);
        let pending = std::mem::take(&mut *self.pending.lock().unwrap());
        for request in pending.into_values() {
            let _ = request.sender.send(Err(error.clone()));
        }
        self.force_terminate();
    }

    fn shutdown(&self) {
        if self.shutting_down.swap(true, Ordering::AcqRel) {
            return;
        }
        self.stdin.lock().unwrap().take();
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            if self
                .child
                .lock()
                .unwrap()
                .try_wait()
                .ok()
                .flatten()
                .is_some()
            {
                self.release_job();
                self.cancel_waiters();
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        self.force_terminate();
        self.cancel_waiters();
    }

    fn cancel_waiters(&self) {
        let error = McpError::new(McpErrorKind::Cancelled, "MCP server stopped");
        let pending = std::mem::take(&mut *self.pending.lock().unwrap());
        for request in pending.into_values() {
            let _ = request.sender.send(Err(error.clone()));
        }
    }

    fn force_terminate(&self) {
        #[cfg(unix)]
        {
            let pid = self.child.lock().unwrap().id();
            unsafe {
                libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
            }
        }
        self.release_job();
        let _ = self.child.lock().unwrap().kill();
    }

    #[cfg(windows)]
    fn release_job(&self) {
        self.job.lock().unwrap().take();
    }

    #[cfg(not(windows))]
    fn release_job(&self) {}
}

struct Connection {
    state: Arc<SharedState>,
    notifications: Mutex<Receiver<McpNotification>>,
    next_id: AtomicU64,
    request_timeout: Duration,
}

impl Connection {
    fn request(
        &self,
        flavor: RequestFlavor,
        method: &str,
        mut params: Map<String, Value>,
        timeout: Duration,
        cancellation: Option<&CancellationToken>,
    ) -> Result<RpcReply, McpError> {
        if flavor == RequestFlavor::Modern {
            params.insert("_meta".into(), modern_metadata());
        } else {
            params.remove("_meta");
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::sync_channel(1);
        self.state.reserve_request(id, sender)?;
        if let Err(error) = self.state.send_json(&request_message(id, method, params)) {
            self.state.pending.lock().unwrap().remove(&id);
            self.state.fail(error.clone());
            return Err(error);
        }

        let deadline = Instant::now() + timeout;
        loop {
            if cancellation.is_some_and(CancellationToken::is_cancelled) {
                self.state.cancel_pending(id, "User requested cancellation");
                return Err(McpError::new(
                    McpErrorKind::Cancelled,
                    "MCP request was cancelled",
                ));
            }
            let now = Instant::now();
            if now >= deadline {
                if let Ok(response) = receiver.try_recv() {
                    return response;
                }
                self.state.cancel_pending(id, "Request timed out");
                return Err(McpError::new(
                    McpErrorKind::Timeout,
                    "MCP request timed out",
                ));
            }
            let wait = WAIT_POLL.min(deadline.saturating_duration_since(now));
            match receiver.recv_timeout(wait) {
                Ok(response) => return response,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return self
                        .state
                        .check_fatal()
                        .and_then(|_| Err(McpError::protocol("MCP response channel closed")))
                }
            }
        }
    }

    fn notify(
        &self,
        flavor: RequestFlavor,
        method: &str,
        mut params: Map<String, Value>,
    ) -> Result<(), McpError> {
        if flavor == RequestFlavor::Modern {
            params.insert("_meta".into(), modern_metadata());
        }
        self.state.send_json(&notification_message(method, params))
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.state.shutdown();
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum RequestFlavor {
    Modern,
    Legacy,
}

pub struct StdioClient {
    connection: Connection,
    server_id: String,
    descriptor: ServerDescriptor,
}

impl StdioClient {
    pub fn connect(config: StdioServerConfig) -> Result<Self, McpError> {
        let resolved = config.resolve()?;
        let server_id = resolved.server_id.clone();
        let probe_timeout = resolved.probe_timeout;
        let connection = spawn_connection(resolved)?;
        let descriptor = negotiate(&connection, probe_timeout)?;
        Ok(Self {
            connection,
            server_id,
            descriptor,
        })
    }

    pub fn descriptor(&self) -> &ServerDescriptor {
        &self.descriptor
    }

    pub fn list_tools(&self) -> Result<Vec<DiscoveredTool>, McpError> {
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
            let result = self.request_result("tools/list", params, None)?;
            require_result_type(&result, false)?;
            let page = result
                .get("tools")
                .and_then(Value::as_array)
                .ok_or_else(|| McpError::protocol("tools/list result has no tools array"))?;
            for value in page {
                if tools.len() >= MAX_TOOLS {
                    return Err(McpError::resource("MCP server exposed more than 512 tools"));
                }
                let encoded = serde_json::to_vec(value)
                    .map_err(|_| McpError::protocol("could not measure MCP tool"))?;
                discovery_bytes = discovery_bytes.saturating_add(encoded.len());
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
                Some(Value::String(cursor)) => Some(cursor.clone()),
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

    pub fn list_resources(&self) -> Result<Vec<DiscoveredResource>, McpError> {
        let mut resources = Vec::new();
        let mut names = BTreeSet::new();
        let mut cursors = BTreeSet::new();
        let mut cursor: Option<String> = None;
        let mut discovery_bytes = 0usize;
        for _ in 0..MAX_PAGES {
            let result = self.request_result("resources/list", cursor_params(&cursor), None)?;
            require_result_type(&result, false)?;
            let page = result
                .get("resources")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    McpError::protocol("resources/list result has no resources array")
                })?;
            for value in page {
                measure_discovery(value, &mut discovery_bytes, "resource")?;
                if resources.len() >= MAX_TOOLS {
                    return Err(McpError::resource("MCP server exposed too many resources"));
                }
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

    pub fn list_prompts(&self) -> Result<Vec<DiscoveredPrompt>, McpError> {
        let mut prompts = Vec::new();
        let mut names = BTreeSet::new();
        let mut cursors = BTreeSet::new();
        let mut cursor: Option<String> = None;
        let mut discovery_bytes = 0usize;
        for _ in 0..MAX_PAGES {
            let result = self.request_result("prompts/list", cursor_params(&cursor), None)?;
            require_result_type(&result, false)?;
            let page = result
                .get("prompts")
                .and_then(Value::as_array)
                .ok_or_else(|| McpError::protocol("prompts/list result has no prompts array"))?;
            for value in page {
                measure_discovery(value, &mut discovery_bytes, "prompt")?;
                if prompts.len() >= MAX_TOOLS {
                    return Err(McpError::resource("MCP server exposed too many prompts"));
                }
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

    pub fn call_tool(
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
        let result = self.request_result("tools/call", params, cancellation)?;
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

    pub fn listen_for_tool_changes(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<(), McpError> {
        if self.descriptor.era != ProtocolEra::Modern {
            return Err(McpError::new(
                McpErrorKind::IncompatibleVersion,
                "legacy MCP uses its negotiated listChanged notification",
            ));
        }
        let mut params = Map::new();
        params.insert("notifications".into(), json!({ "toolsListChanged": true }));
        let reply = self.connection.request(
            RequestFlavor::Modern,
            "subscriptions/listen",
            params,
            Duration::from_secs(60),
            Some(cancellation),
        )?;
        let result = reply_to_result(reply)?;
        require_result_type(&result, false)
    }

    pub fn try_notification(&self) -> Result<Option<McpNotification>, McpError> {
        self.connection.state.check_fatal()?;
        match self.connection.notifications.lock().unwrap().try_recv() {
            Ok(notification) => Ok(Some(notification)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => Err(McpError::new(
                McpErrorKind::ProcessExited,
                "MCP notification channel closed",
            )),
        }
    }

    fn request_result(
        &self,
        method: &str,
        params: Map<String, Value>,
        cancellation: Option<&CancellationToken>,
    ) -> Result<Value, McpError> {
        let flavor = match self.descriptor.era {
            ProtocolEra::Modern => RequestFlavor::Modern,
            ProtocolEra::Legacy => RequestFlavor::Legacy,
        };
        let reply = self.connection.request(
            flavor,
            method,
            params,
            self.connection.request_timeout,
            cancellation,
        )?;
        reply_to_result(reply)
    }
}

fn spawn_connection(config: ResolvedConfig) -> Result<Connection, McpError> {
    let mut command = Command::new(&config.executable);
    command
        .args(&config.args)
        .current_dir(&config.cwd)
        .env_clear()
        .envs(minimal_environment())
        .envs(&config.environment)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut command);
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let mut child = command.spawn().map_err(|_| {
        McpError::new(
            McpErrorKind::Spawn,
            format!(
                "could not start MCP executable {}",
                config.executable.display()
            ),
        )
    })?;

    #[cfg(windows)]
    let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
        Ok(job) => Some(job),
        Err(_) => {
            terminate_spawned_child(&mut child);
            return Err(McpError::new(
                McpErrorKind::Spawn,
                "could not secure MCP process tree",
            ));
        }
    };

    let stdin = child.stdin.take().ok_or_else(|| {
        terminate_spawned_child(&mut child);
        McpError::new(McpErrorKind::Spawn, "MCP process has no stdin pipe")
    })?;
    let mut stdout = child.stdout.take().ok_or_else(|| {
        terminate_spawned_child(&mut child);
        McpError::new(McpErrorKind::Spawn, "MCP process has no stdout pipe")
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        terminate_spawned_child(&mut child);
        McpError::new(McpErrorKind::Spawn, "MCP process has no stderr pipe")
    })?;

    let (notification_tx, notification_rx) = mpsc::sync_channel(NOTIFICATION_QUEUE);
    let stderr_ring = Arc::new(Mutex::new(ByteRing::new(STDERR_BYTES)));
    let state = Arc::new(SharedState {
        child: Mutex::new(child),
        stdin: Mutex::new(Some(stdin)),
        #[cfg(windows)]
        job: Mutex::new(job),
        pending: Mutex::new(BTreeMap::new()),
        cancelled: Mutex::new(VecDeque::new()),
        rate_window: Mutex::new(VecDeque::new()),
        fatal: Mutex::new(None),
        shutting_down: AtomicBool::new(false),
        notification_tx,
        _stderr: stderr_ring.clone(),
    });

    let reader_state = state.clone();
    if thread::Builder::new()
        .name(format!("voktty-mcp-reader-{}", config.server_id))
        .spawn(move || {
            let mut decoder = LineDecoder::default();
            let mut buffer = [0u8; READ_BUFFER_BYTES];
            loop {
                match stdout.read(&mut buffer) {
                    Ok(0) => {
                        if !reader_state.shutting_down.load(Ordering::Acquire) {
                            reader_state.fail(McpError::new(
                                McpErrorKind::ProcessExited,
                                "MCP server closed stdout",
                            ));
                        }
                        return;
                    }
                    Ok(read) => match decoder.push(&buffer[..read]) {
                        Ok(messages) => {
                            for message in messages {
                                match parse_server_message(&message) {
                                    Ok(message) => reader_state.dispatch(message),
                                    Err(error) => {
                                        reader_state.fail(wire_error(error));
                                        return;
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            reader_state.fail(wire_error(error));
                            return;
                        }
                    },
                    Err(_) => {
                        if !reader_state.shutting_down.load(Ordering::Acquire) {
                            reader_state
                                .fail(McpError::new(McpErrorKind::Io, "failed to read MCP stdout"));
                        }
                        return;
                    }
                }
            }
        })
        .is_err()
    {
        state.fail(McpError::new(
            McpErrorKind::Spawn,
            "could not start MCP reader",
        ));
        return Err(McpError::new(
            McpErrorKind::Spawn,
            "could not start MCP reader",
        ));
    }

    thread::Builder::new()
        .name(format!("voktty-mcp-stderr-{}", config.server_id))
        .spawn(move || {
            let mut buffer = [0u8; 4096];
            while let Ok(read) = stderr.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                stderr_ring.lock().unwrap().push(&buffer[..read]);
            }
        })
        .map_err(|_| {
            state.fail(McpError::new(
                McpErrorKind::Spawn,
                "could not start MCP stderr reader",
            ));
            McpError::new(McpErrorKind::Spawn, "could not start MCP stderr reader")
        })?;

    Ok(Connection {
        state,
        notifications: Mutex::new(notification_rx),
        next_id: AtomicU64::new(1),
        request_timeout: config.request_timeout,
    })
}

fn terminate_spawned_child(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
    let _ = child.kill();
}

fn negotiate(
    connection: &Connection,
    probe_timeout: Duration,
) -> Result<ServerDescriptor, McpError> {
    let modern = connection.request(
        RequestFlavor::Modern,
        "server/discover",
        Map::new(),
        probe_timeout,
        None,
    );
    match modern {
        Ok(RpcReply::Result(result)) => parse_modern_descriptor(result),
        Ok(RpcReply::Error(error)) if error.code == -32022 => Err(McpError::new(
            McpErrorKind::IncompatibleVersion,
            "MCP server does not support protocol 2026-07-28",
        )),
        Ok(RpcReply::Error(_))
        | Err(McpError {
            kind: McpErrorKind::Timeout,
            ..
        }) => initialize_legacy(connection),
        Err(error) => Err(error),
    }
}

pub(crate) fn parse_modern_descriptor(result: Value) -> Result<ServerDescriptor, McpError> {
    require_result_type(&result, false)?;
    let supported = result
        .get("supportedVersions")
        .and_then(Value::as_array)
        .ok_or_else(|| McpError::protocol("server/discover omitted supportedVersions"))?;
    if !supported
        .iter()
        .any(|version| version.as_str() == Some(MODERN_PROTOCOL_VERSION))
    {
        return Err(McpError::new(
            McpErrorKind::IncompatibleVersion,
            "MCP server does not support protocol 2026-07-28",
        ));
    }
    let capabilities = result
        .get("capabilities")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| McpError::protocol("server/discover omitted capabilities"))?;
    let server_info = result
        .get("_meta")
        .and_then(Value::as_object)
        .and_then(|meta| meta.get("io.modelcontextprotocol/serverInfo"))
        .and_then(Value::as_object);
    Ok(ServerDescriptor {
        era: ProtocolEra::Modern,
        protocol_version: MODERN_PROTOCOL_VERSION.into(),
        server_name: bounded_optional(server_info.and_then(|info| info.get("name"))),
        server_version: bounded_optional(server_info.and_then(|info| info.get("version"))),
        capabilities,
    })
}

fn initialize_legacy(connection: &Connection) -> Result<ServerDescriptor, McpError> {
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
    let result = reply_to_result(connection.request(
        RequestFlavor::Legacy,
        "initialize",
        params,
        connection.request_timeout,
        None,
    )?)?;
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
    let server_info = result.get("serverInfo").and_then(Value::as_object);
    connection.notify(
        RequestFlavor::Legacy,
        "notifications/initialized",
        Map::new(),
    )?;
    Ok(ServerDescriptor {
        era: ProtocolEra::Legacy,
        protocol_version: LEGACY_PROTOCOL_VERSION.into(),
        server_name: bounded_optional(server_info.and_then(|info| info.get("name"))),
        server_version: bounded_optional(server_info.and_then(|info| info.get("version"))),
        capabilities,
    })
}

pub(crate) fn modern_metadata() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
            "name": CLIENT_NAME,
            "version": CLIENT_VERSION,
        },
        "io.modelcontextprotocol/clientCapabilities": {},
    })
}

pub(crate) fn reply_to_result(reply: RpcReply) -> Result<Value, McpError> {
    match reply {
        RpcReply::Result(result) => Ok(result),
        RpcReply::Error(error) => Err(McpError::remote(error)),
    }
}

pub(crate) fn require_result_type(result: &Value, allow_input: bool) -> Result<(), McpError> {
    match result.get("resultType").and_then(Value::as_str) {
        None | Some("complete") => Ok(()),
        Some("input_required") if allow_input => Ok(()),
        _ => Err(McpError::protocol("MCP response has invalid resultType")),
    }
}

pub(crate) fn parse_tool(server_id: &str, value: &Value) -> Result<DiscoveredTool, McpError> {
    let object = value
        .as_object()
        .ok_or_else(|| McpError::protocol("MCP tool definition is not an object"))?;
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| McpError::protocol("MCP tool has no name"))?;
    if name.len() > MAX_IDENTITY_COMPONENT_BYTES {
        return Err(McpError::resource("MCP tool name exceeds 128 bytes"));
    }
    let identity = ToolIdentity::new(ToolOrigin::Mcp, server_id, name)
        .map_err(|_| McpError::protocol("MCP tool name is invalid"))?;
    let description = object
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if description.len() > MAX_DESCRIPTION_BYTES {
        return Err(McpError::resource("MCP tool description exceeds 4 KiB"));
    }
    let title = object
        .get("title")
        .and_then(Value::as_str)
        .map(|title| bounded_text(title, MAX_DESCRIPTION_BYTES));
    let input_schema = object
        .get("inputSchema")
        .ok_or_else(|| McpError::protocol("MCP tool omitted inputSchema"))?;
    validate_schema(input_schema).map_err(schema_error)?;
    let output_schema = object.get("outputSchema");
    if let Some(schema) = output_schema {
        validate_schema(schema).map_err(schema_error)?;
    }
    let annotations = object.get("annotations");
    if annotations.is_some_and(|value| !value.is_object()) {
        return Err(McpError::protocol("MCP tool annotations are not an object"));
    }
    let input_bytes = serde_json::to_vec(input_schema)
        .map_err(|_| McpError::protocol("could not measure MCP input schema"))?;
    let output_bytes = output_schema
        .map(serde_json::to_vec)
        .transpose()
        .map_err(|_| McpError::protocol("could not measure MCP output schema"))?;
    let annotations_bytes = annotations
        .map(serde_json::to_vec)
        .transpose()
        .map_err(|_| McpError::protocol("could not measure MCP annotations"))?
        .unwrap_or_default();
    if annotations_bytes.len() > MAX_ANNOTATIONS_BYTES {
        return Err(McpError::resource("MCP annotations exceed 64 KiB"));
    }
    UntrustedToolMetadata::measure(
        description,
        &input_bytes,
        output_bytes.as_deref(),
        &annotations_bytes,
    )
    .map_err(|_| McpError::resource("MCP tool metadata exceeds its budget"))?;

    Ok(DiscoveredTool {
        identity,
        title,
        description: description.into(),
        input_schema: input_schema.clone(),
        output_schema: output_schema.cloned(),
        annotations: annotations.cloned(),
    })
}

pub(crate) fn parse_resource(value: &Value) -> Result<DiscoveredResource, McpError> {
    let object = value
        .as_object()
        .ok_or_else(|| McpError::protocol("MCP resource definition is not an object"))?;
    Ok(DiscoveredResource {
        name: bounded_field(object.get("name"), "resource name", 128)?,
        title: optional_bounded_field(object.get("title"), "resource title", 256)?,
        description: optional_bounded_field(
            object.get("description"),
            "resource description",
            4096,
        )?
        .unwrap_or_default(),
        uri: bounded_field(object.get("uri"), "resource URI", 8 * 1024)?,
    })
}

pub(crate) fn parse_prompt(value: &Value) -> Result<DiscoveredPrompt, McpError> {
    let object = value
        .as_object()
        .ok_or_else(|| McpError::protocol("MCP prompt definition is not an object"))?;
    Ok(DiscoveredPrompt {
        name: bounded_field(object.get("name"), "prompt name", 128)?,
        title: optional_bounded_field(object.get("title"), "prompt title", 256)?,
        description: optional_bounded_field(object.get("description"), "prompt description", 4096)?
            .unwrap_or_default(),
    })
}

pub(crate) fn cursor_params(cursor: &Option<String>) -> Map<String, Value> {
    let mut params = Map::new();
    if let Some(cursor) = cursor {
        params.insert("cursor".into(), Value::String(cursor.clone()));
    }
    params
}

pub(crate) fn next_cursor(
    result: &Value,
    cursors: &mut BTreeSet<String>,
) -> Result<Option<String>, McpError> {
    match result.get("nextCursor") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(cursor)) if cursors.insert(cursor.clone()) => Ok(Some(cursor.clone())),
        Some(Value::String(_)) => Err(McpError::protocol("MCP pagination cursor repeated")),
        Some(_) => Err(McpError::protocol(
            "MCP list nextCursor is not an opaque string",
        )),
    }
}

pub(crate) fn measure_discovery(
    value: &Value,
    total: &mut usize,
    kind: &str,
) -> Result<(), McpError> {
    *total = total.saturating_add(
        serde_json::to_vec(value)
            .map_err(|_| McpError::protocol(format!("could not measure MCP {kind}")))?
            .len(),
    );
    if *total > MAX_DISCOVERY_BYTES {
        return Err(McpError::resource(format!(
            "MCP {kind} discovery exceeded its byte budget"
        )));
    }
    Ok(())
}

fn bounded_field(value: Option<&Value>, label: &str, max: usize) -> Result<String, McpError> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| McpError::protocol(format!("MCP {label} is missing")))?;
    validate_bounded_field(value, label, max)?;
    Ok(value.into())
}

fn optional_bounded_field(
    value: Option<&Value>,
    label: &str,
    max: usize,
) -> Result<Option<String>, McpError> {
    let Some(value) = value else { return Ok(None) };
    let value = value
        .as_str()
        .ok_or_else(|| McpError::protocol(format!("MCP {label} is invalid")))?;
    validate_bounded_field(value, label, max)?;
    Ok(Some(value.into()))
}

fn validate_bounded_field(value: &str, label: &str, max: usize) -> Result<(), McpError> {
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(McpError::protocol(format!("MCP {label} is invalid")));
    }
    Ok(())
}

fn schema_error(error: SchemaError) -> McpError {
    match error {
        SchemaError::TooLarge
        | SchemaError::TooDeep
        | SchemaError::TooManyNodes
        | SchemaError::TooManyProperties => {
            McpError::resource("MCP tool schema exceeds its structural budget")
        }
        SchemaError::ExternalReference => {
            McpError::protocol("MCP tool schema contains an external reference")
        }
        SchemaError::NotAnObject => McpError::protocol("MCP tool schema is not an object"),
    }
}

fn wire_error(error: WireError) -> McpError {
    match error {
        WireError::MessageTooLarge => McpError::resource("MCP stdout message exceeds 1 MiB"),
        _ => McpError::protocol("MCP stdout contained an invalid protocol message"),
    }
}

fn canonical_file(path: &Path, label: &str) -> Result<PathBuf, McpError> {
    let canonical = path.canonicalize().map_err(|_| {
        McpError::new(
            McpErrorKind::Configuration,
            format!("{label} does not exist"),
        )
    })?;
    if !canonical.is_file() {
        return Err(McpError::new(
            McpErrorKind::Configuration,
            format!("{label} is not a file"),
        ));
    }
    Ok(canonical)
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, McpError> {
    let canonical = path.canonicalize().map_err(|_| {
        McpError::new(
            McpErrorKind::Configuration,
            format!("{label} does not exist"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(McpError::new(
            McpErrorKind::Configuration,
            format!("{label} is not a directory"),
        ));
    }
    Ok(canonical)
}

fn validate_environment(environment: &BTreeMap<String, String>) -> Result<(), McpError> {
    if environment.len() > MAX_ENV_ENTRIES {
        return Err(McpError::new(
            McpErrorKind::Configuration,
            "MCP environment has too many entries",
        ));
    }
    let mut total = 0usize;
    for (key, value) in environment {
        if key.is_empty()
            || key.len() > 256
            || key.contains('=')
            || key.contains('\0')
            || value.len() > MAX_ENV_VALUE_BYTES
            || value.contains('\0')
        {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP environment entry is invalid",
            ));
        }
        total = total.saturating_add(key.len()).saturating_add(value.len());
        if total > MAX_ENV_BYTES {
            return Err(McpError::new(
                McpErrorKind::Configuration,
                "MCP environment exceeds 64 KiB",
            ));
        }
    }
    Ok(())
}

fn minimal_environment() -> BTreeMap<String, std::ffi::OsString> {
    const KEYS: &[&str] = &[
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "WINDIR",
        "HOME",
        "USERPROFILE",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
    ];
    KEYS.iter()
        .filter_map(|key| std::env::var_os(key).map(|value| ((*key).into(), value)))
        .collect()
}

fn bounded_optional(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(|value| bounded_text(value, MAX_DESCRIPTION_BYTES))
}

fn bounded_text(value: &str, max_bytes: usize) -> String {
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
    use std::sync::Barrier;

    use super::*;

    fn fixture_config(mode: &str) -> StdioServerConfig {
        let node = which::which("node").expect("node is required by the repository test suite");
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root")
            .to_path_buf();
        let fixture = root.join("scripts/fixtures/mcp-stdio-server.mjs");
        let mut config = StdioServerConfig::new("fixture", node, &root, &root);
        config.args = vec![fixture.to_string_lossy().into_owned(), mode.into()];
        config.probe_timeout = Duration::from_secs(5);
        config.request_timeout = Duration::from_secs(2);
        config
    }

    fn fixture_transport_guard() -> std::sync::MutexGuard<'static, ()> {
        super::super::fixture_transport_guard()
    }

    #[test]
    fn modern_fixture_discovers_all_pages_and_calls_a_tool() {
        let _guard = fixture_transport_guard();
        let client = StdioClient::connect(fixture_config("modern")).expect("connect fixture");
        assert_eq!(client.descriptor().era, ProtocolEra::Modern);

        let tools = client.list_tools().expect("list tools");
        let outcome = client
            .call_tool("echo", json!({ "text": "hello" }), None)
            .expect("call tool");

        assert_eq!(tools.len(), 2);
        assert!(tools.iter().any(|tool| tool.identity.name == "echo"));
        assert!(matches!(outcome, ToolCallOutcome::Complete(_)));
    }

    #[test]
    fn legacy_fixture_isolated_fallback_still_works() {
        let _guard = fixture_transport_guard();
        let client = StdioClient::connect(fixture_config("legacy")).expect("connect fixture");

        assert_eq!(client.descriptor().era, ProtocolEra::Legacy);
        assert_eq!(client.list_tools().expect("list tools").len(), 2);
        assert!(matches!(
            client.call_tool("echo", json!({ "text": "legacy" }), None),
            Ok(ToolCallOutcome::Complete(_))
        ));
    }

    #[test]
    fn fragmented_fixture_output_is_reassembled() {
        let _guard = fixture_transport_guard();
        let client = StdioClient::connect(fixture_config("fragmented")).expect("connect fixture");

        assert_eq!(client.list_tools().expect("list tools").len(), 2);
    }

    #[test]
    fn concurrent_responses_may_arrive_out_of_order() {
        let _guard = fixture_transport_guard();
        let client = Arc::new(
            StdioClient::connect(fixture_config("out-of-order")).expect("connect fixture"),
        );
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();
        for label in ["first", "second"] {
            let client = client.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                client.call_tool("delay", json!({ "label": label }), None)
            }));
        }
        barrier.wait();

        for handle in handles {
            assert!(matches!(
                handle.join().expect("join caller"),
                Ok(ToolCallOutcome::Complete(_))
            ));
        }
    }

    #[test]
    fn duplicate_response_ids_fail_closed() {
        let _guard = fixture_transport_guard();
        let client = StdioClient::connect(fixture_config("duplicate")).expect("connect fixture");
        assert!(client.list_tools().is_ok());
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            if client.connection.state.check_fatal().is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }

        assert_eq!(
            client.connection.state.check_fatal().unwrap_err().kind,
            McpErrorKind::Protocol
        );
    }

    #[test]
    fn stdout_garbage_fails_negotiation() {
        let _guard = fixture_transport_guard();
        let error = StdioClient::connect(fixture_config("garbage"))
            .err()
            .expect("garbage must fail");

        assert_eq!(error.kind, McpErrorKind::Protocol);
    }

    #[test]
    fn timeout_sends_cancellation_and_keeps_connection_usable() {
        let _guard = fixture_transport_guard();
        let mut config = fixture_config("modern");
        config.request_timeout = Duration::from_millis(150);
        let client = StdioClient::connect(config).expect("connect fixture");

        let error = client
            .call_tool("hang", json!({}), None)
            .expect_err("hang must time out");
        let echo = client.call_tool("echo", json!({ "text": "after" }), None);

        assert_eq!(error.kind, McpErrorKind::Timeout);
        assert!(echo.is_ok());
    }

    #[test]
    fn explicit_cancellation_notifies_server_and_keeps_connection_usable() {
        let _guard = fixture_transport_guard();
        let client =
            Arc::new(StdioClient::connect(fixture_config("modern")).expect("connect fixture"));
        let cancellation = CancellationToken::new();
        let worker_client = client.clone();
        let worker_cancellation = cancellation.clone();
        let worker = thread::spawn(move || {
            worker_client.call_tool("hang", json!({}), Some(&worker_cancellation))
        });
        thread::sleep(Duration::from_millis(50));
        cancellation.cancel();

        let error = worker
            .join()
            .expect("join cancelled call")
            .expect_err("hang must be cancelled");
        assert_eq!(error.kind, McpErrorKind::Cancelled);

        let deadline = Instant::now() + Duration::from_secs(1);
        let mut cancellation_observed = false;
        while Instant::now() < deadline {
            if client
                .try_notification()
                .expect("read fixture notification")
                .is_some_and(|notification| notification.method == "fixture/cancelled")
            {
                cancellation_observed = true;
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(cancellation_observed);
        assert!(client
            .call_tool("echo", json!({ "text": "after cancellation" }), None)
            .is_ok());
    }

    #[test]
    fn working_directory_must_be_inside_authorized_root() {
        let mut config = fixture_config("modern");
        config.authorized_root = config.cwd.join("src-tauri");

        let error = StdioClient::connect(config)
            .err()
            .expect("outside cwd must fail");

        assert_eq!(error.kind, McpErrorKind::Configuration);
    }

    #[test]
    fn hostile_external_schema_is_rejected() {
        let _guard = fixture_transport_guard();
        let client =
            StdioClient::connect(fixture_config("hostile-schema")).expect("connect fixture");

        assert_eq!(
            client.list_tools().unwrap_err().kind,
            McpErrorKind::Protocol
        );
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "manual Windows MCP performance baseline"]
    fn windows_mcp_performance_baseline() {
        let _guard = fixture_transport_guard();
        let disabled_started = Instant::now();
        let disabled = crate::modules::mcp::manager::McpManagerState::default();
        let disabled_startup_us = disabled_started.elapsed().as_micros();
        assert_eq!(disabled.connected_count(), 0);

        let connection_started = Instant::now();
        let client = StdioClient::connect(fixture_config("modern")).expect("connect fixture");
        let first_connection_us = connection_started.elapsed().as_micros();

        let discovery_started = Instant::now();
        let tools = client.list_tools().expect("discover tools");
        let discovery_us = discovery_started.elapsed().as_micros();

        let call_started = Instant::now();
        let outcome = client
            .call_tool("echo", json!({ "text": "baseline" }), None)
            .expect("call fixture tool");
        let tool_call_us = call_started.elapsed().as_micros();
        thread::sleep(Duration::from_millis(100));
        let child_pid = client.connection.state.child.lock().unwrap().id();
        let idle_rss_bytes = process_working_set_bytes(child_pid);

        assert_eq!(tools.len(), 2);
        assert!(matches!(outcome, ToolCallOutcome::Complete(_)));
        assert!(idle_rss_bytes > 0);
        eprintln!(
            "{{\"platform\":\"windows\",\"arch\":\"{}\",\"disabledStartupUs\":{},\"firstConnectionUs\":{},\"discoveryUs\":{},\"toolCallUs\":{},\"idleServerRssBytes\":{}}}",
            std::env::consts::ARCH,
            disabled_startup_us,
            first_connection_us,
            discovery_us,
            tool_call_us,
            idle_rss_bytes
        );
    }

    #[test]
    fn dropping_client_terminates_descendant_processes() {
        let _guard = fixture_transport_guard();
        let client = StdioClient::connect(fixture_config("modern")).expect("connect fixture");
        let outcome = client
            .call_tool("spawn_child", json!({}), None)
            .expect("spawn child fixture");
        let pid = match outcome {
            ToolCallOutcome::Complete(result) => result["structuredContent"]["pid"]
                .as_u64()
                .expect("child pid") as u32,
            ToolCallOutcome::InputRequired(_) => panic!("unexpected input request"),
        };
        assert!(process_is_alive(pid));

        drop(client);

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && process_is_alive(pid) {
            thread::sleep(Duration::from_millis(25));
        }
        assert!(!process_is_alive(pid));
    }

    #[cfg(unix)]
    fn process_is_alive(pid: u32) -> bool {
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }

    #[cfg(windows)]
    fn process_is_alive(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code = 0u32;
            let alive = GetExitCodeProcess(handle, &mut code) != 0 && code == STILL_ACTIVE as u32;
            CloseHandle(handle);
            alive
        }
    }

    #[cfg(windows)]
    fn process_working_set_bytes(pid: u32) -> usize {
        use std::mem::{size_of, MaybeUninit};
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        };

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            assert!(!handle.is_null(), "open MCP fixture process");
            let mut counters = MaybeUninit::<PROCESS_MEMORY_COUNTERS>::uninit();
            let read = GetProcessMemoryInfo(
                handle,
                counters.as_mut_ptr(),
                size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            );
            CloseHandle(handle);
            assert_ne!(read, 0, "read MCP fixture memory");
            counters.assume_init().WorkingSetSize
        }
    }
}
