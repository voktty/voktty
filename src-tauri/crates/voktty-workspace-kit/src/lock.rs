use crate::document::parse_document;
use crate::validation::{validate_structure, Contract};
use crate::{
    plan_deployment, DeploymentAction, DeploymentEntry, DeploymentPlan, DeploymentReason, FileKind,
    Issue, KitResult, PathFact, RenderedFile, RootLinks,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct BaseIntegrity {
    pub path: String,
    pub version: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct KitLock {
    pub schema: u8,
    pub bases: Vec<BaseIntegrity>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreparedDeployment {
    #[serde(flatten)]
    pub plan: DeploymentPlan,
    pub lock: Option<KitLock>,
}

pub fn parse_kit_lock(text: &str) -> KitResult<KitLock> {
    if text.len() > 64 * 1024 {
        return Err(vec![Issue::new("KIT_DOCUMENT_TOO_LARGE", vec![])]);
    }
    let mut value = parse_document(text)?;
    validate_structure(&value, Contract::Lock)?;
    value["schema"] = 1.into();
    let lock: KitLock = serde_json::from_value(value)
        .map_err(|_| vec![Issue::new("KIT_SCHEMA_VALIDATION", vec![])])?;
    let mut seen = BTreeSet::new();
    let mut issues = Vec::new();
    for (index, base) in lock.bases.iter().enumerate() {
        let parts: Vec<_> = base.path.split('/').collect();
        let path = vec!["bases".into(), index.into(), "path".into()];
        if parts.iter().any(|part| matches!(*part, "." | ".."))
            || matches!(
                parts[1].to_ascii_lowercase().as_str(),
                "state"
                    | "mailbox"
                    | "locks"
                    | "sessions"
                    | "tasks"
                    | "tasks.json"
                    | "tools.json"
                    | "kit.lock.json"
            )
        {
            issues.push(Issue::new("KIT_LOCK_PATH_INVALID", path.clone()));
        }
        if !seen.insert(base.path.to_ascii_lowercase()) {
            issues.push(Issue::new("KIT_LOCK_PATH_DUPLICATE", path));
        }
    }
    if issues.is_empty() {
        Ok(lock)
    } else {
        Err(issues)
    }
}

pub fn prepare_deployment(
    version: &str,
    files: &[RenderedFile],
    facts: &BTreeMap<String, PathFact>,
    links: RootLinks,
) -> KitResult<PreparedDeployment> {
    let invalid = || vec![Issue::new("KIT_LOCK_INPUT_INVALID", vec![])];
    let parts: Vec<_> = version.split('.').collect();
    if version.len() > 32
        || parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()))
        || files.len() > 128
    {
        return Err(invalid());
    }
    let mut source_bytes = 0;
    let mut observed_bytes = 0;
    for file in files {
        let selected = file.kind != FileKind::Link
            || if file.path == "AGENTS.md" {
                links.agents
            } else {
                links.claude
            };
        let observed = match facts.get(&file.path).filter(|_| selected) {
            Some(PathFact::File { text }) => text.as_str(),
            _ => "",
        };
        source_bytes += file.text.len();
        observed_bytes += observed.len();
        if file.path.len() > 256
            || file
                .path
                .split('/')
                .nth(1)
                .is_some_and(|part| part.eq_ignore_ascii_case("kit.lock.json"))
            || file.text.len() > 256 * 1024
            || observed.len() > 256 * 1024
            || source_bytes > 1024 * 1024
            || observed_bytes > 1024 * 1024
            || file.text.contains('\0')
            || observed.contains('\0')
        {
            return Err(invalid());
        }
    }
    let mut plan = plan_deployment(files, facts, links)?;
    let lock = if plan.can_publish {
        let observed = facts
            .get(".voktty/kit.lock.json")
            .ok_or_else(|| vec![Issue::new("KIT_DEPLOYMENT_OBSERVATION_MISSING", vec![])])?;
        let expected = match observed {
            PathFact::File { text } => Some(text.clone()),
            _ => None,
        };
        if expected
            .as_ref()
            .is_some_and(|text| text.len() > 64 * 1024 || text.contains('\0'))
        {
            return Err(invalid());
        }
        let bases: BTreeSet<_> = files
            .iter()
            .filter(|file| file.kind == FileKind::Base)
            .map(|file| file.path.as_str())
            .collect();
        let mut records: Vec<_> = plan
            .entries
            .iter()
            .filter(|entry| bases.contains(entry.path.as_str()))
            .map(|entry| BaseIntegrity {
                path: entry.path.clone(),
                version: version.into(),
                sha256: hex::encode(Sha256::digest(entry.proposed.as_bytes())),
            })
            .collect();
        records.sort_by(|left, right| left.path.cmp(&right.path));
        let text = serde_json::to_string(&KitLock {
            schema: 1,
            bases: records,
        })
        .map_err(|_| invalid())?;
        let lock = parse_kit_lock(&text)?;
        let proposed = format!(
            "{}\n",
            serde_json::to_string_pretty(&lock).map_err(|_| invalid())?
        );
        let (action, reason) = if matches!(observed, PathFact::Blocked) {
            (DeploymentAction::Conflict, DeploymentReason::Unavailable)
        } else if expected.is_none() {
            (DeploymentAction::Create, DeploymentReason::Missing)
        } else if expected.as_ref() == Some(&proposed) {
            (DeploymentAction::Skip, DeploymentReason::Identical)
        } else {
            (DeploymentAction::Conflict, DeploymentReason::Different)
        };
        plan.can_publish = action != DeploymentAction::Conflict;
        let position = plan
            .entries
            .iter()
            .position(|entry| entry.path == ".voktty/kit.json")
            .unwrap_or(plan.entries.len());
        plan.entries.insert(
            position,
            DeploymentEntry {
                path: ".voktty/kit.lock.json".into(),
                action,
                reason,
                expected,
                proposed,
            },
        );
        Some(lock)
    } else {
        None
    };
    Ok(PreparedDeployment { plan, lock })
}
