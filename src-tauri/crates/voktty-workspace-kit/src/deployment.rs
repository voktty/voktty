use crate::document::{js_trim, js_trim_end};
use crate::{FileKind, Issue, KitResult, RenderedFile};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const START: &str = "<!-- voktty-workspace-kit:start -->";
const END: &str = "<!-- voktty-workspace-kit:end -->";

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PathFact {
    Absent,
    File { text: String },
    Blocked,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct RootLinks {
    pub agents: bool,
    pub claude: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeploymentAction {
    Create,
    Skip,
    Conflict,
    Migrate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeploymentReason {
    Missing,
    Identical,
    Different,
    Unavailable,
    RootLink,
    PrivateIgnore,
    MissingLinkTarget,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeploymentEntry {
    pub path: String,
    pub action: DeploymentAction,
    pub reason: DeploymentReason,
    pub expected: Option<String>,
    pub proposed: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPlan {
    pub entries: Vec<DeploymentEntry>,
    pub can_publish: bool,
}

fn marker_line(text: &str, offset: usize, marker: &str) -> bool {
    let after = &text[offset + marker.len()..];
    (offset == 0 || text.as_bytes()[offset - 1] == b'\n')
        && (after.is_empty() || after.starts_with('\n') || after.starts_with("\r\n"))
}

fn append_block(current: &str, block: &str) -> String {
    let separator = if current.is_empty() {
        ""
    } else if current.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    format!("{current}{separator}{block}")
}

fn merge_agent_block(current: &str, template: &str) -> Option<String> {
    match (current.find(START), current.find(END)) {
        (None, None) => Some(append_block(current, template)),
        (Some(start), Some(end))
            if end >= start
                && !current[start + START.len()..].contains(START)
                && !current[end + END.len()..].contains(END)
                && marker_line(current, start, START)
                && marker_line(current, end, END) =>
        {
            let trimmed = js_trim_end(template);
            Some(format!(
                "{}{trimmed}{}",
                &current[..start],
                &current[end + END.len()..]
            ))
        }
        _ => None,
    }
}

fn has_claude_link(text: &str) -> bool {
    text.split('\n').any(|line| js_trim(line) == "@AGENTS.md")
}

fn private_ignore(files: &[RenderedFile]) -> String {
    let mut allowed = BTreeSet::from(["kit.lock.json".to_owned()]);
    for file in files {
        if let Some(path) = file.path.strip_prefix(".voktty/") {
            for (index, _) in path.match_indices('/') {
                allowed.insert(path[..=index].to_owned());
            }
            allowed.insert(path.to_owned());
        }
    }
    let lines: Vec<_> = allowed.iter().map(|path| format!("!/{path}")).collect();
    format!(
        "# Preserve privacy of existing and unknown .voktty data.\n*\n{}\n",
        lines.join("\n")
    )
}

fn validate_paths(files: &[RenderedFile]) -> KitResult<()> {
    let mut seen = BTreeSet::new();
    for file in files {
        let parts: Vec<_> = file.path.split('/').collect();
        let root_link =
            file.kind == FileKind::Link && matches!(file.path.as_str(), "AGENTS.md" | "CLAUDE.md");
        let reserved = parts.get(1).is_some_and(|part| {
            matches!(
                part.to_ascii_lowercase().as_str(),
                "state" | "mailbox" | "locks" | "sessions" | "tasks" | "tasks.json" | "tools.json"
            )
        });
        if (!root_link && (parts.len() < 2 || parts[0] != ".voktty" || reserved))
            || parts.iter().any(|part| {
                part.is_empty()
                    || matches!(*part, "." | "..")
                    || !part
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-'))
            })
            || !seen.insert(file.path.to_ascii_lowercase())
        {
            return Err(vec![Issue::new("KIT_DEPLOYMENT_PATH_INVALID", vec![])]);
        }
    }
    Ok(())
}

pub fn plan_deployment(
    files: &[RenderedFile],
    facts: &BTreeMap<String, PathFact>,
    links: RootLinks,
) -> KitResult<DeploymentPlan> {
    validate_paths(files)?;
    let ignore = private_ignore(files);
    let mut entries = Vec::new();
    for file in files.iter().filter(|file| {
        file.kind != FileKind::Link
            || if file.path == "AGENTS.md" {
                links.agents
            } else {
                links.claude
            }
    }) {
        let fact = facts
            .get(&file.path)
            .ok_or_else(|| vec![Issue::new("KIT_DEPLOYMENT_OBSERVATION_MISSING", vec![])])?;
        let mut entry = DeploymentEntry {
            path: file.path.clone(),
            action: DeploymentAction::Conflict,
            reason: DeploymentReason::Different,
            expected: match fact {
                PathFact::File { text } => Some(text.clone()),
                _ => None,
            },
            proposed: file.text.clone(),
        };
        if matches!(fact, PathFact::Blocked) {
            entry.reason = DeploymentReason::Unavailable;
        } else if file.path == "CLAUDE.md"
            && !links.agents
            && !matches!(fact, PathFact::File { text } if has_claude_link(text) || text.contains(".voktty/"))
            && !matches!(
                facts.get("AGENTS.md").ok_or_else(|| vec![Issue::new(
                    "KIT_DEPLOYMENT_OBSERVATION_MISSING",
                    vec![]
                )])?,
                PathFact::File { .. }
            )
        {
            entry.reason = DeploymentReason::MissingLinkTarget;
        } else if let PathFact::File { text } = fact {
            if file.path == ".voktty/.gitignore" && (js_trim(text) == "*" || text == &ignore) {
                entry.proposed = ignore.clone();
                entry.reason = DeploymentReason::PrivateIgnore;
            } else if file.path == "AGENTS.md" {
                if let Some(merged) = merge_agent_block(text, &file.text) {
                    entry.proposed = merged;
                    entry.reason = DeploymentReason::RootLink;
                } else {
                    entries.push(entry);
                    continue;
                }
            } else if file.path == "CLAUDE.md" {
                entry.proposed = if has_claude_link(text) || text.contains(".voktty/") {
                    text.clone()
                } else {
                    // The existing TS contract appends two newlines even to an empty file.
                    format!(
                        "{text}{}{}",
                        if text.ends_with('\n') { "\n" } else { "\n\n" },
                        file.text
                    )
                };
                entry.reason = DeploymentReason::RootLink;
            }
            entry.action = if text == &entry.proposed {
                entry.reason = DeploymentReason::Identical;
                DeploymentAction::Skip
            } else if entry.reason == DeploymentReason::Different {
                DeploymentAction::Conflict
            } else {
                DeploymentAction::Migrate
            };
        } else {
            entry.action = DeploymentAction::Create;
            entry.reason = DeploymentReason::Missing;
        }
        entries.push(entry);
    }
    entries.sort_by_key(|entry| entry.path == ".voktty/kit.json");
    Ok(DeploymentPlan {
        can_publish: entries
            .iter()
            .all(|entry| entry.action != DeploymentAction::Conflict),
        entries,
    })
}
