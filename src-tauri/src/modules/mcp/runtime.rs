use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;
use voktty_tool_policy::{
    conservative_effects, ApprovalGrantId, ApprovalGrantReceipt, CapabilityDecision,
    CapabilityPolicy, CapabilityRequest, CapabilityScope, DecisionOutcome, ExecutionLimits,
    ExecutionMode, GrantLedger, ToolDescriptor, ToolEffect, ToolRule, UntrustedToolAnnotations,
};

use super::manager::{ManagedClient, McpManagerState, McpTransportConfig};
use super::{CancellationToken, DiscoveredTool, McpError, McpErrorKind, ToolCallOutcome};

const SNAPSHOT_TTL_MS: u64 = 60 * 60 * 1000;
const APPROVAL_TTL_MS: u64 = 60 * 1000;
const MAX_SNAPSHOTS: usize = 256;
const MAX_PENDING: usize = 128;
const MAX_AUDIT: usize = 256;
const MAX_TOOL_CALL_ID_BYTES: usize = 128;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRunToolView {
    name: String,
    namespaced_name: String,
    server_id: String,
    title: Option<String>,
    description: String,
    input_schema: Value,
    output_schema: Option<Value>,
    effects: BTreeSet<ToolEffect>,
    scope: String,
    requires_approval: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSnapshot {
    snapshot_id: String,
    expires_at_ms: u64,
    tools: Vec<McpRunToolView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolAuditEntry {
    id: String,
    origin: &'static str,
    tool_name: String,
    decision: &'static str,
    duration_ms: u64,
    result: &'static str,
}

struct SnapshotTool {
    discovered: DiscoveredTool,
    descriptor: ToolDescriptor,
    client: ManagedClient,
}

struct SnapshotRecord {
    view: McpToolSnapshot,
    policy: CapabilityPolicy,
    tools: BTreeMap<String, SnapshotTool>,
    server_ids: BTreeSet<String>,
}

#[derive(Clone)]
struct ApprovalBinding {
    snapshot_id: String,
    tool_name: String,
    input_digest: [u8; 32],
    grant_id: ApprovalGrantId,
}

impl ApprovalBinding {
    fn matches(&self, snapshot_id: &str, tool_name: &str, input_digest: &[u8; 32]) -> bool {
        self.snapshot_id == snapshot_id
            && self.tool_name == tool_name
            && &self.input_digest == input_digest
    }
}

struct PendingApproval {
    snapshot_id: String,
    tool_name: String,
    input_digest: [u8; 32],
    request: CapabilityRequest,
}

#[derive(Default)]
struct RuntimeInner {
    snapshots: BTreeMap<String, Arc<SnapshotRecord>>,
    pending: BTreeMap<String, PendingApproval>,
    approved: BTreeMap<String, ApprovalBinding>,
    active: BTreeMap<String, (String, CancellationToken)>,
    cancelled_before_start: BTreeSet<String>,
    grants: GrantLedger,
    audit: VecDeque<McpToolAuditEntry>,
    audit_counter: u64,
}

#[derive(Default)]
pub struct RuntimeState(Mutex<RuntimeInner>);

impl RuntimeState {
    fn lock(&self) -> Result<MutexGuard<'_, RuntimeInner>, McpError> {
        self.0
            .lock()
            .map_err(|_| runtime_error("MCP tool runtime is unavailable"))
    }

    pub(super) fn invalidate_server(&self, server_id: &str) {
        if let Ok(mut inner) = self.0.lock() {
            let invalid: BTreeSet<String> = inner
                .snapshots
                .iter()
                .filter(|(_, snapshot)| snapshot.server_ids.contains(server_id))
                .map(|(id, _)| id.clone())
                .collect();
            for id in &invalid {
                inner.snapshots.remove(id);
            }
            inner
                .pending
                .retain(|_, approval| !invalid.contains(&approval.snapshot_id));
            inner
                .approved
                .retain(|_, approval| !invalid.contains(&approval.snapshot_id));
            let cancelled: Vec<String> = inner
                .active
                .iter()
                .filter(|(_, (snapshot_id, _))| invalid.contains(snapshot_id))
                .map(|(tool_call_id, _)| tool_call_id.clone())
                .collect();
            for tool_call_id in cancelled {
                if let Some((_, token)) = inner.active.remove(&tool_call_id) {
                    token.cancel();
                }
            }
        }
    }
}

#[tauri::command]
pub fn mcp_create_tool_snapshot(
    state: State<'_, McpManagerState>,
) -> Result<McpToolSnapshot, McpError> {
    let mut policy = CapabilityPolicy::new();
    let mut tools = BTreeMap::new();
    let mut views = Vec::new();
    let mut server_ids = BTreeSet::new();
    {
        let servers = state
            .servers
            .lock()
            .map_err(|_| runtime_error("MCP manager state is unavailable"))?;
        for server in servers.values() {
            let Some(client) = server.client.clone() else {
                continue;
            };
            let (scope, scope_label) = transport_scope(&server.config.transport)?;
            for discovered in &server.discovered_tools {
                validate_schema(&discovered.input_schema)?;
                if let Some(schema) = &discovered.output_schema {
                    validate_schema(schema)?;
                }
                let annotations: UntrustedToolAnnotations = discovered
                    .annotations
                    .clone()
                    .and_then(|value| serde_json::from_value(value).ok())
                    .unwrap_or_default();
                let trusted_read = server
                    .config
                    .automatic_read_tools
                    .contains(&discovered.identity.name);
                let effects = classify_effects(trusted_read, &annotations);
                let descriptor = ToolDescriptor {
                    identity: discovered.identity.clone(),
                    description: discovered.description.clone(),
                    effects: effects.clone(),
                    scope: scope.clone(),
                    limits: ExecutionLimits::default(),
                };
                let requires_approval =
                    !trusted_read || effects != BTreeSet::from([ToolEffect::Read]);
                policy
                    .register(ToolRule {
                        descriptor: descriptor.clone(),
                        mode: if requires_approval {
                            ExecutionMode::ApprovalRequired
                        } else {
                            ExecutionMode::Automatic
                        },
                    })
                    .map_err(|_| runtime_error("MCP tool policy registration failed"))?;
                let namespaced_name = discovered.identity.namespaced_name.clone();
                views.push(McpRunToolView {
                    name: discovered.identity.name.clone(),
                    namespaced_name: namespaced_name.clone(),
                    server_id: discovered.identity.source_id.clone(),
                    title: discovered.title.clone(),
                    description: discovered.description.clone(),
                    input_schema: discovered.input_schema.clone(),
                    output_schema: discovered.output_schema.clone(),
                    effects,
                    scope: scope_label.clone(),
                    requires_approval,
                });
                tools.insert(
                    namespaced_name,
                    SnapshotTool {
                        discovered: discovered.clone(),
                        descriptor,
                        client: client.clone(),
                    },
                );
                server_ids.insert(server.config.id.clone());
            }
        }
    }
    views.sort_by(|left, right| left.namespaced_name.cmp(&right.namespaced_name));
    let now = now_ms()?;
    let snapshot_id = random_id()?;
    let view = McpToolSnapshot {
        snapshot_id: snapshot_id.clone(),
        expires_at_ms: now.saturating_add(SNAPSHOT_TTL_MS),
        tools: views,
    };
    let snapshot = Arc::new(SnapshotRecord {
        view: view.clone(),
        policy,
        tools,
        server_ids,
    });
    let mut inner = state.runtime.lock()?;
    prune_expired(&mut inner, now);
    if inner.snapshots.len() >= MAX_SNAPSHOTS {
        return Err(McpError::resource("MCP tool snapshot limit reached"));
    }
    inner.snapshots.insert(snapshot_id, snapshot);
    Ok(view)
}

#[tauri::command]
pub fn mcp_get_tool_snapshot(
    state: State<'_, McpManagerState>,
    snapshot_id: String,
) -> Result<McpToolSnapshot, McpError> {
    validate_hex_id(&snapshot_id)?;
    let now = now_ms()?;
    let mut inner = state.runtime.lock()?;
    prune_expired(&mut inner, now);
    inner
        .snapshots
        .get(&snapshot_id)
        .map(|snapshot| snapshot.view.clone())
        .ok_or_else(|| runtime_error("MCP tool snapshot is unavailable"))
}

#[tauri::command]
pub fn mcp_decide_tool_call(
    state: State<'_, McpManagerState>,
    snapshot_id: String,
    tool_name: String,
    tool_call_id: String,
    arguments: Value,
) -> Result<CapabilityDecision, McpError> {
    validate_tool_call_id(&tool_call_id)?;
    let input_digest = validate_arguments(&arguments)?;
    let now = now_ms()?;
    let mut inner = state.runtime.lock()?;
    prune_expired(&mut inner, now);
    if inner.pending.contains_key(&tool_call_id)
        || inner.approved.contains_key(&tool_call_id)
        || inner.active.contains_key(&tool_call_id)
    {
        return Err(McpError::new(
            McpErrorKind::Busy,
            "MCP tool call id is already in use",
        ));
    }
    let snapshot = inner
        .snapshots
        .get(&snapshot_id)
        .cloned()
        .ok_or_else(|| runtime_error("MCP tool snapshot is unavailable"))?;
    let tool = snapshot
        .tools
        .get(&tool_name)
        .ok_or_else(|| runtime_error("MCP tool is unavailable in this run"))?;
    validate_instance(&tool.discovered.input_schema, &arguments, "input")?;
    let request = CapabilityRequest::from(&tool.descriptor);
    let decision = snapshot.policy.decide(&request);
    match decision.outcome {
        DecisionOutcome::RequireApproval => {
            if inner.pending.len() >= MAX_PENDING && !inner.pending.contains_key(&tool_call_id) {
                return Err(McpError::resource("MCP approval queue limit reached"));
            }
            inner.pending.insert(
                tool_call_id,
                PendingApproval {
                    snapshot_id,
                    tool_name,
                    input_digest,
                    request,
                },
            );
        }
        DecisionOutcome::Deny => {
            push_audit(&mut inner, &tool_name, "deny", 0, "blocked");
        }
        DecisionOutcome::Allow => {}
    }
    Ok(decision)
}

#[tauri::command]
pub fn mcp_resolve_tool_approval(
    state: State<'_, McpManagerState>,
    tool_call_id: String,
    approved: bool,
) -> Result<Option<ApprovalGrantReceipt>, McpError> {
    validate_tool_call_id(&tool_call_id)?;
    let now = now_ms()?;
    let mut inner = state.runtime.lock()?;
    prune_expired(&mut inner, now);
    let pending = inner
        .pending
        .remove(&tool_call_id)
        .ok_or_else(|| runtime_error("MCP approval is no longer pending"))?;
    if !approved {
        push_audit(&mut inner, &pending.tool_name, "deny", 0, "blocked");
        return Ok(None);
    }
    let snapshot = inner
        .snapshots
        .get(&pending.snapshot_id)
        .cloned()
        .ok_or_else(|| runtime_error("MCP tool snapshot is unavailable"))?;
    let grant_id = ApprovalGrantId::from_bytes(random_bytes()?);
    let receipt = inner
        .grants
        .issue(
            grant_id.clone(),
            &pending.request,
            &snapshot.policy,
            now,
            APPROVAL_TTL_MS,
        )
        .map_err(|_| runtime_error("MCP approval grant could not be issued"))?;
    inner.approved.insert(
        tool_call_id,
        ApprovalBinding {
            snapshot_id: pending.snapshot_id,
            tool_name: pending.tool_name,
            input_digest: pending.input_digest,
            grant_id,
        },
    );
    Ok(Some(receipt))
}

#[tauri::command]
pub async fn mcp_call_snapshot_tool(
    state: State<'_, McpManagerState>,
    snapshot_id: String,
    tool_name: String,
    tool_call_id: String,
    arguments: Value,
) -> Result<ToolCallOutcome, McpError> {
    validate_tool_call_id(&tool_call_id)?;
    let input_digest = validate_arguments(&arguments)?;
    let now = now_ms()?;
    let (client, discovered, cancellation) = {
        let mut inner = state.runtime.lock()?;
        prune_expired(&mut inner, now);
        let snapshot = inner
            .snapshots
            .get(&snapshot_id)
            .cloned()
            .ok_or_else(|| runtime_error("MCP tool snapshot is unavailable"))?;
        let tool = snapshot
            .tools
            .get(&tool_name)
            .ok_or_else(|| runtime_error("MCP tool is unavailable in this run"))?;
        validate_instance(&tool.discovered.input_schema, &arguments, "input")?;
        let request = CapabilityRequest::from(&tool.descriptor);
        let decision = snapshot.policy.decide(&request);
        match decision.outcome {
            DecisionOutcome::Allow => {}
            DecisionOutcome::RequireApproval => {
                let binding = inner
                    .approved
                    .remove(&tool_call_id)
                    .ok_or_else(|| runtime_error("MCP tool approval is required"))?;
                if !binding.matches(&snapshot_id, &tool_name, &input_digest) {
                    return Err(runtime_error(
                        "MCP approval binding does not match the tool call",
                    ));
                }
                inner
                    .grants
                    .consume(&binding.grant_id, &request, now)
                    .map_err(|_| runtime_error("MCP approval grant is invalid"))?;
            }
            DecisionOutcome::Deny => return Err(runtime_error("MCP tool call was denied")),
        }
        if inner.active.contains_key(&tool_call_id) {
            return Err(McpError::new(
                McpErrorKind::Busy,
                "MCP tool call is already active",
            ));
        }
        if inner.cancelled_before_start.remove(&tool_call_id) {
            return Err(McpError::new(
                McpErrorKind::Cancelled,
                "MCP tool call was cancelled",
            ));
        }
        let cancellation = CancellationToken::new();
        inner.active.insert(
            tool_call_id.clone(),
            (snapshot_id.clone(), cancellation.clone()),
        );
        (tool.client.clone(), tool.discovered.clone(), cancellation)
    };

    let started = Instant::now();
    let raw_result: Result<ToolCallOutcome, McpError> = match client {
        ManagedClient::Stdio(client) => {
            let name = discovered.identity.name.clone();
            let token = cancellation.clone();
            match tauri::async_runtime::spawn_blocking(move || {
                client.call_tool(&name, arguments, Some(&token))
            })
            .await
            {
                Ok(result) => result,
                Err(_) => Err(runtime_error("MCP stdio tool worker failed")),
            }
        }
        ManagedClient::Http(client) => {
            client
                .call_tool(&discovered.identity.name, arguments, Some(&cancellation))
                .await
        }
    };
    let duration = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let validated_result = raw_result.and_then(|outcome| {
        if let Some(schema) = &discovered.output_schema {
            let value = outcome_value(&outcome);
            let structured = value
                .get("structuredContent")
                .ok_or_else(|| runtime_error("MCP tool output omitted structured content"))?;
            validate_instance(schema, structured, "output")?;
        }
        Ok(outcome)
    });
    let mut inner = state.runtime.lock()?;
    inner.active.remove(&tool_call_id);
    match validated_result {
        Ok(outcome) => {
            push_audit(&mut inner, &tool_name, "allow", duration, "success");
            Ok(outcome)
        }
        Err(error) => {
            let result = if error.kind == McpErrorKind::Cancelled {
                "cancelled"
            } else {
                "error"
            };
            push_audit(&mut inner, &tool_name, "allow", duration, result);
            Err(McpError::new(error.kind, "MCP tool execution failed"))
        }
    }
}

#[tauri::command]
pub fn mcp_cancel_tool_call(
    state: State<'_, McpManagerState>,
    tool_call_id: String,
) -> Result<(), McpError> {
    validate_tool_call_id(&tool_call_id)?;
    let mut inner = state.runtime.lock()?;
    if let Some((_, cancellation)) = inner.active.get(&tool_call_id) {
        cancellation.cancel();
    } else if inner.cancelled_before_start.len() < MAX_PENDING {
        inner.cancelled_before_start.insert(tool_call_id);
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_recent_tool_audit(
    state: State<'_, McpManagerState>,
) -> Result<Vec<McpToolAuditEntry>, McpError> {
    Ok(state.runtime.lock()?.audit.iter().cloned().collect())
}

fn transport_scope(transport: &McpTransportConfig) -> Result<(CapabilityScope, String), McpError> {
    match transport {
        McpTransportConfig::Stdio {
            authorized_root, ..
        } => Ok((
            CapabilityScope {
                workspace_id: Some(authorized_root.clone()),
                ..CapabilityScope::default()
            },
            authorized_root.clone(),
        )),
        McpTransportConfig::Http { endpoint, .. } => {
            let url = url::Url::parse(endpoint)
                .map_err(|_| runtime_error("MCP HTTP scope is invalid"))?;
            let host = url
                .host_str()
                .ok_or_else(|| runtime_error("MCP HTTP scope has no host"))?;
            let label = match url.port_or_known_default() {
                Some(port) => format!("{}://{host}:{port}", url.scheme()),
                None => format!("{}://{host}", url.scheme()),
            };
            Ok((
                CapabilityScope {
                    host: Some(label.clone()),
                    ..CapabilityScope::default()
                },
                label,
            ))
        }
    }
}

fn classify_effects(
    explicitly_trusted_read: bool,
    annotations: &UntrustedToolAnnotations,
) -> BTreeSet<ToolEffect> {
    let trusted_floor = if explicitly_trusted_read {
        BTreeSet::from([ToolEffect::Read])
    } else {
        BTreeSet::from([ToolEffect::Read, ToolEffect::Write])
    };
    conservative_effects(&trusted_floor, annotations)
}

fn validate_schema(schema: &Value) -> Result<(), McpError> {
    super::schema::validate_schema(schema)
        .map_err(|_| runtime_error("MCP tool schema exceeded safety limits"))?;
    jsonschema::draft202012::new(schema)
        .map(|_| ())
        .map_err(|_| runtime_error("MCP tool schema is invalid"))
}

fn validate_instance(schema: &Value, instance: &Value, kind: &str) -> Result<(), McpError> {
    let validator = jsonschema::draft202012::new(schema)
        .map_err(|_| runtime_error("MCP tool schema is invalid"))?;
    if validator.is_valid(instance) {
        Ok(())
    } else {
        Err(runtime_error(format!(
            "MCP tool {kind} failed schema validation"
        )))
    }
}

fn validate_arguments(arguments: &Value) -> Result<[u8; 32], McpError> {
    if !arguments.is_object() {
        return Err(runtime_error("MCP tool arguments must be an object"));
    }
    let bytes = serde_json::to_vec(arguments)
        .map_err(|_| runtime_error("MCP tool arguments could not be serialized"))?;
    if bytes.len() > ExecutionLimits::default().input_bytes {
        return Err(McpError::resource(
            "MCP tool arguments exceeded the input limit",
        ));
    }
    Ok(Sha256::digest(bytes).into())
}

fn validate_tool_call_id(tool_call_id: &str) -> Result<(), McpError> {
    if tool_call_id.is_empty()
        || tool_call_id.len() > MAX_TOOL_CALL_ID_BYTES
        || tool_call_id.chars().any(char::is_control)
    {
        return Err(runtime_error("invalid MCP tool call id"));
    }
    Ok(())
}

fn validate_hex_id(id: &str) -> Result<(), McpError> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(runtime_error("invalid MCP snapshot id"));
    }
    Ok(())
}

fn outcome_value(outcome: &ToolCallOutcome) -> &Value {
    match outcome {
        ToolCallOutcome::Complete(value) | ToolCallOutcome::InputRequired(value) => value,
    }
}

fn prune_expired(inner: &mut RuntimeInner, now: u64) {
    let expired: BTreeSet<String> = inner
        .snapshots
        .iter()
        .filter(|(_, snapshot)| snapshot.view.expires_at_ms <= now)
        .map(|(id, _)| id.clone())
        .collect();
    for id in &expired {
        inner.snapshots.remove(id);
    }
    inner
        .pending
        .retain(|_, pending| !expired.contains(&pending.snapshot_id));
    inner
        .approved
        .retain(|_, approved| !expired.contains(&approved.snapshot_id));
    inner.grants.prune_retired();
}

fn push_audit(
    inner: &mut RuntimeInner,
    tool_name: &str,
    decision: &'static str,
    duration_ms: u64,
    result: &'static str,
) {
    inner.audit_counter = inner.audit_counter.saturating_add(1);
    if inner.audit.len() >= MAX_AUDIT {
        inner.audit.pop_front();
    }
    inner.audit.push_back(McpToolAuditEntry {
        id: inner.audit_counter.to_string(),
        origin: "mcp",
        tool_name: tool_name.to_owned(),
        decision,
        duration_ms,
        result,
    });
}

fn random_id() -> Result<String, McpError> {
    Ok(hex::encode(random_bytes()?))
}

fn random_bytes() -> Result<[u8; 32], McpError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| runtime_error("secure randomness is unavailable"))?;
    Ok(bytes)
}

fn now_ms() -> Result<u64, McpError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| runtime_error("system clock is invalid"))?
        .as_millis();
    u64::try_from(millis).map_err(|_| runtime_error("system clock is out of range"))
}

fn runtime_error(message: impl AsRef<str>) -> McpError {
    McpError::new(McpErrorKind::Protocol, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use voktty_tool_policy::{ToolIdentity, ToolOrigin};

    fn descriptor(effects: BTreeSet<ToolEffect>) -> ToolDescriptor {
        ToolDescriptor {
            identity: ToolIdentity::new(ToolOrigin::Mcp, "docs", "publish").unwrap(),
            description: "Publish docs".into(),
            effects,
            scope: CapabilityScope {
                host: Some("https://example.test:443".into()),
                ..CapabilityScope::default()
            },
            limits: ExecutionLimits::default(),
        }
    }

    #[test]
    fn only_exact_read_effects_are_automatic() {
        let annotations = UntrustedToolAnnotations {
            read_only_hint: Some(true),
            ..UntrustedToolAnnotations::default()
        };
        let read = classify_effects(true, &annotations);
        let write = classify_effects(false, &annotations);
        assert_eq!(read, BTreeSet::from([ToolEffect::Read]));
        assert!(write.contains(&ToolEffect::Write));
    }

    #[test]
    fn annotations_alone_never_grant_automatic_execution() {
        let annotations = UntrustedToolAnnotations {
            read_only_hint: Some(true),
            destructive_hint: Some(false),
            ..UntrustedToolAnnotations::default()
        };
        assert!(classify_effects(false, &annotations).contains(&ToolEffect::Write));
    }

    #[test]
    fn cancellation_before_dispatch_is_remembered_once() {
        let state = RuntimeState::default();
        {
            let mut inner = state.lock().unwrap();
            inner.cancelled_before_start.insert("call-1".into());
            assert!(inner.cancelled_before_start.remove("call-1"));
            assert!(!inner.cancelled_before_start.remove("call-1"));
        }
    }

    #[test]
    fn grants_are_bound_to_the_exact_request_and_single_use() {
        let descriptor = descriptor(BTreeSet::from([ToolEffect::Read, ToolEffect::Write]));
        let request = CapabilityRequest::from(&descriptor);
        let mut policy = CapabilityPolicy::new();
        policy
            .register(ToolRule {
                descriptor,
                mode: ExecutionMode::ApprovalRequired,
            })
            .unwrap();
        let id = ApprovalGrantId::from_bytes([7; 32]);
        let mut ledger = GrantLedger::default();
        ledger
            .issue(id.clone(), &request, &policy, 10, 100)
            .unwrap();
        ledger.consume(&id, &request, 20).unwrap();
        assert!(ledger.consume(&id, &request, 30).is_err());
    }

    #[test]
    fn approval_binding_rejects_snapshot_tool_and_input_substitution() {
        let binding = ApprovalBinding {
            snapshot_id: "snapshot-a".into(),
            tool_name: "mcp__docs__publish".into(),
            input_digest: [3; 32],
            grant_id: ApprovalGrantId::from_bytes([7; 32]),
        };

        assert!(binding.matches("snapshot-a", "mcp__docs__publish", &[3; 32]));
        assert!(!binding.matches("snapshot-b", "mcp__docs__publish", &[3; 32]));
        assert!(!binding.matches("snapshot-a", "mcp__docs__delete", &[3; 32]));
        assert!(!binding.matches("snapshot-a", "mcp__docs__publish", &[4; 32]));
    }

    #[test]
    fn schema_validation_rejects_invalid_input_and_output() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "ok": { "type": "boolean" } },
            "required": ["ok"],
            "additionalProperties": false
        });
        assert!(validate_instance(&schema, &serde_json::json!({ "ok": true }), "input").is_ok());
        assert!(validate_instance(&schema, &serde_json::json!({ "ok": "yes" }), "output").is_err());
    }

    #[test]
    fn audit_serialization_contains_no_arguments_or_content() {
        let entry = McpToolAuditEntry {
            id: "1".into(),
            origin: "mcp",
            tool_name: "mcp__docs__publish__digest".into(),
            decision: "allow",
            duration_ms: 5,
            result: "success",
        };
        let serialized = serde_json::to_value(entry).unwrap();
        assert!(serialized.get("arguments").is_none());
        assert!(serialized.get("content").is_none());
    }
}
