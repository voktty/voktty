use crate::{DeploymentAction, Issue, KitResult};
use serde::Serialize;

const MAX_EXCLUDE_BYTES: usize = 64 * 1024;
const MAX_PROJECT_BYTES: usize = 4096;
const MARKER: &str = "# Voktty project memory (this machine only)";

/// Display data only. The native Git owner must retain the actual repository,
/// exclude-file identity and expected bytes before accepting publication.
#[derive(Debug, Clone, Serialize)]
pub struct GitMemoryExcludePlan {
    pub action: DeploymentAction,
    pub pattern: String,
    pub expected: Option<String>,
    pub proposed: String,
}

fn issue(code: &'static str, path: Vec<serde_json::Value>) -> Vec<Issue> {
    vec![Issue::new(code, path)]
}

fn pattern(components: &[&str]) -> KitResult<String> {
    if components.len() > 128 {
        return Err(issue(
            "KIT_GIT_EXCLUDE_PATH_LIMIT",
            vec!["projectComponents".into()],
        ));
    }
    let mut bytes = 0usize;
    let mut result = String::from("/");
    for (index, component) in components.iter().enumerate() {
        if component.is_empty()
            || matches!(*component, "." | "..")
            || component.contains('/')
            || component
                .chars()
                .any(|c| c <= '\u{001f}' || c == '\u{007f}')
        {
            return Err(issue(
                "KIT_GIT_EXCLUDE_PATH_INVALID",
                vec!["projectComponents".into(), index.into()],
            ));
        }
        bytes = bytes.saturating_add(component.len()).saturating_add(1);
        if bytes > MAX_PROJECT_BYTES {
            return Err(issue(
                "KIT_GIT_EXCLUDE_PATH_LIMIT",
                vec!["projectComponents".into()],
            ));
        }
        for c in component.chars() {
            if matches!(c, '\\' | '*' | '?' | '[' | ']' | ' ') {
                result.push('\\');
            }
            result.push(c);
        }
        result.push('/');
    }
    result.push_str(".voktty/");
    Ok(result)
}

/// Components are literal filenames relative to the Git worktree root, not a
/// native path or Git pattern. No filesystem access or authorization occurs here.
pub fn plan_git_memory_exclusion(
    project_components: &[&str],
    expected: Option<&str>,
) -> KitResult<GitMemoryExcludePlan> {
    let pattern = pattern(project_components)?;
    let current = expected.unwrap_or_default();
    if current.len() > MAX_EXCLUDE_BYTES {
        return Err(issue("KIT_GIT_EXCLUDE_TOO_LARGE", vec!["expected".into()]));
    }
    if current.contains('\0') {
        return Err(issue(
            "KIT_GIT_EXCLUDE_CONTENT_INVALID",
            vec!["expected".into()],
        ));
    }
    let last_rule = current
        .split('\n')
        .rev()
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .find(|line| !line.is_empty() && !line.starts_with('#'));
    if last_rule == Some(pattern.as_str()) {
        return Ok(GitMemoryExcludePlan {
            action: DeploymentAction::Skip,
            pattern,
            expected: expected.map(str::to_owned),
            proposed: current.into(),
        });
    }
    let eol = current
        .find('\n')
        .filter(|index| *index > 0 && current.as_bytes()[index - 1] == b'\r')
        .map_or("\n", |_| "\r\n");
    let mut proposed = current.to_owned();
    if !proposed.is_empty() && !proposed.ends_with('\n') {
        proposed.push_str(eol);
    }
    if !proposed.is_empty() {
        proposed.push_str(eol);
    }
    proposed.push_str(MARKER);
    proposed.push_str(eol);
    proposed.push_str(&pattern);
    proposed.push_str(eol);
    if proposed.len() > MAX_EXCLUDE_BYTES {
        return Err(issue("KIT_GIT_EXCLUDE_TOO_LARGE", vec!["proposed".into()]));
    }
    Ok(GitMemoryExcludePlan {
        action: if expected.is_some() {
            DeploymentAction::Migrate
        } else {
            DeploymentAction::Create
        },
        pattern,
        expected: expected.map(str::to_owned),
        proposed,
    })
}

#[cfg(test)]
#[path = "git_exclude_tests.rs"]
mod tests;
