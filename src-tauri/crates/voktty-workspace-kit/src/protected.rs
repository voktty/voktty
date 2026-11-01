use crate::{resource, Issue, KitResult, PathFact};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Serialize)]
pub struct MemoryProtectedFile {
    pub path: String,
    pub kind: &'static str,
    pub sha256: Option<String>,
    pub bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct MemoryProtectedSnapshot {
    schema: u8,
    files: Vec<MemoryProtectedFile>,
}

impl MemoryProtectedSnapshot {
    pub(crate) fn size(&self) -> (usize, usize) {
        (
            self.files.len(),
            self.files.iter().filter_map(|f| f.bytes).sum(),
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProtectedComparison {
    pub changed_files: Vec<String>,
    pub added_files: Vec<String>,
    pub removed_files: Vec<String>,
}

/// Fixed project-relative observations required even when a file is absent.
pub fn memory_protected_paths() -> Vec<String> {
    let manifest: Value =
        serde_json::from_str(resource("manifest.json").expect("embedded manifest"))
            .expect("validated manifest");
    let mut paths: BTreeSet<_> = manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .filter(|entry| entry["kind"] == "base" || entry["kind"] == "link")
        .map(|entry| {
            let source = entry["source"].as_str().expect("manifest source");
            source
                .strip_prefix("root/")
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    format!(
                        ".voktty/{}",
                        source.strip_prefix("dot-voktty/").expect("base source")
                    )
                })
        })
        .collect();
    paths.extend(
        [
            ".voktty/kit.json",
            ".voktty/kit.lock.json",
            ".voktty/team/agents.json",
        ]
        .into_iter()
        .map(String::from),
    );
    paths.into_iter().collect()
}

fn invalid(code: &'static str) -> Vec<Issue> {
    vec![Issue::new(code, vec![])]
}

fn extra_path(path: &str) -> bool {
    if path.len() > 4096
        || path
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '%' | '?' | '#'))
    {
        return false;
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts
        .iter()
        .any(|part| part.is_empty() || matches!(*part, "." | ".."))
    {
        return false;
    }
    if parts.len() == 4 && parts[..3] == [".voktty", "team", "roles"] {
        return parts[3].strip_suffix(".md").is_some_and(|name| {
            !name.is_empty()
                && name
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        });
    }
    if parts.len() == 3 && parts[0] == ".voktty" {
        if parts[1] == "capture" {
            return parts[2].strip_suffix(".md").is_some_and(|name| {
                !name.is_empty()
                    && name
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            });
        }
        return matches!(
            parts[1],
            "plans" | "domains" | "architecture" | "rituals" | "external"
        ) && matches!(parts[2], "README.md" | "_TEMPLATE.md");
    }
    false
}

/// Path classification only, never filesystem authority or instruction trust.
pub fn is_memory_protected_path(path: &str) -> bool {
    extra_path(path) || memory_protected_paths().iter().any(|fixed| fixed == path)
}

/// Exact bytes and verified absence only. No parsing, instruction trust or IO.
pub fn snapshot_memory_protected(
    documents: &BTreeMap<String, PathFact>,
    inventory_complete: bool,
) -> KitResult<MemoryProtectedSnapshot> {
    if !inventory_complete {
        return Err(invalid("KIT_PROTECTED_INCOMPLETE"));
    }
    if documents.len() > 128 {
        return Err(invalid("KIT_PROTECTED_FILE_LIMIT"));
    }
    let required: BTreeSet<_> = memory_protected_paths().into_iter().collect();
    if required.iter().any(|path| !documents.contains_key(path)) {
        return Err(invalid("KIT_PROTECTED_INCOMPLETE"));
    }
    let mut files = Vec::new();
    let mut total = 0usize;
    for (path, fact) in documents {
        if !required.contains(path) && !extra_path(path) {
            return Err(invalid("KIT_PROTECTED_PATH_INVALID"));
        }
        let (kind, sha256, bytes) = match fact {
            PathFact::Absent => ("absent", None, None),
            PathFact::Blocked => return Err(invalid("KIT_PROTECTED_INCOMPLETE")),
            PathFact::File { text } => {
                if text.len() > 256 * 1024 {
                    return Err(invalid("KIT_PROTECTED_BYTE_LIMIT"));
                }
                if text.contains('\0') {
                    return Err(invalid("KIT_PROTECTED_TEXT_INVALID"));
                }
                total = total
                    .checked_add(text.len())
                    .filter(|n| *n <= 4 * 1024 * 1024)
                    .ok_or_else(|| invalid("KIT_PROTECTED_BYTE_LIMIT"))?;
                (
                    "file",
                    Some(hex::encode(Sha256::digest(text.as_bytes()))),
                    Some(text.len()),
                )
            }
        };
        files.push(MemoryProtectedFile {
            path: path.clone(),
            kind,
            sha256,
            bytes,
        });
    }
    Ok(MemoryProtectedSnapshot { schema: 1, files })
}

/// Every addition, removal or rewrite is a diagnostic, never a compaction approval.
pub fn compare_memory_protected(
    before: &MemoryProtectedSnapshot,
    after: &MemoryProtectedSnapshot,
) -> MemoryProtectedComparison {
    let previous: BTreeMap<_, _> = before
        .files
        .iter()
        .filter(|f| f.kind == "file")
        .map(|f| (&f.path, f))
        .collect();
    let current: BTreeMap<_, _> = after
        .files
        .iter()
        .filter(|f| f.kind == "file")
        .map(|f| (&f.path, f))
        .collect();
    let mut report = MemoryProtectedComparison {
        changed_files: vec![],
        added_files: vec![],
        removed_files: vec![],
    };
    for (path, file) in &previous {
        match current.get(path) {
            None => report.removed_files.push((*path).clone()),
            Some(now) if now.sha256 != file.sha256 || now.bytes != file.bytes => {
                report.changed_files.push((*path).clone())
            }
            _ => {}
        }
    }
    report.added_files = current
        .keys()
        .filter(|path| !previous.contains_key(*path))
        .map(|path| (*path).clone())
        .collect();
    report
}
