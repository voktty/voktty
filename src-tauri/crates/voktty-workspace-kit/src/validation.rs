use crate::document::{has_control, js_trim, parse_document};
use crate::template::placeholder_regex;
use crate::{resource, Issue, KitResult};
use jsonschema::error::ValidationErrorKind;
use jsonschema::paths::LocationSegment;
use jsonschema::{Draft, Retrieve, Uri, Validator};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PathCase {
    Sensitive,
    Insensitive,
}

struct NoExternalReferences;

impl Retrieve for NoExternalReferences {
    fn retrieve(
        &self,
        _uri: &Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Err("External kit schema references are disabled".into())
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Contract {
    Kit,
    Roster,
    Adapter,
    Lock,
    MemoryUse,
    MemoryIdentity,
    MemoryScope,
    MemoryInstructions,
    MemoryContext,
}

fn validator(contract: Contract) -> KitResult<&'static Validator> {
    static KIT: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static ROSTER: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static ADAPTER: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static LOCK: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static MEMORY_USE: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static MEMORY_IDENTITY: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static MEMORY_SCOPE: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static MEMORY_INSTRUCTIONS: OnceLock<Result<Validator, ()>> = OnceLock::new();
    static MEMORY_CONTEXT: OnceLock<Result<Validator, ()>> = OnceLock::new();
    let cache = match contract {
        Contract::Kit => &KIT,
        Contract::Roster => &ROSTER,
        Contract::Adapter => &ADAPTER,
        Contract::Lock => &LOCK,
        Contract::MemoryUse => &MEMORY_USE,
        Contract::MemoryIdentity => &MEMORY_IDENTITY,
        Contract::MemoryScope => &MEMORY_SCOPE,
        Contract::MemoryInstructions => &MEMORY_INSTRUCTIONS,
        Contract::MemoryContext => &MEMORY_CONTEXT,
    };
    cache
        .get_or_init(|| {
            let text = match contract {
                Contract::Kit => resource("dot-voktty/kit.schema.json").ok_or(())?,
                Contract::Roster | Contract::Adapter => {
                    resource("dot-voktty/team/agents.schema.json").ok_or(())?
                }
                Contract::Lock => include_str!(
                    "../../../../templates/workspace-kit/contracts/kit-lock.schema.json"
                ),
                Contract::MemoryUse => include_str!(
                    "../../../../templates/workspace-kit/contracts/memory-use.schema.json"
                ),
                Contract::MemoryIdentity => include_str!(
                    "../../../../templates/workspace-kit/contracts/memory-identity.schema.json"
                ),
                Contract::MemoryScope => include_str!(
                    "../../../../templates/workspace-kit/contracts/memory-scope.schema.json"
                ),
                Contract::MemoryInstructions | Contract::MemoryContext => include_str!(
                    "../../../../templates/workspace-kit/contracts/memory-context.schema.json"
                ),
            };
            let mut schema: Value = serde_json::from_str(text).map_err(|_| ())?;
            if matches!(contract, Contract::Adapter) {
                schema = schema["$defs"]["adapter"].clone();
            }
            if matches!(contract, Contract::MemoryInstructions) {
                schema = serde_json::json!({"$ref":"#/$defs/instructions","$defs":schema["$defs"]});
            }
            jsonschema::options()
                .with_draft(Draft::Draft202012)
                .should_validate_formats(true)
                .with_retriever(NoExternalReferences)
                .build(&schema)
                .map_err(|_| ())
        })
        .as_ref()
        .map_err(|_| vec![Issue::new("KIT_SCHEMA_INVALID", vec![])])
}

pub(crate) fn validate_structure(value: &Value, contract: Contract) -> KitResult<()> {
    let issues: Vec<_> = validator(contract)?
        .iter_errors(value)
        .take(256)
        .map(|error| {
            let mut path: Vec<_> = error
                .instance_path()
                .iter()
                .map(|part| match part {
                    LocationSegment::Property(name) => Value::String(name.into_owned()),
                    LocationSegment::Index(index) => Value::from(index),
                })
                .collect();
            if let ValidationErrorKind::Required { property } = error.kind() {
                path.push(property.clone());
            }
            let code = if matches!(error.kind(), ValidationErrorKind::UniqueItems)
                && path == [Value::from("policies"), Value::from("messages")]
            {
                "KIT_MESSAGES_DUPLICATE"
            } else {
                "KIT_SCHEMA_VALIDATION"
            };
            Issue::new(code, path)
        })
        .collect();
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

pub fn parse_kit_config(text: &str) -> KitResult<Value> {
    let config = parse_document(text)?;
    validate_structure(&config, Contract::Kit)?;
    let mut issues = Vec::new();
    let project = config["project"].as_str().unwrap_or_default();
    if js_trim(project).is_empty() {
        issues.push(Issue::new("KIT_PROJECT_BLANK", vec!["project".into()]));
    }
    if project.contains('\0') || placeholder_regex().is_match(project) {
        issues.push(Issue::new("KIT_PROJECT_INVALID", vec!["project".into()]));
    }
    if let Some(values) = config.get("values").and_then(Value::as_object) {
        if !validator(Contract::Adapter)?.is_valid(&values["default_runtime"]) {
            issues.push(Issue::new(
                "KIT_ADAPTER_UNKNOWN",
                vec!["values".into(), "default_runtime".into()],
            ));
        }
        for (key, value) in values {
            let text = value.as_str().unwrap_or_default();
            if text.len() > 16 * 1024 || text.contains('\0') || placeholder_regex().is_match(text) {
                issues.push(Issue::new(
                    "KIT_VALUE_INVALID",
                    vec!["values".into(), key.clone().into()],
                ));
            }
        }
        for (key, field) in [
            ("project_name", "project"),
            ("language", "language"),
            ("created_at", "createdAt"),
            ("kit_version", "kitVersion"),
        ] {
            if values[key] != config[field] {
                issues.push(Issue::new(
                    "KIT_VALUE_MISMATCH",
                    vec!["values".into(), key.into()],
                ));
            }
        }
    }
    if issues.is_empty() {
        Ok(config)
    } else {
        Err(issues)
    }
}

fn ownership_key(path: &str, path_case: PathCase) -> String {
    let normalized = path
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/");
    match path_case {
        PathCase::Sensitive => normalized,
        PathCase::Insensitive => normalized.to_lowercase(),
    }
}

fn overlaps(left: &str, right: &str) -> bool {
    left.is_empty()
        || right.is_empty()
        || left == right
        || left.starts_with(&format!("{right}/"))
        || right.starts_with(&format!("{left}/"))
}

fn runtime_path(index: usize, field: &str) -> Vec<Value> {
    vec![
        "agents".into(),
        index.into(),
        "runtime".into(),
        field.into(),
    ]
}

pub fn parse_agent_roster(text: &str, path_case: PathCase) -> KitResult<Value> {
    let roster = parse_document(text)?;
    validate_structure(&roster, Contract::Roster)?;
    let mut issues = Vec::new();
    let mut names = BTreeSet::new();
    let mut ownership: Vec<(String, usize)> = Vec::new();
    for (index, agent) in roster["agents"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        if !names.insert(agent["name"].as_str().unwrap_or_default()) {
            issues.push(Issue::new(
                "KIT_AGENT_DUPLICATE_NAME",
                vec!["agents".into(), index.into(), "name".into()],
            ));
        }
        let mut runtime = roster
            .pointer("/defaults/runtime")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if let Some(own) = agent.get("runtime").and_then(Value::as_object) {
            runtime.extend(own.clone());
        }
        let adapter = runtime.get("adapter").and_then(Value::as_str);
        if adapter.is_none() {
            issues.push(Issue::new(
                "KIT_AGENT_ADAPTER_REQUIRED",
                runtime_path(index, "adapter"),
            ));
        }
        let command = runtime.get("command").and_then(Value::as_str);
        if adapter == Some("generic") && command.is_none_or(|text| js_trim(text).is_empty()) {
            issues.push(Issue::new(
                "KIT_GENERIC_COMMAND_REQUIRED",
                runtime_path(index, "command"),
            ));
        }
        if command.is_some() && adapter != Some("generic") {
            issues.push(Issue::new(
                "KIT_COMMAND_FOR_GENERIC_ONLY",
                runtime_path(index, "command"),
            ));
        }
        for (key, value) in &runtime {
            if value.as_str().is_some_and(has_control) {
                issues.push(Issue::new(
                    "KIT_RUNTIME_CONTROL_CHAR",
                    runtime_path(index, key),
                ));
            }
        }
        if agent
            .get("workdir")
            .and_then(Value::as_str)
            .is_some_and(has_control)
        {
            issues.push(Issue::new(
                "KIT_PATH_CONTROL_CHAR",
                vec!["agents".into(), index.into(), "workdir".into()],
            ));
        }
        for field in ["owns", "reads"] {
            for (offset, value) in agent
                .get(field)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let path = vec!["agents".into(), index.into(), field.into(), offset.into()];
                let text = value.as_str().unwrap_or_default();
                if has_control(text) {
                    issues.push(Issue::new("KIT_PATH_CONTROL_CHAR", path.clone()));
                }
                if field == "owns" {
                    let key = ownership_key(text, path_case);
                    if ownership
                        .iter()
                        .any(|(other, owner)| *owner != index && overlaps(other, &key))
                    {
                        issues.push(Issue::new("KIT_OWNERSHIP_OVERLAP", path));
                    }
                    ownership.push((key, index));
                }
            }
        }
    }
    if issues.is_empty() {
        Ok(roster)
    } else {
        Err(issues)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_references_cannot_read_external_resources() {
        let schema = serde_json::json!({"$ref": "file:///unavailable-workspace-kit-schema"});
        assert!(jsonschema::options()
            .with_retriever(NoExternalReferences)
            .build(&schema)
            .is_err());
    }
}
