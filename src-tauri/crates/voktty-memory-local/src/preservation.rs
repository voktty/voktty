use super::measurement::PinnedDirectory;
use super::*;
use crate::discovery::EntryKind;
use std::ffi::{OsStr, OsString};
use voktty_workspace_kit::{
    is_memory_protected_path, memory_protected_paths, snapshot_memory_preservation,
    snapshot_memory_protected, MemoryPreservationSnapshot, MemoryProtectedSnapshot,
};

/// Native observation only. It cannot be reconstructed from repository or IPC data.
pub struct NativeMemoryPreservation {
    identity: Value,
    instance: RootInstance,
    config: String,
    sources: BTreeMap<String, PathFact>,
    snapshot: MemoryPreservationSnapshot,
    protected: Option<MemoryProtectedSnapshot>,
}

impl NativeMemoryPreservation {
    pub fn snapshot(&self) -> &MemoryPreservationSnapshot {
        &self.snapshot
    }

    pub fn sources(&self) -> &BTreeMap<String, PathFact> {
        &self.sources
    }

    pub fn config(&self) -> &str {
        &self.config
    }

    pub fn protected(&self) -> Option<&MemoryProtectedSnapshot> {
        self.protected.as_ref()
    }
}

fn child(
    parent: &PinnedDirectory,
    name: &str,
    access: &dyn MemoryReadAccess,
    control: &ReadControl,
) -> Result<Option<PinnedDirectory>, ReadError> {
    let result = parent.child(name, access, control)?;
    if result.is_none()
        && parent
            .directory
            .probe(OsStr::new(name))
            .map_err(|_| ReadError::Io)?
            .is_some()
    {
        return Err(ReadError::Unavailable);
    }
    Ok(result)
}

struct Inventory<'a> {
    access: &'a dyn MemoryReadAccess,
    control: &'a ReadControl,
    directories: Vec<PinnedDirectory>,
    memberships: BTreeMap<PathBuf, Vec<(OsString, EntryKind)>>,
    paths: BTreeSet<String>,
    protected: BTreeSet<String>,
    shared: bool,
    entries: usize,
}

impl Inventory<'_> {
    fn scan(&mut self, directory: PinnedDirectory, relative: &str) -> Result<(), ReadError> {
        self.control.check()?;
        if self.directories.len() >= 128 || relative.split('/').count() >= 64 {
            return Err(ReadError::Limit);
        }
        let listing = directory.directory.entries(
            &directory.path,
            self.access,
            self.control,
            20001 - self.entries,
        )?;
        self.entries += listing.entries.len();
        if !listing.complete || self.entries > 20000 {
            return Err(ReadError::Limit);
        }
        let mut membership: Vec<_> = listing
            .entries
            .iter()
            .map(|entry| (entry.name.clone(), entry.kind))
            .collect();
        membership.sort_by(|a, b| a.0.cmp(&b.0));
        self.memberships.insert(directory.path.clone(), membership);
        for entry in listing.entries {
            self.control.check()?;
            let name = entry.name.to_str().ok_or(ReadError::Unsupported)?;
            if name.len() > 256
                || name
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '%' | '?' | '#'))
            {
                return Err(ReadError::Unsupported);
            }
            let path = if relative.is_empty() {
                name.to_owned()
            } else {
                format!("{relative}/{name}")
            };
            if path.len() > 4096 {
                return Err(ReadError::Limit);
            }
            if self.shared
                && relative.is_empty()
                && matches!(
                    name,
                    "state"
                        | "mailbox"
                        | "locks"
                        | "sessions"
                        | "tasks"
                        | "tasks.json"
                        | "tools.json"
                )
            {
                continue;
            }
            if entry.kind == EntryKind::Directory {
                let shared_directory = self.shared
                    && ((relative.is_empty()
                        && matches!(
                            name,
                            "plans"
                                | "domains"
                                | "architecture"
                                | "rituals"
                                | "external"
                                | "archive"
                                | "capture"
                                | "team"
                                | "continuity"
                        ))
                        || relative == "team" && name == "roles"
                        || relative == "continuity" && name == "handoffs");
                if !shared_directory && !relative.starts_with("archive") {
                    return Err(ReadError::Unsupported);
                }
                if relative == "archive"
                    && !(name.is_ascii()
                        && name.len() == 7
                        && name.as_bytes()[4] == b'-'
                        && name[..4].bytes().all(|c| c.is_ascii_digit())
                        && name[..4] >= *"1970"
                        && ("01"..="12").contains(&&name[5..]))
                {
                    return Err(ReadError::Unsupported);
                }
                let nested = child(&directory, name, self.access, self.control)?
                    .ok_or(ReadError::StaleRoot)?;
                self.scan(nested, &path)?;
            } else if self.shared
                && (self.protected.contains(&format!(".voktty/{path}"))
                    || ((matches!(relative, "capture" | "team/roles")
                        || matches!(name, "README.md" | "_TEMPLATE.md"))
                        && is_memory_protected_path(&format!(".voktty/{path}"))))
            {
                if entry.kind != EntryKind::File {
                    return Err(ReadError::Unavailable);
                }
                self.protected.insert(format!(".voktty/{path}"));
            } else if !self.shared
                && ((name == "README.md" && !relative.starts_with("archive/"))
                    || (name == "_TEMPLATE.md"
                        && matches!(
                            relative,
                            "plans" | "domains" | "architecture" | "rituals" | "external"
                        )))
            {
                if entry.kind != EntryKind::File {
                    return Err(ReadError::Unavailable);
                }
            } else if name.to_ascii_lowercase().ends_with(".md") {
                if self.shared
                    && ((relative.is_empty() && !matches!(name, "PROJECT.md" | "CONTEXT.md"))
                        || relative == "continuity" && name != "CHANGELOG.md"
                        || matches!(relative, "capture" | "team" | "team/roles"))
                {
                    return Err(ReadError::Unsupported);
                }
                if entry.kind != EntryKind::File || !name.ends_with(".md") {
                    return Err(ReadError::Unavailable);
                }
                self.paths.insert(path);
            } else if self.shared {
                return Err(ReadError::Unsupported);
            }
            if self.paths.len() + self.protected.len() > 128 {
                return Err(ReadError::Limit);
            }
        }
        if self.directories.len() >= 128 {
            return Err(ReadError::Limit);
        }
        self.directories.push(directory);
        Ok(())
    }
}

impl LocalMemoryWorkspace<'_> {
    /// Checks origin and current root ownership, not whether document bytes are unchanged.
    pub fn validate_preservation_binding(
        &self,
        baseline: &NativeMemoryPreservation,
        control: &ReadControl,
    ) -> Result<(), ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        self.checked_root(control)?;
        if self.identity != baseline.identity
            || self.root_instance.as_ref() != Some(&baseline.instance)
        {
            return Err(ReadError::StaleRoot);
        }
        let local = self.store.load().map_err(ReadError::Store)?;
        if self.identity["machineId"] != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        self.checked_root(control)?;
        control.check()
    }

    /// Captures factual memory only at this exact resolved memory root.
    pub fn observe_preservation(
        &self,
        control: &crate::DiscoveryControl,
    ) -> Result<NativeMemoryPreservation, ReadError> {
        self.capture_preservation(control, false)
    }

    /// Also hashes protected shared files; their text never grants trust or capture permission.
    pub fn observe_shared_preservation(
        &self,
        control: &crate::DiscoveryControl,
    ) -> Result<NativeMemoryPreservation, ReadError> {
        self.capture_preservation(control, true)
    }

    fn capture_preservation(
        &self,
        control: &crate::DiscoveryControl,
        shared: bool,
    ) -> Result<NativeMemoryPreservation, ReadError> {
        let phase = control.read_control()?;
        let _permit = ReadPermit::acquire(&phase)?;
        let instance = self.root_instance.clone().ok_or(ReadError::Unsupported)?;
        let root = PinnedDirectory::new(self.root.clone(), self.checked_root(&phase)?)?;
        let local = self.store.load().map_err(ReadError::Store)?;
        if self.identity["machineId"] != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        let scope = crate::discovery::gather(
            &self.root,
            local.installation_id(),
            self.access,
            crate::DiscoveryPurpose::Discover,
            control,
        )?;
        if scope.scope.state != "ready"
            || !scope.directories.iter().any(|d| {
                Some(&d.directory_key) == scope.scope.root_key.as_ref() && d.path == self.root
            })
        {
            return Err(ReadError::Unavailable);
        }
        let phase = control.read_control()?;
        let kit = child(&root, ".voktty", self.access, &phase)?.ok_or(ReadError::Unavailable)?;
        let PathFact::File { text: config } =
            kit.directory
                .read_text(&kit.path, "kit.json", self.access, &phase)?
        else {
            return Err(ReadError::Unavailable);
        };
        parse_kit_config(&config).map_err(ReadError::Contract)?;
        let mut inventory = Inventory {
            access: self.access,
            control: &phase,
            directories: vec![],
            memberships: BTreeMap::new(),
            protected: if shared {
                memory_protected_paths().into_iter().collect()
            } else {
                BTreeSet::new()
            },
            shared,
            entries: 0,
            paths: [
                "PROJECT.md",
                "CONTEXT.md",
                "plans/INDEX.md",
                "plans/TRACKING.md",
                "continuity/CHANGELOG.md",
                "archive/LOG.md",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        };
        if shared {
            inventory.scan(
                PinnedDirectory::new(
                    kit.path.clone(),
                    platform::Directory::open_root(&kit.path, &phase)?,
                )?,
                "",
            )?;
        } else {
            for name in [
                "plans",
                "domains",
                "architecture",
                "rituals",
                "external",
                "archive",
            ] {
                if let Some(directory) = child(&kit, name, self.access, &phase)? {
                    inventory.scan(directory, name)?;
                }
            }
            if let Some(continuity) = child(&kit, "continuity", self.access, &phase)? {
                if let Some(handoffs) = child(&continuity, "handoffs", self.access, &phase)? {
                    inventory.scan(handoffs, "continuity/handoffs")?;
                }
                inventory.directories.push(continuity);
            }
        }
        let mut sources = BTreeMap::new();
        let mut bytes = 0usize;
        for path in &inventory.paths {
            let fact = kit
                .directory
                .read_text(&kit.path, path, self.access, &phase)?;
            let PathFact::File { text } = &fact else {
                return Err(ReadError::Unavailable);
            };
            bytes = bytes
                .checked_add(text.len())
                .filter(|n| *n <= 4 * 1024 * 1024)
                .ok_or(ReadError::Limit)?;
            sources.insert(path.clone(), fact);
        }
        let snapshot = snapshot_memory_preservation(&sources, true).map_err(ReadError::Contract)?;
        let mut protected_sources = BTreeMap::new();
        for path in &inventory.protected {
            let fact = root
                .directory
                .read_text(&self.root, path, self.access, &phase)?;
            if let PathFact::File { text } = &fact {
                bytes = bytes
                    .checked_add(text.len())
                    .filter(|n| *n <= 4 * 1024 * 1024)
                    .ok_or(ReadError::Limit)?;
            }
            protected_sources.insert(path.clone(), fact);
        }
        let protected = if shared {
            Some(snapshot_memory_protected(&protected_sources, true).map_err(ReadError::Contract)?)
        } else {
            None
        };
        for (path, expected) in &sources {
            if !matches!(
                (kit.directory.read_text(&kit.path, path, self.access, &phase)?, expected),
                (PathFact::File { text }, PathFact::File { text: previous }) if text == *previous
            ) {
                return Err(ReadError::StaleRoot);
            }
        }
        if !matches!(kit.directory.read_text(&kit.path, "kit.json", self.access, &phase)?,
            PathFact::File { text } if text == config)
        {
            return Err(ReadError::StaleRoot);
        }
        for (path, expected) in &protected_sources {
            let current = root
                .directory
                .read_text(&self.root, path, self.access, &phase)?;
            if !matches!((&current, expected), (PathFact::Absent, PathFact::Absent))
                && !matches!((current, expected), (PathFact::File { text }, PathFact::File { text: previous }) if text == *previous)
            {
                return Err(ReadError::StaleRoot);
            }
        }
        if shared
            && !matches!(protected_sources.get(".voktty/kit.json"), Some(PathFact::File { text }) if *text == config)
        {
            return Err(ReadError::StaleRoot);
        }
        let verified = crate::discovery::gather(
            &self.root,
            local.installation_id(),
            self.access,
            crate::DiscoveryPurpose::Discover,
            control,
        )?;
        if verified.scope != scope.scope {
            return Err(ReadError::StaleRoot);
        }
        for directory in &inventory.directories {
            directory.verify(self.access, &phase)?;
            if let Some(expected) = inventory.memberships.get(&directory.path) {
                let listing = directory.directory.entries(
                    &directory.path,
                    self.access,
                    &phase,
                    expected.len() + 1,
                )?;
                let mut current: Vec<_> = listing
                    .entries
                    .into_iter()
                    .map(|entry| (entry.name, entry.kind))
                    .collect();
                current.sort_by(|a, b| a.0.cmp(&b.0));
                if !listing.complete || current != *expected {
                    return Err(ReadError::StaleRoot);
                }
            }
            if !self.access.allows_enumeration(&directory.path)
                && directory.path != kit.path.join("continuity")
            {
                return Err(ReadError::Denied);
            }
        }
        kit.verify(self.access, &phase)?;
        root.verify(self.access, &phase)?;
        self.checked_root(&phase)?;
        let current = self.store.load().map_err(ReadError::Store)?;
        if current.installation_id() != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        if sources
            .keys()
            .any(|path| !self.access.allows_read(&kit.path.join(path)))
            || !self.access.allows_read(&kit.path.join("kit.json"))
            || protected_sources
                .keys()
                .any(|path| !self.access.allows_read(&self.root.join(path)))
        {
            return Err(ReadError::Denied);
        }
        phase.check()?;
        Ok(NativeMemoryPreservation {
            identity: self.identity.clone(),
            instance,
            config,
            sources,
            snapshot,
            protected,
        })
    }
}
