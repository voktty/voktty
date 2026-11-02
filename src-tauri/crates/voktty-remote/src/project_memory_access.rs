use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use voktty_memory_local::{
    path_policy, MemoryReadAccess, MemoryWriteAccess, PublicationWriteRequirements,
};

pub(super) struct Access {
    pub root: PathBuf,
    pub requested: PathBuf,
    pub inspect_ancestors: bool,
    live: AtomicBool,
}

impl Access {
    pub fn new(root: PathBuf, requested: PathBuf, inspect_ancestors: bool) -> Self {
        Self {
            root,
            requested,
            inspect_ancestors,
            live: AtomicBool::new(true),
        }
    }

    pub fn retire(&self) {
        self.live.store(false, Ordering::Release);
    }

    fn valid(&self, path: &Path) -> bool {
        self.live.load(Ordering::Acquire)
            && path.is_absolute()
            && !path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
    }

    fn marker(&self, path: &Path) -> bool {
        self.inspect_ancestors
            && self.requested.ancestors().any(|ancestor| {
                let kit = ancestor.join(".voktty");
                path == kit || path.parent() == Some(kit.as_path())
            })
    }
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.valid(path)
            && (path.starts_with(&self.root)
                || self.marker(path)
                || self.inspect_ancestors && self.requested.starts_with(path))
    }

    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.valid(path)
            && path.starts_with(&self.root)
            && path.to_str().is_some_and(path_policy::readable)
    }

    fn allows_read(&self, path: &Path) -> bool {
        self.valid(path)
            && path.to_str().is_some_and(path_policy::readable)
            && (path.starts_with(&self.root)
                || self.inspect_ancestors
                    && self
                        .requested
                        .ancestors()
                        .any(|ancestor| path == ancestor.join(".voktty/kit.json")))
    }

    fn allows_enumeration(&self, path: &Path) -> bool {
        self.valid(path)
            && (path.starts_with(&self.root)
                || self.inspect_ancestors
                    && self
                        .requested
                        .ancestors()
                        .any(|ancestor| path == ancestor.join(".voktty")))
    }
}

pub(super) struct AcceptedWrites<'a> {
    pub source: &'a Access,
    pub requirements: PublicationWriteRequirements,
}

impl AcceptedWrites<'_> {
    fn allowed(&self, path: &Path) -> bool {
        self.source.allows_workspace_root(path)
            && path.to_str().is_some_and(path_policy::writable)
            && path.starts_with(&self.requirements.root)
    }

    fn staging(&self, path: &Path) -> bool {
        let valid_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix(".voktty-stage-"))
            .is_some_and(|name| {
                uuid::Uuid::parse_str(name).is_ok_and(|id| {
                    id.get_version_num() == 4
                        && id.get_variant() == uuid::Variant::RFC4122
                        && id.to_string() == name
                })
            });
        valid_name
            && self
                .requirements
                .create
                .iter()
                .filter(|entry| !self.requirements.recovery.contains(entry))
                .any(|entry| self.requirements.root.join(entry).parent() == path.parent())
    }
}

impl MemoryWriteAccess for AcceptedWrites<'_> {
    fn allows_create(&self, path: &Path) -> bool {
        self.allowed(path)
            && (self
                .requirements
                .create
                .iter()
                .any(|entry| self.requirements.root.join(entry).starts_with(path))
                || self.staging(path))
    }

    fn allows_replace(&self, path: &Path) -> bool {
        self.allowed(path)
            && self
                .requirements
                .replace
                .iter()
                .any(|entry| path == self.requirements.root.join(entry))
    }

    fn allows_remove_staging(&self, path: &Path) -> bool {
        self.allowed(path)
            && self
                .requirements
                .recovery
                .iter()
                .any(|entry| path == self.requirements.root.join(entry))
    }
}
