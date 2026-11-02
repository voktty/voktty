use super::measurement::PinnedDirectory;
use super::*;
use crate::discovery::EntryKind;
use serde::Serialize;

const MAX_FILES: usize = 128;
const MAX_ENTRIES: usize = 20000;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_REPLY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct NativeMemoryDocument {
    pub path: String,
    #[serde(serialize_with = "serialize_fact")]
    pub fact: PathFact,
}

fn serialize_fact<S: serde::Serializer>(fact: &PathFact, serializer: S) -> Result<S::Ok, S::Error> {
    fact_value(fact).serialize(serializer)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMemoryDocuments {
    pub schema: u8,
    pub root: String,
    pub complete: bool,
    pub blocked_count: usize,
    pub files: Vec<NativeMemoryDocument>,
}

fn fixed_paths() -> &'static BTreeSet<String> {
    static PATHS: std::sync::OnceLock<BTreeSet<String>> = std::sync::OnceLock::new();
    PATHS.get_or_init(|| {
        inventory(false)
            .into_iter()
            .chain([
                "AGENTS.md".into(),
                "CLAUDE.md".into(),
                ".voktty/kit.lock.json".into(),
            ])
            .collect()
    })
}

pub fn is_memory_document_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > 4096
        || !crate::path_policy::readable(path)
        || path
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '%' | '?' | '#'))
    {
        return false;
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > 16
        || parts
            .iter()
            .any(|p| p.is_empty() || matches!(*p, "." | "..") || p.len() > 256)
    {
        return false;
    }
    if fixed_paths().contains(path) {
        return true;
    }
    if parts.len() < 3 || parts[0] != ".voktty" || !path.ends_with(".md") {
        return false;
    }
    match parts[1] {
        "plans" | "domains" | "architecture" | "rituals" | "external" | "archive" | "capture" => {
            true
        }
        "team" => parts.len() >= 4 && parts[2] == "roles",
        "continuity" => parts.len() >= 4 && parts[2] == "handoffs",
        _ => false,
    }
}

fn directory_allowed(path: &str) -> bool {
    if path.is_empty() {
        return true;
    }
    let parts: Vec<_> = path.split('/').collect();
    match parts[0] {
        "plans" | "domains" | "architecture" | "rituals" | "external" | "archive" | "capture" => {
            true
        }
        "team" => parts.len() == 1 || parts[1] == "roles",
        "continuity" => parts.len() == 1 || parts[1] == "handoffs",
        _ => false,
    }
}

struct Catalog<'a> {
    access: &'a dyn MemoryReadAccess,
    control: &'a ReadControl,
    paths: BTreeSet<String>,
    directories: Vec<PinnedDirectory>,
    visited: usize,
    entries: usize,
    blocked: usize,
    complete: bool,
}

impl Catalog<'_> {
    fn blocked(&mut self) {
        self.blocked += 1;
        self.complete = false;
    }

    fn scan(&mut self, directory: PinnedDirectory, relative: &str) -> Result<(), ReadError> {
        self.control.check()?;
        if self.visited >= 128 || relative.split('/').count() > 14 {
            return Err(ReadError::Limit);
        }
        self.visited += 1;
        let listing = directory.directory.entries(
            &directory.path,
            self.access,
            self.control,
            MAX_ENTRIES + 1 - self.entries,
        )?;
        self.entries += listing.entries.len();
        if !listing.complete || self.entries > MAX_ENTRIES {
            return Err(ReadError::Limit);
        }
        for entry in listing.entries {
            self.control.check()?;
            let Some(name) = entry.name.to_str() else {
                self.blocked();
                continue;
            };
            if name.len() > 256
                || name
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '%' | '?' | '#'))
            {
                self.blocked();
                continue;
            }
            let path = if relative.is_empty() {
                name.to_owned()
            } else {
                format!("{relative}/{name}")
            };
            if is_memory_document_path(&format!(".voktty/{path}")) {
                self.paths.insert(format!(".voktty/{path}"));
            } else if entry.kind == EntryKind::Directory && directory_allowed(&path) {
                match directory.child(name, self.access, self.control)? {
                    Some(child) => self.scan(child, &path)?,
                    None => self.blocked(),
                }
            } else if entry.kind == EntryKind::Link && directory_allowed(&path) {
                self.blocked();
            }
            if self.paths.len() > MAX_FILES {
                return Err(ReadError::Limit);
            }
        }
        self.directories.push(directory);
        Ok(())
    }
}

/// Explicit display-only snapshot. Returned documents are never instruction trust
/// or permission to publish changes, capture content or deliver it to a model.
pub fn read_local_memory_documents(
    requested: &Path,
    expected_root: &str,
    access: &dyn MemoryReadAccess,
    control: &crate::DiscoveryControl,
) -> Result<NativeMemoryDocuments, ReadError> {
    if expected_root.is_empty()
        || expected_root.len() > 4096
        || expected_root.chars().any(char::is_control)
    {
        return Err(ReadError::InvalidInput);
    }
    let phase = control.read_control()?;
    let _permit = ReadPermit::acquire(&phase)?;
    if !access.allows_workspace_root(requested) {
        return Err(ReadError::Denied);
    }
    let execution = resolve_memory_directory(requested, &phase)?;
    if !access.allows_workspace_root(&execution) {
        return Err(ReadError::Denied);
    }
    let original = PinnedDirectory::new(
        execution.clone(),
        platform::Directory::open_root(&execution, &phase)?,
    )?;
    let machine = uuid::Uuid::new_v4().to_string();
    let scope = crate::discovery::gather(
        &execution,
        &machine,
        access,
        crate::DiscoveryPurpose::Discover,
        control,
    )?;
    if scope.scope.state != "ready"
        || !scope.scope.ancestry_complete
        || !scope.blocked_paths.is_empty()
    {
        return Err(ReadError::Unavailable);
    }
    let root = scope
        .directories
        .iter()
        .find(|d| Some(&d.directory_key) == scope.scope.root_key.as_ref())
        .map(|d| d.path.clone())
        .ok_or(ReadError::Unavailable)?;
    if voktty_paths::canonical_display_path(&root)
        != voktty_paths::canonical_display_path(Path::new(expected_root))
    {
        return Err(ReadError::StaleRoot);
    }
    if !access.allows_workspace_root(&root) {
        return Err(ReadError::Denied);
    }
    let memory =
        PinnedDirectory::new(root.clone(), platform::Directory::open_root(&root, &phase)?)?;
    let kit = memory
        .child(".voktty", access, &phase)?
        .ok_or(ReadError::Unavailable)?;
    let config = kit
        .directory
        .read_text(&kit.path, "kit.json", access, &phase)?;
    if !matches!(config, PathFact::File { .. }) {
        return Err(ReadError::Unavailable);
    }
    let mut catalog = Catalog {
        access,
        control: &phase,
        paths: fixed_paths().clone(),
        directories: Vec::new(),
        visited: 0,
        entries: 0,
        blocked: 0,
        complete: true,
    };
    catalog.scan(kit, "")?;
    let mut files = Vec::new();
    let mut bytes = 0usize;
    let paths: Vec<_> = catalog.paths.iter().cloned().collect();
    for path in paths {
        phase.check()?;
        let fact = if bytes >= MAX_TEXT_BYTES {
            PathFact::Blocked
        } else {
            memory
                .directory
                .read_text(&memory.path, &path, access, &phase)?
        };
        let fact = match fact {
            PathFact::File { text } => {
                bytes = bytes.checked_add(text.len()).ok_or(ReadError::Limit)?;
                if bytes <= MAX_TEXT_BYTES {
                    PathFact::File { text }
                } else {
                    PathFact::Blocked
                }
            }
            fact => fact,
        };
        if matches!(fact, PathFact::Blocked) {
            catalog.blocked();
        }
        files.push(NativeMemoryDocument { path, fact });
    }
    if !matches!(memory.directory.read_text(&memory.path, ".voktty/kit.json", access, &phase)?, PathFact::File { ref text } if matches!(config, PathFact::File { text: ref original } if original == text))
    {
        return Err(ReadError::StaleRoot);
    }
    original.verify(access, &phase)?;
    memory.verify(access, &phase)?;
    for directory in &catalog.directories {
        directory.verify(access, &phase)?;
    }
    if files.iter().any(|file| {
        matches!(&file.fact, PathFact::File { .. }) && !access.allows_read(&root.join(&file.path))
    }) {
        return Err(ReadError::Denied);
    }
    let verified = crate::discovery::gather(
        &execution,
        &machine,
        access,
        crate::DiscoveryPurpose::Discover,
        control,
    )?;
    if verified.scope != scope.scope
        || !access.allows_workspace_root(&execution)
        || !access.allows_workspace_root(&root)
    {
        return Err(ReadError::StaleRoot);
    }
    original.verify(access, &phase)?;
    memory.verify(access, &phase)?;
    for directory in &catalog.directories {
        directory.verify(access, &phase)?;
    }
    let result = NativeMemoryDocuments {
        schema: 1,
        root: expected_root.to_owned(),
        complete: catalog.complete,
        blocked_count: catalog.blocked,
        files,
    };
    if serde_json::to_vec(&result)
        .map_err(|_| ReadError::Unavailable)?
        .len()
        > MAX_REPLY_BYTES
    {
        return Err(ReadError::Limit);
    }
    phase.check()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_document_path_conformance() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../../../templates/workspace-kit/conformance/document-paths.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let path = case["path"].as_str().unwrap();
            assert_eq!(
                is_memory_document_path(path),
                case["valid"].as_bool().unwrap(),
                "{path:?}"
            );
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "documents_tests.rs"]
mod filesystem_tests;
