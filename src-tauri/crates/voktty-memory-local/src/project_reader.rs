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

pub(crate) struct OwnedProjectMemoryWorkspace {
    root: PathBuf,
    root_id: (u64, u128),
    root_instance: Option<RootInstance>,
    canonical_root: String,
    filesystem_id: String,
    access: Arc<dyn MemoryReadAccess>,
}

impl OwnedProjectMemoryWorkspace {
    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn borrow(&self) -> ProjectMemoryWorkspace<'_> {
        ProjectMemoryWorkspace {
            root: self.root.clone(),
            root_id: self.root_id,
            root_instance: self.root_instance.clone(),
            canonical_root: self.canonical_root.clone(),
            filesystem_id: self.filesystem_id.clone(),
            access: self.access.as_ref(),
        }
    }

    pub(crate) fn review_binding(&self) -> Result<Value, ReadError> {
        let instance = self.root_instance.as_ref().ok_or(ReadError::Unsupported)?;
        Ok(json!({
            "root":self.canonical_root,
            "filesystem":self.filesystem_id,
            "instance":instance,
        }))
    }
}

impl<'a> ProjectMemoryWorkspace<'a> {
    pub(crate) fn retain(
        self,
        access: Arc<dyn MemoryReadAccess>,
    ) -> Result<OwnedProjectMemoryWorkspace, ReadError> {
        if !std::ptr::addr_eq(self.access, access.as_ref()) {
            return Err(ReadError::Denied);
        }
        Ok(OwnedProjectMemoryWorkspace {
            root: self.root,
            root_id: self.root_id,
            root_instance: self.root_instance,
            canonical_root: self.canonical_root,
            filesystem_id: self.filesystem_id,
            access,
        })
    }

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

    pub(crate) fn validate_root(&self, control: &ReadControl) -> Result<(), ReadError> {
        self.checked_root(control).map(|_| ())
    }

    /// Scope keys belong only to this observation. They cannot identify a
    /// persistent preference or establish instruction trust.
    pub fn observe_scope(
        &self,
        purpose: crate::DiscoveryPurpose,
        control: &crate::DiscoveryControl,
    ) -> Result<crate::NativeScopeObservation, ReadError> {
        self.observe_scope_with_identity(purpose, &uuid::Uuid::new_v4().to_string(), control)
    }

    pub(crate) fn observe_scope_with_identity(
        &self,
        purpose: crate::DiscoveryPurpose,
        observation_identity: &str,
        control: &crate::DiscoveryControl,
    ) -> Result<crate::NativeScopeObservation, ReadError> {
        let phase = control.read_control()?;
        let _permit = ReadPermit::acquire(&phase)?;
        self.checked_root(&phase)?;
        let observation = crate::discovery::gather(
            &self.root,
            observation_identity,
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

    /// Reads the bounded project instruction and context inventory without
    /// installation identity, preferences or permission to deliver it to a model.
    pub fn observe_context(
        &self,
        role: Option<&str>,
        control: &ReadControl,
    ) -> Result<ProjectContextObservation, ReadError> {
        let paths = context_inventory(role)?;
        let _permit = ReadPermit::acquire(control)?;
        let directory = self.checked_root(control)?;
        let facts = collect_project_facts(
            &directory,
            &self.root,
            self.access,
            &paths,
            2 * 1024 * 1024,
            control,
        )?;
        self.checked_root(control)?;
        project_context_observation(facts, role, control)
    }

    /// Reads a bounded packet under ordinary native read authority. This grants
    /// no tools or persistent permissions and never opens application storage.
    pub fn read_context_packet(
        &self,
        role: Option<&str>,
        control: &ReadControl,
    ) -> Result<voktty_workspace_kit::MemoryContextPacket, ReadError> {
        use sha2::{Digest, Sha256};
        let observed = self.observe_context(role, control)?;
        let binding = json!({
            "operation":"project-context-v1", "root":self.canonical_root,
            "filesystem":self.filesystem_id, "object":[self.root_id.0.to_string(), self.root_id.1.to_string()],
            "instance":self.root_instance,
        });
        let key = hex::encode(Sha256::digest(binding.to_string().as_bytes()));
        let packet = voktty_workspace_kit::build_project_memory_packet(
            &self.canonical_root,
            &key,
            &observed.config,
            &observed.instructions,
            &fact_value(&observed.project),
            &fact_value(&observed.context),
        )
        .map_err(ReadError::Contract)?;
        self.checked_root(control)?;
        control.check()?;
        Ok(packet)
    }

    pub(crate) fn recovery_artifacts(
        &self,
        control: &ReadControl,
    ) -> Result<Vec<String>, ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        let root = self.checked_root(control)?;
        let mut found = Vec::new();
        let mut inspect = |directory: &platform::Directory,
                           path: &Path,
                           prefix: &str,
                           limit|
         -> Result<(), ReadError> {
            let listing = directory.entries(path, self.access, control, limit)?;
            if !listing.complete {
                return Err(ReadError::Limit);
            }
            for entry in listing.entries {
                let name = entry.name.to_string_lossy();
                let comparable = name.to_ascii_lowercase();
                if comparable.starts_with(".voktty-migration-")
                    || comparable.starts_with(".voktty-stage-")
                    || (prefix == ".voktty/" && comparable == ".initialization.json")
                {
                    if found.len() == 128 {
                        return Err(ReadError::Limit);
                    }
                    found.push(format!("{prefix}{name}"));
                }
            }
            Ok(())
        };
        inspect(&root, &self.root, "", 20000)?;
        let kit_path = self.root.join(".voktty");
        if !self.access.allows_metadata(&kit_path) {
            return Err(ReadError::Denied);
        }
        match root
            .probe(std::ffi::OsStr::new(".voktty"))
            .map_err(|_| ReadError::Io)?
        {
            None => {}
            Some(crate::discovery::EntryKind::Directory) => {
                let kit = root.open_child(std::ffi::OsStr::new(".voktty"), &kit_path, control)?;
                inspect(&kit, &kit_path, ".voktty/", 128)?;
            }
            _ => return Err(ReadError::Denied),
        }
        self.checked_root(control)?;
        found.sort();
        control.check()?;
        Ok(found)
    }

    pub(crate) fn access(&self) -> &dyn MemoryReadAccess {
        self.access
    }

    #[cfg(any(unix, windows))]
    pub(crate) fn hold_initialization_record(
        &self,
        control: &ReadControl,
    ) -> Result<(std::fs::File, String), ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        let directory = self.checked_root(control)?;
        let record = directory.hold_initialization_record(&self.root, self.access, control)?;
        self.checked_root(control)?;
        control.check()?;
        Ok(record)
    }

    pub(crate) fn read_artifact(
        &self,
        path: &str,
        control: &ReadControl,
    ) -> Result<PathFact, ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        let directory = self.checked_root(control)?;
        let fact = directory.read_text(&self.root, path, self.access, control)?;
        self.checked_root(control)?;
        control.check()?;
        Ok(fact)
    }

    pub(crate) fn checked_root(
        &self,
        control: &ReadControl,
    ) -> Result<platform::Directory, ReadError> {
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
