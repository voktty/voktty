use crate::document::parse_document;
use crate::validation::{validate_structure, Contract};
use crate::{Issue, KitResult};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUseDecision {
    pub schema: u8,
    pub policy: &'static str,
    pub context_allowed: bool,
    pub capture_allowed: bool,
    pub reason: &'static str,
}

pub fn evaluate_memory_use(text: &str) -> KitResult<MemoryUseDecision> {
    if text.len() > 16 * 1024 {
        return Err(vec![Issue::new("KIT_DOCUMENT_TOO_LARGE", vec![])]);
    }
    let facts = parse_document(text)?;
    validate_structure(&facts, Contract::MemoryUse)?;
    let state = facts["kitState"].as_str().unwrap_or_default();
    if state == "ready" && facts["instructionDigest"].is_null() {
        return Err(vec![Issue::new(
            "KIT_MEMORY_DIGEST_REQUIRED",
            vec!["instructionDigest".into()],
        )]);
    }
    let policy = if facts["localPolicy"]["projectKey"] == facts["projectKey"] {
        match facts["localPolicy"]["mode"].as_str() {
            Some("always") => "always",
            Some("never") => "never",
            _ => "manual",
        }
    } else {
        "manual"
    };
    let session = if facts["session"]["projectKey"] == facts["projectKey"]
        && facts["session"]["sessionId"] == facts["sessionId"]
    {
        &facts["session"]
    } else {
        &Value::Null
    };
    let deny = |reason| MemoryUseDecision {
        schema: 1,
        policy,
        context_allowed: false,
        capture_allowed: false,
        reason,
    };
    let unavailable = match state {
        "absent" => Some("KIT_MEMORY_ABSENT"),
        "reserved" => Some("KIT_MEMORY_RESERVED"),
        "partial" => Some("KIT_MEMORY_PARTIAL"),
        "denied" => Some("KIT_MEMORY_DENIED"),
        "invalid" => Some("KIT_MEMORY_INVALID"),
        "ambiguous" => Some("KIT_MEMORY_AMBIGUOUS"),
        "incomplete" => Some("KIT_MEMORY_INCOMPLETE"),
        _ => None,
    };
    if let Some(reason) = unavailable {
        return Ok(deny(reason));
    }
    if policy == "never" {
        return Ok(deny("KIT_MEMORY_POLICY_NEVER"));
    }
    if session["context"] == "disabled" {
        return Ok(deny("KIT_MEMORY_SESSION_DISABLED"));
    }
    if session["context"] != "enabled" && policy != "always" {
        return Ok(deny("KIT_MEMORY_CONSENT_REQUIRED"));
    }
    if facts["trust"]["projectKey"] != facts["projectKey"] {
        return Ok(deny("KIT_MEMORY_TRUST_REQUIRED"));
    }
    if facts["trust"]["instructionDigest"] != facts["instructionDigest"] {
        return Ok(deny("KIT_MEMORY_INSTRUCTIONS_CHANGED"));
    }
    if facts["capabilities"]["context"] != true {
        return Ok(deny("KIT_MEMORY_CONTEXT_UNSUPPORTED"));
    }
    Ok(MemoryUseDecision {
        schema: 1,
        policy,
        context_allowed: true,
        capture_allowed: session["captures"] == true && facts["capabilities"]["capture"] == true,
        reason: "KIT_MEMORY_READY",
    })
}
