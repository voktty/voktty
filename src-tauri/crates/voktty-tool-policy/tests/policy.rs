use std::collections::BTreeSet;

use proptest::prelude::*;
use voktty_tool_policy::{
    conservative_effects, ApprovalGrantId, CapabilityPolicy, CapabilityRequest, CapabilityScope,
    DecisionOutcome, DecisionReason, ExecutionLimits, ExecutionMode, GrantConsumeError,
    GrantIssueError, GrantLedger, RegistrationError, ToolDescriptor, ToolEffect, ToolIdentity,
    ToolOrigin, ToolRule, UntrustedToolAnnotations, UntrustedToolMetadata, MAX_DESCRIPTION_BYTES,
    MAX_SCHEMA_BYTES,
};

fn effects(values: &[ToolEffect]) -> BTreeSet<ToolEffect> {
    values.iter().copied().collect()
}

fn identity(origin: ToolOrigin, source: &str, name: &str) -> ToolIdentity {
    ToolIdentity::new(origin, source, name).expect("valid identity")
}

fn workspace_scope(workspace_id: &str) -> CapabilityScope {
    CapabilityScope {
        workspace_id: Some(workspace_id.into()),
        ..CapabilityScope::default()
    }
}

fn descriptor(
    origin: ToolOrigin,
    source: &str,
    name: &str,
    tool_effects: &[ToolEffect],
) -> ToolDescriptor {
    ToolDescriptor {
        identity: identity(origin, source, name),
        description: "test tool".into(),
        effects: effects(tool_effects),
        scope: workspace_scope("workspace-a"),
        limits: ExecutionLimits::default(),
    }
}

fn approval_policy() -> (CapabilityPolicy, ToolDescriptor) {
    let descriptor = descriptor(
        ToolOrigin::Mcp,
        "files-server",
        "write_file",
        &[ToolEffect::Write],
    );
    let mut policy = CapabilityPolicy::new();
    policy
        .register(ToolRule {
            descriptor: descriptor.clone(),
            mode: ExecutionMode::ApprovalRequired,
        })
        .expect("register tool");
    (policy, descriptor)
}

#[test]
fn unknown_tools_are_denied() {
    let policy = CapabilityPolicy::new();
    let request = CapabilityRequest::from(&descriptor(
        ToolOrigin::Mcp,
        "unknown",
        "read",
        &[ToolEffect::Read],
    ));

    let decision = policy.decide(&request);

    assert_eq!(decision.outcome, DecisionOutcome::Deny);
    assert_eq!(decision.reason, DecisionReason::UnknownTool);
}

#[test]
fn exact_bounded_read_can_be_automatic() {
    let descriptor = descriptor(
        ToolOrigin::Builtin,
        "voktty",
        "read_file",
        &[ToolEffect::Read],
    );
    let request = CapabilityRequest::from(&descriptor);
    let mut policy = CapabilityPolicy::new();
    policy
        .register(ToolRule {
            descriptor,
            mode: ExecutionMode::Automatic,
        })
        .expect("register tool");

    let decision = policy.decide(&request);

    assert_eq!(decision.outcome, DecisionOutcome::Allow);
    assert_eq!(decision.reason, DecisionReason::RuleAllows);
}

#[test]
fn sensitive_effects_cannot_be_registered_as_automatic() {
    let mut policy = CapabilityPolicy::new();
    let result = policy.register(ToolRule {
        descriptor: descriptor(
            ToolOrigin::Builtin,
            "voktty",
            "run_command",
            &[ToolEffect::Process],
        ),
        mode: ExecutionMode::Automatic,
    });

    assert_eq!(result, Err(RegistrationError::AutomaticSensitiveEffect));
}

#[test]
fn unscoped_reads_cannot_be_registered_as_automatic() {
    let mut unscoped = descriptor(
        ToolOrigin::Builtin,
        "voktty",
        "read_environment",
        &[ToolEffect::Read],
    );
    unscoped.scope = CapabilityScope::default();
    let mut policy = CapabilityPolicy::new();

    let result = policy.register(ToolRule {
        descriptor: unscoped,
        mode: ExecutionMode::Automatic,
    });

    assert_eq!(result, Err(RegistrationError::AutomaticUnscoped));
}

#[test]
fn deserialized_namespace_spoofing_is_rejected() {
    let mut value = serde_json::to_value(descriptor(
        ToolOrigin::Mcp,
        "files-server",
        "read_file",
        &[ToolEffect::Read],
    ))
    .expect("serialize descriptor");
    value["identity"]["namespacedName"] = "builtin__voktty__read_file__spoofed".into();
    let spoofed: ToolDescriptor = serde_json::from_value(value).expect("deserialize descriptor");
    let mut policy = CapabilityPolicy::new();

    let result = policy.register(ToolRule {
        descriptor: spoofed,
        mode: ExecutionMode::ApprovalRequired,
    });

    assert!(matches!(
        result,
        Err(RegistrationError::InvalidDescriptor(_))
    ));
}

#[test]
fn untrusted_annotations_can_add_but_never_remove_effects() {
    let trusted = effects(&[ToolEffect::Read, ToolEffect::Secret]);
    let annotations = UntrustedToolAnnotations {
        read_only_hint: Some(true),
        destructive_hint: Some(false),
        idempotent_hint: Some(true),
        open_world_hint: Some(true),
    };

    let classified = conservative_effects(&trusted, &annotations);

    assert!(classified.is_superset(&trusted));
    assert!(classified.contains(&ToolEffect::Network));
}

#[test]
fn oversized_external_metadata_is_rejected() {
    let description = "x".repeat(MAX_DESCRIPTION_BYTES + 1);
    let input_schema = vec![b'x'; MAX_SCHEMA_BYTES];

    assert!(UntrustedToolMetadata::measure(description, &input_schema, None, &[]).is_err());
}

#[test]
fn execution_limit_escalation_is_denied() {
    let (policy, descriptor) = approval_policy();
    let mut request = CapabilityRequest::from(&descriptor);
    request.limits.timeout_ms += 1;

    let decision = policy.decide(&request);

    assert_eq!(decision.outcome, DecisionOutcome::Deny);
    assert_eq!(decision.reason, DecisionReason::LimitEscalation);
}

#[test]
fn a_mismatched_grant_is_not_consumed() {
    let (policy, descriptor) = approval_policy();
    let request = CapabilityRequest::from(&descriptor);
    let id = ApprovalGrantId::from_bytes([7; 32]);
    let mut grants = GrantLedger::default();
    grants
        .issue(id.clone(), &request, &policy, 1_000, 10_000)
        .expect("issue grant");
    let mut wrong_scope = request.clone();
    wrong_scope.scope.workspace_id = Some("workspace-b".into());

    let mismatch = grants.consume(&id, &wrong_scope, 2_000);
    let valid = grants.consume(&id, &request, 2_001);

    assert_eq!(mismatch, Err(GrantConsumeError::BindingMismatch));
    assert_eq!(valid, Ok(()));
}

#[test]
fn automatic_policies_cannot_issue_grants() {
    let descriptor = descriptor(
        ToolOrigin::Builtin,
        "voktty",
        "read_file",
        &[ToolEffect::Read],
    );
    let request = CapabilityRequest::from(&descriptor);
    let mut policy = CapabilityPolicy::new();
    policy
        .register(ToolRule {
            descriptor,
            mode: ExecutionMode::Automatic,
        })
        .expect("register tool");
    let mut grants = GrantLedger::default();

    let result = grants.issue(
        ApprovalGrantId::from_bytes([3; 32]),
        &request,
        &policy,
        1_000,
        10_000,
    );

    assert_eq!(result, Err(GrantIssueError::DecisionDoesNotRequireApproval));
}

#[test]
fn retired_grants_can_be_pruned_without_becoming_authorized() {
    let (policy, descriptor) = approval_policy();
    let request = CapabilityRequest::from(&descriptor);
    let first = ApprovalGrantId::from_bytes([4; 32]);
    let second = ApprovalGrantId::from_bytes([5; 32]);
    let mut grants = GrantLedger::new(1);
    grants
        .issue(first.clone(), &request, &policy, 1_000, 10_000)
        .expect("issue first grant");
    grants
        .consume(&first, &request, 2_000)
        .expect("consume first grant");

    grants
        .issue(second, &request, &policy, 2_001, 10_000)
        .expect("retired grant was pruned");

    assert_eq!(
        grants.consume(&first, &request, 2_002),
        Err(GrantConsumeError::UnknownGrant)
    );
}

#[test]
fn rust_and_typescript_dto_names_are_stable() {
    let descriptor = descriptor(
        ToolOrigin::Extension,
        "sample.extension",
        "format_document",
        &[ToolEffect::Write],
    );
    let json = serde_json::to_value(descriptor).expect("serialize descriptor");

    assert_eq!(json["identity"]["origin"], "extension");
    assert_eq!(json["limits"]["timeoutMs"], 30_000);
    assert_eq!(json["scope"]["workspaceId"], "workspace-a");
}

prop_compose! {
    fn valid_segment()(value in "[A-Za-z0-9_.:/-]{1,40}") -> String {
        value
    }
}

prop_compose! {
    fn grant_id()(bytes in any::<[u8; 32]>()) -> ApprovalGrantId {
        ApprovalGrantId::from_bytes(bytes)
    }
}

proptest! {
    #[test]
    fn distinct_identities_do_not_share_a_namespace(
        source_a in valid_segment(),
        name_a in valid_segment(),
        source_b in valid_segment(),
        name_b in valid_segment(),
    ) {
        prop_assume!((source_a.as_str(), name_a.as_str()) != (source_b.as_str(), name_b.as_str()));
        let first = identity(ToolOrigin::Mcp, &source_a, &name_a);
        let second = identity(ToolOrigin::Mcp, &source_b, &name_b);

        prop_assert_ne!(first.namespaced_name, second.namespaced_name);
    }

    #[test]
    fn annotations_never_reduce_the_trusted_effect_floor(
        read_only in any::<Option<bool>>(),
        destructive in any::<Option<bool>>(),
        idempotent in any::<Option<bool>>(),
        open_world in any::<Option<bool>>(),
    ) {
        let trusted = effects(&[ToolEffect::Read, ToolEffect::Secret]);
        let classified = conservative_effects(
            &trusted,
            &UntrustedToolAnnotations {
                read_only_hint: read_only,
                destructive_hint: destructive,
                idempotent_hint: idempotent,
                open_world_hint: open_world,
            },
        );

        prop_assert!(classified.is_superset(&trusted));
    }

    #[test]
    fn effect_omission_or_escalation_is_denied(candidate in prop::collection::btree_set(0u8..7, 1..8)) {
        let (policy, descriptor) = approval_policy();
        let mut request = CapabilityRequest::from(&descriptor);
        request.effects = candidate
            .into_iter()
            .map(|effect| match effect {
                0 => ToolEffect::Read,
                1 => ToolEffect::Write,
                2 => ToolEffect::Process,
                3 => ToolEffect::Network,
                4 => ToolEffect::Secret,
                5 => ToolEffect::Publish,
                _ => ToolEffect::Delete,
            })
            .collect();
        prop_assume!(request.effects != descriptor.effects);

        let decision = policy.decide(&request);

        prop_assert_eq!(decision.outcome, DecisionOutcome::Deny);
        prop_assert_eq!(decision.reason, DecisionReason::EffectMismatch);
    }

    #[test]
    fn changing_any_workspace_scope_is_denied(workspace in valid_segment()) {
        prop_assume!(workspace != "workspace-a");
        let (policy, descriptor) = approval_policy();
        let mut request = CapabilityRequest::from(&descriptor);
        request.scope.workspace_id = Some(workspace);

        let decision = policy.decide(&request);

        prop_assert_eq!(decision.outcome, DecisionOutcome::Deny);
        prop_assert_eq!(decision.reason, DecisionReason::ScopeMismatch);
    }

    #[test]
    fn adding_an_unapproved_scope_dimension_is_denied(
        value in valid_segment(),
        dimension in 0u8..4,
    ) {
        let (policy, descriptor) = approval_policy();
        let mut request = CapabilityRequest::from(&descriptor);
        match dimension {
            0 => request.scope.host = Some(value),
            1 => request.scope.resource = Some(value),
            2 => request.scope.session_id = Some(value),
            _ => request.scope.agent_id = Some(value),
        }

        let decision = policy.decide(&request);

        prop_assert_eq!(decision.outcome, DecisionOutcome::Deny);
        prop_assert_eq!(decision.reason, DecisionReason::ScopeMismatch);
    }

    #[test]
    fn an_approval_grant_is_consumed_exactly_once(id in grant_id()) {
        let (policy, descriptor) = approval_policy();
        let request = CapabilityRequest::from(&descriptor);
        let mut grants = GrantLedger::default();
        grants.issue(id.clone(), &request, &policy, 1_000, 10_000).expect("issue grant");

        let first = grants.consume(&id, &request, 2_000);
        let replay = grants.consume(&id, &request, 2_001);

        prop_assert_eq!(first, Ok(()));
        prop_assert_eq!(replay, Err(GrantConsumeError::AlreadyConsumed));
    }
}
