use super::*;

/// Captures project IO independently of installation identity, preferences and
/// instruction trust. The native caller still owns workspace authorization.
pub struct ProjectMemoryWorkspace<'a> {
    pub(super) root: PathBuf,
    pub(super) root_id: (u64, u128),
    pub(super) root_instance: Option<RootInstance>,
    pub(super) canonical_root: String,
    pub(super) filesystem_id: String,
    access: &'a dyn MemoryReadAccess,
}

impl<'a> ProjectMemoryWorkspace<'a> {
    pub fn open(
        requested: &Path,
        access: &'a dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<Self, ReadError> {
        platform::ensure_supported()?;
        let _permit = ReadPermit::acquire(control)?;
        if !crate::path_policy::readable(requested.to_str().ok_or(ReadError::InvalidInput)?) {
            return Err(ReadError::Denied);
        }
        Self::open_inner(requested, access, control)
    }

    pub(super) fn open_inner(
        requested: &Path,
        access: &'a dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<Self, ReadError> {
        if !requested.is_absolute() {
            return Err(ReadError::InvalidInput);
        }
        if !access.allows_workspace_root(requested) {
            return Err(ReadError::Denied);
        }
        let (root, directory) = resolve_project_directory(requested, control)?;
        if !access.allows_workspace_root(&root) {
            return Err(ReadError::Denied);
        }
        let resolved = directory.canonical_root(&root)?;
        let canonical_root = voktty_paths::canonical_display_path(&resolved);
        control.check()?;
        Ok(Self {
            root,
            root_id: directory.identity(),
            root_instance: directory.root_instance(),
            canonical_root,
            filesystem_id: directory.filesystem_id(),
            access,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Scope keys belong only to this observation. They cannot identify a
    /// persistent preference or establish instruction trust.
    pub fn observe_scope(
        &self,
        purpose: crate::DiscoveryPurpose,
        control: &crate::DiscoveryControl,
    ) -> Result<crate::NativeScopeObservation, ReadError> {
        let phase = control.read_control()?;
        let _permit = ReadPermit::acquire(&phase)?;
        self.checked_root(&phase)?;
        let observation = crate::discovery::gather(
            &self.root,
            &uuid::Uuid::new_v4().to_string(),
            self.access,
            purpose,
            control,
        )?;
        self.checked_root(&control.read_control()?)?;
        control.read_control()?;
        Ok(observation)
    }

    pub fn observe_deployment(
        &self,
        links: RootLinks,
        control: &ReadControl,
    ) -> Result<BTreeMap<String, PathFact>, ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        let directory = self.checked_root(control)?;
        let facts = collect_project_facts(
            &directory,
            &self.root,
            self.access,
            &deployment_inventory(links),
            1024 * 1024,
            control,
        )?;
        self.checked_root(control)?;
        control.check()?;
        Ok(facts)
    }

    fn checked_root(&self, control: &ReadControl) -> Result<platform::Directory, ReadError> {
        checked_project_root(
            &self.root,
            self.root_id,
            &self.root_instance,
            &self.canonical_root,
            self.access,
            control,
        )
    }
}

pub(super) fn deployment_inventory(links: RootLinks) -> BTreeSet<String> {
    let mut paths = inventory(false);
    paths.insert(".voktty/kit.lock.json".into());
    if links.agents || links.claude {
        paths.insert("AGENTS.md".into());
    }
    if links.claude {
        paths.insert("CLAUDE.md".into());
    }
    paths
}

pub(super) fn checked_project_root(
    root: &Path,
    root_id: (u64, u128),
    root_instance: &Option<RootInstance>,
    canonical_root: &str,
    access: &dyn MemoryReadAccess,
    control: &ReadControl,
) -> Result<platform::Directory, ReadError> {
    control.check()?;
    if !access.allows_workspace_root(root) {
        return Err(ReadError::Denied);
    }
    let directory = platform::Directory::open_root(root, control).map_err(|error| match error {
        ReadError::Cancelled | ReadError::Timeout => error,
        _ => ReadError::StaleRoot,
    })?;
    #[cfg(unix)]
    directory.qualify_project_filesystem(control)?;
    let resolved = directory.canonical_root(root)?;
    control.check()?;
    if directory.identity() != root_id
        || &directory.root_instance() != root_instance
        || voktty_paths::canonical_display_path(&resolved) != canonical_root
    {
        return Err(ReadError::StaleRoot);
    }
    Ok(directory)
}

pub(super) fn collect_project_facts(
    directory: &platform::Directory,
    root: &Path,
    access: &dyn MemoryReadAccess,
    paths: &BTreeSet<String>,
    max_bytes: usize,
    control: &ReadControl,
) -> Result<BTreeMap<String, PathFact>, ReadError> {
    if paths.len() > 128 {
        return Err(ReadError::Limit);
    }
    let mut bytes = 0usize;
    let mut facts = BTreeMap::new();
    for path in paths {
        control.check()?;
        let fact = directory.read_text(root, path, access, control)?;
        if let PathFact::File { text } = &fact {
            bytes = bytes
                .checked_add(text.len())
                .filter(|n| *n <= max_bytes)
                .ok_or(ReadError::Limit)?;
        }
        facts.insert(path.clone(), fact);
    }
    Ok(facts)
}
