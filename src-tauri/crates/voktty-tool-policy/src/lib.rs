//! Pure capability policy contracts for every Voktty tool runtime.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_IDENTITY_COMPONENT_BYTES: usize = 128;
pub const MAX_NAMESPACED_NAME_BYTES: usize = 128;
pub const MAX_DESCRIPTION_BYTES: usize = 4 * 1024;
pub const MAX_SCHEMA_BYTES: usize = 256 * 1024;
pub const MAX_ANNOTATIONS_BYTES: usize = 64 * 1024;
pub const MAX_SCOPE_COMPONENT_BYTES: usize = 1024;
pub const MAX_TIMEOUT_MS: u64 = 5 * 60 * 1000;
pub const MAX_INPUT_BYTES: usize = 64 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 512 * 1024;
pub const MAX_CONCURRENCY: u16 = 4;
pub const MAX_CALLS_PER_MINUTE: u16 = 60;
pub const MAX_GRANT_TTL_MS: u64 = 5 * 60 * 1000;
pub const DEFAULT_GRANT_CAPACITY: usize = 256;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolOrigin {
    Builtin,
    Extension,
    Mcp,
}

impl ToolOrigin {
    fn namespace(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::Extension => "extension",
            Self::Mcp => "mcp",
        }
    }

    fn discriminator(self) -> u8 {
        match self {
            Self::Builtin => 1,
            Self::Extension => 2,
            Self::Mcp => 3,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolIdentity {
    pub origin: ToolOrigin,
    pub source_id: String,
    pub name: String,
    pub namespaced_name: String,
}

impl ToolIdentity {
    pub fn new(
        origin: ToolOrigin,
        source_id: impl Into<String>,
        name: impl Into<String>,
    ) -> Result<Self, IdentityError> {
        let source_id = source_id.into();
        let name = name.into();
        validate_identity_component(&source_id)?;
        validate_identity_component(&name)?;
        let namespaced_name = build_namespaced_name(origin, &source_id, &name);
        let identity = Self {
            origin,
            source_id,
            name,
            namespaced_name,
        };
        identity.validate()?;
        Ok(identity)
    }

    pub fn validate(&self) -> Result<(), IdentityError> {
        validate_identity_component(&self.source_id)?;
        validate_identity_component(&self.name)?;
        let expected = build_namespaced_name(self.origin, &self.source_id, &self.name);
        if self.namespaced_name != expected {
            return Err(IdentityError::NamespaceMismatch);
        }
        if self.namespaced_name.len() > MAX_NAMESPACED_NAME_BYTES {
            return Err(IdentityError::NamespaceTooLarge);
        }
        Ok(())
    }

    pub fn digest(&self) -> String {
        hex_encode(&identity_digest_bytes(
            self.origin,
            &self.source_id,
            &self.name,
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IdentityError {
    EmptyComponent,
    ComponentTooLarge,
    InvalidComponent,
    NamespaceMismatch,
    NamespaceTooLarge,
}

fn validate_identity_component(value: &str) -> Result<(), IdentityError> {
    if value.is_empty() {
        return Err(IdentityError::EmptyComponent);
    }
    if value.len() > MAX_IDENTITY_COMPONENT_BYTES {
        return Err(IdentityError::ComponentTooLarge);
    }
    if value.trim() != value || value.chars().any(char::is_control) {
        return Err(IdentityError::InvalidComponent);
    }
    Ok(())
}

fn build_namespaced_name(origin: ToolOrigin, source_id: &str, name: &str) -> String {
    let source = visible_slug(source_id, 24);
    let tool = visible_slug(name, 48);
    let digest = identity_digest_bytes(origin, source_id, name);
    format!(
        "{}__{}__{}__{}",
        origin.namespace(),
        source,
        tool,
        hex_encode(&digest[..16])
    )
}

fn visible_slug(value: &str, max_bytes: usize) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;
    for character in value.chars() {
        let mapped = if character.is_ascii_alphanumeric() || character == '_' {
            character
        } else {
            '_'
        };
        if mapped == '_' && last_was_separator {
            continue;
        }
        if slug.len() + mapped.len_utf8() > max_bytes {
            break;
        }
        slug.push(mapped);
        last_was_separator = mapped == '_';
    }
    let trimmed = slug.trim_matches('_');
    if trimmed.is_empty() {
        "tool".into()
    } else {
        trimmed.into()
    }
}

fn identity_digest_bytes(origin: ToolOrigin, source_id: &str, name: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([origin.discriminator()]);
    hasher.update((source_id.len() as u64).to_be_bytes());
    hasher.update(source_id.as_bytes());
    hasher.update((name.len() as u64).to_be_bytes());
    hasher.update(name.as_bytes());
    hasher.finalize().into()
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolEffect {
    Read,
    Write,
    Process,
    Network,
    Secret,
    Publish,
    Delete,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityScope {
    pub workspace_id: Option<String>,
    pub host: Option<String>,
    pub resource: Option<String>,
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
}

impl CapabilityScope {
    pub fn validate(&self) -> Result<(), ScopeError> {
        for value in [
            &self.workspace_id,
            &self.host,
            &self.resource,
            &self.session_id,
            &self.agent_id,
        ]
        .into_iter()
        .flatten()
        {
            if value.is_empty() {
                return Err(ScopeError::EmptyComponent);
            }
            if value.len() > MAX_SCOPE_COMPONENT_BYTES {
                return Err(ScopeError::ComponentTooLarge);
            }
            if value.chars().any(char::is_control) {
                return Err(ScopeError::InvalidComponent);
            }
        }
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.workspace_id.is_none()
            && self.host.is_none()
            && self.resource.is_none()
            && self.session_id.is_none()
            && self.agent_id.is_none()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScopeError {
    EmptyComponent,
    ComponentTooLarge,
    InvalidComponent,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionLimits {
    pub timeout_ms: u64,
    pub input_bytes: usize,
    pub output_bytes: usize,
    pub concurrency: u16,
    pub calls_per_minute: u16,
}

impl Default for ExecutionLimits {
    fn default() -> Self {
        Self {
            timeout_ms: 30_000,
            input_bytes: MAX_INPUT_BYTES,
            output_bytes: MAX_OUTPUT_BYTES,
            concurrency: MAX_CONCURRENCY,
            calls_per_minute: MAX_CALLS_PER_MINUTE,
        }
    }
}

impl ExecutionLimits {
    pub fn validate(&self) -> Result<(), LimitError> {
        if self.timeout_ms == 0
            || self.input_bytes == 0
            || self.output_bytes == 0
            || self.concurrency == 0
            || self.calls_per_minute == 0
        {
            return Err(LimitError::Zero);
        }
        if self.timeout_ms > MAX_TIMEOUT_MS
            || self.input_bytes > MAX_INPUT_BYTES
            || self.output_bytes > MAX_OUTPUT_BYTES
            || self.concurrency > MAX_CONCURRENCY
            || self.calls_per_minute > MAX_CALLS_PER_MINUTE
        {
            return Err(LimitError::ExceedsGlobalMaximum);
        }
        Ok(())
    }

    pub fn is_within(&self, maximum: &Self) -> bool {
        self.timeout_ms <= maximum.timeout_ms
            && self.input_bytes <= maximum.input_bytes
            && self.output_bytes <= maximum.output_bytes
            && self.concurrency <= maximum.concurrency
            && self.calls_per_minute <= maximum.calls_per_minute
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LimitError {
    Zero,
    ExceedsGlobalMaximum,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntrustedToolAnnotations {
    pub read_only_hint: Option<bool>,
    pub destructive_hint: Option<bool>,
    pub idempotent_hint: Option<bool>,
    pub open_world_hint: Option<bool>,
}

pub fn conservative_effects(
    trusted_floor: &BTreeSet<ToolEffect>,
    annotations: &UntrustedToolAnnotations,
) -> BTreeSet<ToolEffect> {
    let mut effects = trusted_floor.clone();
    if annotations.read_only_hint == Some(false) {
        effects.insert(ToolEffect::Write);
    }
    if annotations.destructive_hint == Some(true) {
        effects.insert(ToolEffect::Write);
        effects.insert(ToolEffect::Delete);
    }
    if annotations.open_world_hint == Some(true) {
        effects.insert(ToolEffect::Network);
    }
    effects
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntrustedToolMetadata {
    description: String,
    input_schema_bytes: usize,
    output_schema_bytes: Option<usize>,
    annotations_bytes: usize,
}

impl UntrustedToolMetadata {
    pub fn measure(
        description: impl Into<String>,
        input_schema: &[u8],
        output_schema: Option<&[u8]>,
        annotations: &[u8],
    ) -> Result<Self, MetadataError> {
        let metadata = Self {
            description: description.into(),
            input_schema_bytes: input_schema.len(),
            output_schema_bytes: output_schema.map(<[u8]>::len),
            annotations_bytes: annotations.len(),
        };
        metadata.validate()?;
        Ok(metadata)
    }

    fn validate(&self) -> Result<(), MetadataError> {
        if self.description.len() > MAX_DESCRIPTION_BYTES {
            return Err(MetadataError::DescriptionTooLarge);
        }
        if self.input_schema_bytes > MAX_SCHEMA_BYTES
            || self
                .output_schema_bytes
                .is_some_and(|bytes| bytes > MAX_SCHEMA_BYTES)
        {
            return Err(MetadataError::SchemaTooLarge);
        }
        if self.annotations_bytes > MAX_ANNOTATIONS_BYTES {
            return Err(MetadataError::AnnotationsTooLarge);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MetadataError {
    DescriptionTooLarge,
    SchemaTooLarge,
    AnnotationsTooLarge,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub identity: ToolIdentity,
    pub description: String,
    pub effects: BTreeSet<ToolEffect>,
    pub scope: CapabilityScope,
    pub limits: ExecutionLimits,
}

impl ToolDescriptor {
    pub fn validate(&self) -> Result<(), DescriptorError> {
        self.identity
            .validate()
            .map_err(DescriptorError::Identity)?;
        if self.description.len() > MAX_DESCRIPTION_BYTES {
            return Err(DescriptorError::DescriptionTooLarge);
        }
        if self.effects.is_empty() {
            return Err(DescriptorError::MissingEffects);
        }
        self.scope.validate().map_err(DescriptorError::Scope)?;
        self.limits.validate().map_err(DescriptorError::Limits)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DescriptorError {
    Identity(IdentityError),
    DescriptionTooLarge,
    MissingEffects,
    Scope(ScopeError),
    Limits(LimitError),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionMode {
    Automatic,
    ApprovalRequired,
    Deny,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRule {
    pub descriptor: ToolDescriptor,
    pub mode: ExecutionMode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityRequest {
    pub identity: ToolIdentity,
    pub effects: BTreeSet<ToolEffect>,
    pub scope: CapabilityScope,
    pub limits: ExecutionLimits,
}

impl From<&ToolDescriptor> for CapabilityRequest {
    fn from(descriptor: &ToolDescriptor) -> Self {
        Self {
            identity: descriptor.identity.clone(),
            effects: descriptor.effects.clone(),
            scope: descriptor.scope.clone(),
            limits: descriptor.limits,
        }
    }
}

impl CapabilityRequest {
    fn validate(&self) -> Result<(), DescriptorError> {
        self.identity
            .validate()
            .map_err(DescriptorError::Identity)?;
        if self.effects.is_empty() {
            return Err(DescriptorError::MissingEffects);
        }
        self.scope.validate().map_err(DescriptorError::Scope)?;
        self.limits.validate().map_err(DescriptorError::Limits)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DecisionOutcome {
    Allow,
    RequireApproval,
    Deny,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DecisionReason {
    RuleAllows,
    ApprovalRequired,
    RuleDenied,
    UnknownTool,
    InvalidRequest,
    EffectMismatch,
    ScopeMismatch,
    LimitEscalation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDecision {
    pub outcome: DecisionOutcome,
    pub reason: DecisionReason,
    pub effective_limits: Option<ExecutionLimits>,
}

impl CapabilityDecision {
    fn deny(reason: DecisionReason) -> Self {
        Self {
            outcome: DecisionOutcome::Deny,
            reason,
            effective_limits: None,
        }
    }

    fn accepted(
        outcome: DecisionOutcome,
        reason: DecisionReason,
        effective_limits: ExecutionLimits,
    ) -> Self {
        Self {
            outcome,
            reason,
            effective_limits: Some(effective_limits),
        }
    }
}

#[derive(Default)]
pub struct CapabilityPolicy {
    rules: BTreeMap<String, ToolRule>,
    namespaces: BTreeMap<String, String>,
}

impl CapabilityPolicy {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, rule: ToolRule) -> Result<(), RegistrationError> {
        rule.descriptor
            .validate()
            .map_err(RegistrationError::InvalidDescriptor)?;
        if rule.mode == ExecutionMode::Automatic
            && rule
                .descriptor
                .effects
                .iter()
                .any(|effect| *effect != ToolEffect::Read)
        {
            return Err(RegistrationError::AutomaticSensitiveEffect);
        }
        if rule.mode == ExecutionMode::Automatic && rule.descriptor.scope.is_empty() {
            return Err(RegistrationError::AutomaticUnscoped);
        }

        let digest = rule.descriptor.identity.digest();
        if self.rules.contains_key(&digest) {
            return Err(RegistrationError::DuplicateIdentity);
        }
        if self
            .namespaces
            .get(&rule.descriptor.identity.namespaced_name)
            .is_some_and(|owner| owner != &digest)
        {
            return Err(RegistrationError::NamespaceCollision);
        }

        self.namespaces.insert(
            rule.descriptor.identity.namespaced_name.clone(),
            digest.clone(),
        );
        self.rules.insert(digest, rule);
        Ok(())
    }

    pub fn decide(&self, request: &CapabilityRequest) -> CapabilityDecision {
        if request.validate().is_err() {
            return CapabilityDecision::deny(DecisionReason::InvalidRequest);
        }
        let Some(rule) = self.rules.get(&request.identity.digest()) else {
            return CapabilityDecision::deny(DecisionReason::UnknownTool);
        };
        if rule.descriptor.identity != request.identity {
            return CapabilityDecision::deny(DecisionReason::UnknownTool);
        }
        if rule.descriptor.effects != request.effects {
            return CapabilityDecision::deny(DecisionReason::EffectMismatch);
        }
        if rule.descriptor.scope != request.scope {
            return CapabilityDecision::deny(DecisionReason::ScopeMismatch);
        }
        if !request.limits.is_within(&rule.descriptor.limits) {
            return CapabilityDecision::deny(DecisionReason::LimitEscalation);
        }

        match rule.mode {
            ExecutionMode::Automatic => CapabilityDecision::accepted(
                DecisionOutcome::Allow,
                DecisionReason::RuleAllows,
                request.limits,
            ),
            ExecutionMode::ApprovalRequired => CapabilityDecision::accepted(
                DecisionOutcome::RequireApproval,
                DecisionReason::ApprovalRequired,
                request.limits,
            ),
            ExecutionMode::Deny => CapabilityDecision::deny(DecisionReason::RuleDenied),
        }
    }

    pub fn len(&self) -> usize {
        self.rules.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistrationError {
    InvalidDescriptor(DescriptorError),
    AutomaticSensitiveEffect,
    AutomaticUnscoped,
    DuplicateIdentity,
    NamespaceCollision,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ApprovalGrantId(String);

impl ApprovalGrantId {
    pub fn new(value: impl Into<String>) -> Result<Self, GrantIdError> {
        let id = Self(value.into());
        id.validate()?;
        Ok(id)
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(hex_encode(&bytes))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn validate(&self) -> Result<(), GrantIdError> {
        if self.0.len() != 64
            || !self
                .0
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(GrantIdError::InvalidFormat);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GrantIdError {
    InvalidFormat,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalGrantReceipt {
    pub id: ApprovalGrantId,
    pub expires_at_ms: u64,
}

#[derive(Clone)]
struct ApprovalGrant {
    id: ApprovalGrantId,
    identity_digest: String,
    effects: BTreeSet<ToolEffect>,
    scope: CapabilityScope,
    limits: ExecutionLimits,
    expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GrantState {
    Active,
    Consumed,
    Expired,
    Revoked,
}

struct GrantRecord {
    grant: ApprovalGrant,
    state: GrantState,
}

pub struct GrantLedger {
    records: BTreeMap<ApprovalGrantId, GrantRecord>,
    capacity: usize,
}

impl Default for GrantLedger {
    fn default() -> Self {
        Self::new(DEFAULT_GRANT_CAPACITY)
    }
}

impl GrantLedger {
    pub fn new(capacity: usize) -> Self {
        Self {
            records: BTreeMap::new(),
            capacity,
        }
    }

    pub fn issue(
        &mut self,
        id: ApprovalGrantId,
        request: &CapabilityRequest,
        policy: &CapabilityPolicy,
        now_ms: u64,
        ttl_ms: u64,
    ) -> Result<ApprovalGrantReceipt, GrantIssueError> {
        id.validate().map_err(GrantIssueError::InvalidId)?;
        if request.validate().is_err() {
            return Err(GrantIssueError::InvalidRequest);
        }
        let decision = policy.decide(request);
        if decision.outcome != DecisionOutcome::RequireApproval
            || decision.reason != DecisionReason::ApprovalRequired
            || decision.effective_limits != Some(request.limits)
        {
            return Err(GrantIssueError::DecisionDoesNotRequireApproval);
        }
        if ttl_ms == 0 || ttl_ms > MAX_GRANT_TTL_MS {
            return Err(GrantIssueError::InvalidTtl);
        }
        if self.records.contains_key(&id) {
            return Err(GrantIssueError::DuplicateId);
        }
        if self.records.len() >= self.capacity {
            self.prune_retired();
        }
        if self.records.len() >= self.capacity {
            return Err(GrantIssueError::CapacityExceeded);
        }
        let expires_at_ms = now_ms
            .checked_add(ttl_ms)
            .ok_or(GrantIssueError::InvalidTtl)?;
        let grant = ApprovalGrant {
            id: id.clone(),
            identity_digest: request.identity.digest(),
            effects: request.effects.clone(),
            scope: request.scope.clone(),
            limits: request.limits,
            expires_at_ms,
        };
        self.records.insert(
            id,
            GrantRecord {
                grant: grant.clone(),
                state: GrantState::Active,
            },
        );
        Ok(ApprovalGrantReceipt {
            id: grant.id,
            expires_at_ms: grant.expires_at_ms,
        })
    }

    pub fn consume(
        &mut self,
        id: &ApprovalGrantId,
        request: &CapabilityRequest,
        now_ms: u64,
    ) -> Result<(), GrantConsumeError> {
        let Some(record) = self.records.get_mut(id) else {
            return Err(GrantConsumeError::UnknownGrant);
        };
        match record.state {
            GrantState::Consumed => return Err(GrantConsumeError::AlreadyConsumed),
            GrantState::Expired => return Err(GrantConsumeError::Expired),
            GrantState::Revoked => return Err(GrantConsumeError::Revoked),
            GrantState::Active => {}
        }
        if now_ms >= record.grant.expires_at_ms {
            record.state = GrantState::Expired;
            return Err(GrantConsumeError::Expired);
        }
        if request.validate().is_err()
            || record.grant.identity_digest != request.identity.digest()
            || record.grant.effects != request.effects
            || record.grant.scope != request.scope
            || record.grant.limits != request.limits
        {
            return Err(GrantConsumeError::BindingMismatch);
        }
        record.state = GrantState::Consumed;
        Ok(())
    }

    pub fn revoke(&mut self, id: &ApprovalGrantId) -> Result<(), GrantConsumeError> {
        let Some(record) = self.records.get_mut(id) else {
            return Err(GrantConsumeError::UnknownGrant);
        };
        if record.state != GrantState::Active {
            return Err(match record.state {
                GrantState::Consumed => GrantConsumeError::AlreadyConsumed,
                GrantState::Expired => GrantConsumeError::Expired,
                GrantState::Revoked => GrantConsumeError::Revoked,
                GrantState::Active => unreachable!(),
            });
        }
        record.state = GrantState::Revoked;
        Ok(())
    }

    pub fn prune_retired(&mut self) {
        self.records
            .retain(|_, record| record.state == GrantState::Active);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GrantIssueError {
    InvalidId(GrantIdError),
    InvalidRequest,
    DecisionDoesNotRequireApproval,
    InvalidTtl,
    DuplicateId,
    CapacityExceeded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GrantConsumeError {
    UnknownGrant,
    AlreadyConsumed,
    Expired,
    Revoked,
    BindingMismatch,
}
