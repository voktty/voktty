use std::collections::HashSet;

use serde_json::{json, Value};
use wake_core::adapters::{adapter_for, AgentAdapter};
use wake_core::db::Store;
use wake_core::models::{SessionFileRef, SessionFilter as WakeSessionFilter};

use super::session_store::{SessionRecord, SessionSummary};

/// Normalizes project paths across Windows, macOS, and Linux.
/// Strips \\?\ prefix, normalizes slashes to /, trims trailing slashes,
/// and on Windows lowercases the drive letter (e.g. C:/foo -> c:/foo).
pub fn normalize_project_path(raw: &str) -> String {
    let mut p = raw.trim();
    if let Some(stripped) = p.strip_prefix(r"\\?\") {
        p = stripped;
    }
    let mut s = p.replace('\\', "/");
    while s.ends_with('/') && s.len() > 1 {
        s.pop();
    }
    if s.len() >= 2 && s.as_bytes()[1] == b':' {
        let first = s.chars().next().unwrap().to_lowercase().to_string();
        s = format!("{}{}", first, &s[1..]);
    }
    s
}

fn matching_project_paths(
    paths: impl IntoIterator<Item = String>,
    target_norm: &str,
) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| {
            let normalized = normalize_project_path(path);
            normalized == target_norm || normalized.eq_ignore_ascii_case(target_norm)
        })
        .collect()
}

fn project_session_filter(project_paths: Vec<String>) -> WakeSessionFilter {
    WakeSessionFilter {
        include_archived: true,
        roots_only: true,
        project_paths,
        ..WakeSessionFilter::default()
    }
}

/// Lists all external sessions (from Claude, Codex, Grok, Antigravity, OpenCode, Cursor, etc.) belonging to target_cwd.
pub fn list_external_sessions_for_project(
    target_cwd: &str,
    store: &Store,
) -> Result<Vec<SessionSummary>, String> {
    let target_norm = normalize_project_path(target_cwd);
    if target_norm.is_empty() || target_norm == "~" {
        return Ok(Vec::new());
    }

    let project_paths = matching_project_paths(
        store
            .list_projects(true)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|project| project.path),
        &target_norm,
    );
    if project_paths.is_empty() {
        return Ok(Vec::new());
    }
    let filter = project_session_filter(project_paths);
    let (sessions, _) = store
        .list_sessions(&filter)
        .map_err(|error| error.to_string())?;

    let mut result = Vec::new();
    for meta in sessions {
        let proj_norm = normalize_project_path(&meta.project_path);
        if proj_norm == target_norm || proj_norm.eq_ignore_ascii_case(&target_norm) {
            let created = if meta.created_at < 1_000_000_000_000 {
                meta.created_at * 1000
            } else {
                meta.created_at
            };
            let updated = if meta.updated_at < 1_000_000_000_000 {
                meta.updated_at * 1000
            } else {
                meta.updated_at
            };

            let clean_title = if meta.title.trim().is_empty() {
                format!("{} Session", meta.agent.display_name())
            } else {
                meta.title.trim().to_string()
            };

            result.push(SessionSummary {
                id: format!("ext_wake_{}", meta.key),
                cwd: target_cwd.to_string(),
                harness: meta.agent.as_str().to_string(),
                model: meta.model.unwrap_or_else(|| "default".to_string()),
                runtime_mode: "supervised".to_string(),
                title: clean_title,
                provider_session_id: Some(meta.id),
                branch: meta.git_branch,
                repo: None,
                additions: 0,
                deletions: 0,
                created_at: created,
                updated_at: updated,
                archived: meta.archived,
                pinned: meta.pinned,
            });
        }
    }

    result.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    Ok(result)
}

/// Retrieves and formats an external session into a full SessionRecord on demand using wake_core.
pub fn get_external_session_record(
    session_id: &str,
    store: &Store,
    adapters: &[Box<dyn AgentAdapter>],
) -> Result<Option<SessionRecord>, String> {
    let key = if let Some(k) = session_id.strip_prefix("ext_wake_") {
        k
    } else if let Some(k) = session_id.strip_prefix("ext_codex_") {
        k
    } else if let Some(k) = session_id.strip_prefix("ext_gemini_") {
        k
    } else if let Some(k) = session_id.strip_prefix("ext_claude_") {
        k
    } else {
        session_id
    };

    let Some(meta) = store.get_session(key).map_err(|error| error.to_string())? else {
        return Ok(None);
    };

    let adapter = adapter_for(adapters, meta.agent, &meta.file_path)
        .ok_or_else(|| format!("No history adapter for {}", meta.agent.as_str()))?;

    let file_ref = SessionFileRef {
        agent: meta.agent,
        native_id: meta.id.clone(),
        file_path: meta.file_path.clone(),
        mtime_ms: meta.updated_at,
        size: meta.size_bytes,
    };

    let transcript = adapter
        .parse_transcript(&file_ref)
        .map_err(|error| error.to_string())?;

    let mut blocks = Vec::new();
    for (block_idx, msg) in transcript.mainline.into_iter().enumerate() {
        let role = msg.role.as_str();
        let ts = msg.timestamp.unwrap_or(meta.updated_at);

        let mut block_obj = json!({
            "id": format!("blk_{}", block_idx),
            "role": role,
            "text": msg.text,
            "startedAt": if ts < 1_000_000_000_000 { ts * 1000 } else { ts },
        });

        if let Some(ref thinking) = msg.thinking {
            if !thinking.trim().is_empty() {
                block_obj["thinking"] = json!(thinking);
            }
        }

        if !msg.tool_calls.is_empty() {
            block_obj["toolCalls"] = json!(msg.tool_calls);
        }

        blocks.push(block_obj);
    }

    let created = if meta.created_at < 1_000_000_000_000 {
        meta.created_at * 1000
    } else {
        meta.created_at
    };
    let updated = if meta.updated_at < 1_000_000_000_000 {
        meta.updated_at * 1000
    } else {
        meta.updated_at
    };

    Ok(Some(SessionRecord {
        id: session_id.to_string(),
        cwd: meta.project_path,
        harness: meta.agent.as_str().to_string(),
        model: meta.model.unwrap_or_else(|| "default".to_string()),
        model_settings: json!({}),
        runtime_mode: "supervised".to_string(),
        title: if meta.title.is_empty() {
            meta.id.clone()
        } else {
            meta.title
        },
        provider_session_id: Some(meta.id),
        blocks: Value::Array(blocks),
        context_used: None,
        context_window: None,
        branch: meta.git_branch,
        worktree_cwd: None,
        created_at: created,
        updated_at: updated,
    }))
}

/// Lists all distinct project directory paths discovered from external CLI agents via wake_core.
pub fn list_external_projects(store: &Store) -> Result<Vec<String>, String> {
    let projects = store
        .list_projects(true)
        .map_err(|error| error.to_string())?;
    let mut set = HashSet::new();

    for p in projects {
        let norm = normalize_project_path(&p.path);
        if !norm.is_empty() && norm != "~" {
            set.insert(norm);
        }
    }

    Ok(set.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::{matching_project_paths, project_session_filter};

    #[test]
    fn project_filter_preserves_exact_index_paths_after_normalized_matching() {
        let paths = vec![
            String::from("C:\\Work\\Voktty\\"),
            String::from("c:/work/other"),
            String::from("/workspace/voktty"),
        ];

        assert_eq!(
            matching_project_paths(paths, "c:/work/voktty"),
            vec![String::from("C:\\Work\\Voktty\\")]
        );
    }

    #[test]
    fn project_filter_reaches_sql_before_wake_applies_its_page_limit() {
        let paths = vec![String::from("/workspace/voktty")];
        let filter = project_session_filter(paths.clone());

        assert_eq!(filter.project_paths, paths);
        assert!(filter.include_archived);
        assert!(filter.roots_only);
    }
}
