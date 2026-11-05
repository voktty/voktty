use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use voktty_workspace_kit::{
    instruction_fingerprint, memory_project_key, parse_kit_config, resource,
    InstructionFingerprint, Issue, PathFact, RootLinks,
};

use crate::preferences::RootInstance;
#[cfg(not(any(unix, windows)))]
use crate::reader_unavailable as platform;
#[cfg(unix)]
use crate::reader_unix as platform;
#[cfg(windows)]
use crate::reader_windows as platform;
use crate::{LocalMemorySnapshot, LocalMemoryStore, ProjectPreference, StoreError};

static ACTIVE_READS: AtomicUsize = AtomicUsize::new(0);

#[path = "project_reader.rs"]
mod project_reader;
pub(crate) use project_reader::OwnedProjectMemoryWorkspace;
pub use project_reader::ProjectMemoryWorkspace;
use project_reader::{checked_project_root, collect_project_facts, deployment_inventory};

#[path = "documents.rs"]
mod documents;
pub use documents::{
    is_memory_document_path, read_local_memory_documents, NativeMemoryDocument,
    NativeMemoryDocuments,
};

#[path = "measurement.rs"]
mod measurement;
pub use measurement::{measure_local_memory, NativeMemoryMeasurements};

#[path = "preservation.rs"]
mod preservation;
pub use preservation::NativeMemoryPreservation;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    InvalidInput,
    Denied,
    Unavailable,
    StaleRoot,
    StaleInstallation,
    Cancelled,
    Timeout,
    Busy,
    Limit,
    Unsupported,
    Io,
    Store(StoreError),
    Contract(Vec<Issue>),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid native memory read input",
            Self::Denied => "native memory read is not authorized",
            Self::Unavailable => "required memory document is unavailable",
            Self::StaleRoot => "memory root changed; resolve it again",
            Self::StaleInstallation => "local installation identity changed; resolve again",
            Self::Cancelled => "native memory read was cancelled",
            Self::Timeout => "native memory read deadline exceeded",
            Self::Busy => "native memory readers are busy",
            Self::Limit => "native memory read limit exceeded",
            Self::Unsupported => "native memory reader is unsupported for this platform",
            Self::Io => "native memory read IO failed",
            Self::Store(_) => "local memory preferences are unavailable",
            Self::Contract(_) => "observed memory documents failed validation",
        })
    }
}

impl std::error::Error for ReadError {}

/// Implemented by the native owner using workspace authorization and secret-path
/// protection. Repository data and IPC booleans must not implement this authority.
pub trait MemoryReadAccess: Send + Sync {
    fn allows_metadata(&self, path: &Path) -> bool;
    /// Separates a readable workspace root from metadata-only discovery grants.
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.allows_metadata(path)
    }
    fn allows_read(&self, path: &Path) -> bool;
    fn allows_enumeration(&self, _path: &Path) -> bool {
        false
    }
}

#[derive(Clone)]
pub struct ReadControl {
    cancelled: Arc<AtomicBool>,
    started: Instant,
    timeout: Duration,
    diagnostics: crate::storage_diagnostics::StorageDiagnostics,
}

impl Default for ReadControl {
    fn default() -> Self {
        Self::new(Duration::from_secs(5))
    }
}

impl ReadControl {
    pub(crate) fn phase(cancelled: Arc<AtomicBool>, timeout: Duration) -> Self {
        Self {
            cancelled,
            started: Instant::now(),
            timeout,
            diagnostics: Default::default(),
        }
    }
    pub fn new(timeout: Duration) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            started: Instant::now(),
            timeout: timeout.min(Duration::from_secs(5)),
            diagnostics: Default::default(),
        }
    }

    pub fn with_storage_diagnostics(mut self) -> Self {
        self.diagnostics.enable();
        self
    }

    pub fn storage_failure(&self) -> Option<crate::StorageFailure> {
        self.diagnostics.failure()
    }

    pub(crate) fn record_storage_failure(
        &self,
        stage: crate::StorageStage,
        windows_error: Option<u32>,
    ) {
        self.diagnostics.record(stage, windows_error);
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(crate) fn deadline(&self) -> Instant {
        self.started + self.timeout
    }

    pub(crate) fn check(&self) -> Result<(), ReadError> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(ReadError::Cancelled)
        } else if self.started.elapsed() >= self.timeout {
            Err(ReadError::Timeout)
        } else {
            Ok(())
        }
    }
}

struct ReadPermit;

impl ReadPermit {
    fn acquire(control: &ReadControl) -> Result<Self, ReadError> {
        control.check()?;
        let mut active = ACTIVE_READS.load(Ordering::Acquire);
        loop {
            control.check()?;
            if active >= 4 {
                return Err(ReadError::Busy);
            }
            match ACTIVE_READS.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(Self),
                Err(current) => active = current,
            }
        }
    }
}

impl Drop for ReadPermit {
    fn drop(&mut self) {
        ACTIVE_READS.fetch_sub(1, Ordering::AcqRel);
    }
}

pub struct ProjectContextObservation {
    pub config: Value,
    pub instructions: Value,
    pub fingerprint: InstructionFingerprint,
    pub project: PathFact,
    pub context: PathFact,
}

pub struct NativeContextObservation {
    pub identity: Value,
    pub project_key: String,
    pub local_preferences: LocalMemorySnapshot,
    pub preference: Option<ProjectPreference>,
    pub config: Value,
    pub instructions: Value,
    pub fingerprint: InstructionFingerprint,
    pub project: PathFact,
    pub context: PathFact,
}

/// Resolves an explicitly requested local directory without creating state or
/// granting access. Callers must still capture their own read/write authority.
pub fn resolve_local_memory_directory(
    requested: &Path,
    control: &ReadControl,
) -> Result<PathBuf, ReadError> {
    let _permit = ReadPermit::acquire(control)?;
    resolve_memory_directory(requested, control)
}

fn resolve_memory_directory(requested: &Path, control: &ReadControl) -> Result<PathBuf, ReadError> {
    control.check()?;
    if !crate::path_policy::readable(requested.to_str().ok_or(ReadError::InvalidInput)?) {
        return Err(ReadError::Denied);
    }
    resolve_project_directory(requested, control).map(|(root, _)| root)
}

fn resolve_project_directory(
    requested: &Path,
    control: &ReadControl,
) -> Result<(PathBuf, platform::Directory), ReadError> {
    control.check()?;
    platform::ensure_supported()?;
    let text = requested.to_str().ok_or(ReadError::InvalidInput)?;
    if text.contains("://")
        || text.starts_with("//")
        || (text.starts_with(r"\\") && !text.starts_with(r"\\?\"))
    {
        return Err(ReadError::Unsupported);
    }
    #[cfg(not(windows))]
    if text.as_bytes().get(1) == Some(&b':') || text.contains('\\') {
        return Err(ReadError::Unsupported);
    }
    if !requested.is_absolute() {
        return Err(ReadError::Denied);
    }
    if text.len() > 4096 || requested.components().count() > 128 {
        return Err(ReadError::Limit);
    }
    platform::validate_requested_root(requested)?;
    let root = std::fs::canonicalize(requested).map_err(|_| ReadError::Io)?;
    control.check()?;
    platform::validate_requested_root(&root)?;
    let directory = platform::Directory::open_root(&root, control)?;
    #[cfg(unix)]
    directory.qualify_project_filesystem(control)?;
    if !crate::path_policy::readable(text) {
        return Err(ReadError::Denied);
    }
    let root = directory.canonical_root(&root)?;
    let text = root.to_str().ok_or(ReadError::InvalidInput)?;
    if !crate::path_policy::readable(text) {
        return Err(ReadError::Denied);
    }
    if text.len() > 4096 || root.components().count() > 128 {
        return Err(ReadError::Limit);
    }
    control.check()?;
    Ok((root, directory))
}

/// Metadata/configuration discovery without an installation identity. Directory
/// keys are invocation-local, never persistent project keys or trust receipts.
pub fn inspect_local_memory_scope(
    requested: &Path,
    access: &dyn MemoryReadAccess,
    control: &crate::DiscoveryControl,
) -> Result<crate::NativeScopeObservation, ReadError> {
    ProjectMemoryWorkspace::open(requested, access, &control.read_control()?)?
        .observe_scope(crate::DiscoveryPurpose::Discover, control)
}

/// Captures an authorized local execution root, not a resolved memory scope.
/// Keep remote/WSL/Docker selection in its native transport; never fall back here.
pub struct LocalMemoryWorkspace<'a> {
    root: PathBuf,
    root_id: (u64, u128),
    root_instance: Option<RootInstance>,
    identity: Value,
    project_key: String,
    store: &'a LocalMemoryStore,
    access: &'a dyn MemoryReadAccess,
}

pub(crate) struct OwnedMemoryWorkspace {
    root: PathBuf,
    root_id: (u64, u128),
    root_instance: Option<RootInstance>,
    identity: Value,
    project_key: String,
    store: Arc<LocalMemoryStore>,
    access: Arc<dyn MemoryReadAccess>,
}

impl OwnedMemoryWorkspace {
    pub(crate) fn review_binding(&self) -> Result<Value, ReadError> {
        let instance = self.root_instance.as_ref().ok_or(ReadError::Unsupported)?;
        Ok(json!({"identity":self.identity,"instance":instance}))
    }

    pub(crate) fn is_authorized(&self) -> bool {
        self.access.allows_workspace_root(&self.root) && self.access.allows_metadata(&self.root)
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn borrow(&self) -> LocalMemoryWorkspace<'_> {
        LocalMemoryWorkspace {
            root: self.root.clone(),
            root_id: self.root_id,
            root_instance: self.root_instance.clone(),
            identity: self.identity.clone(),
            project_key: self.project_key.clone(),
            store: &self.store,
            access: self.access.as_ref(),
        }
    }
}

impl<'a> LocalMemoryWorkspace<'a> {
    pub(crate) fn retain(
        &self,
        store: Arc<LocalMemoryStore>,
        access: Arc<dyn MemoryReadAccess>,
    ) -> Result<OwnedMemoryWorkspace, ReadError> {
        if !std::ptr::eq(self.store, store.as_ref())
            || !std::ptr::addr_eq(self.access, access.as_ref())
        {
            return Err(ReadError::Denied);
        }
        Ok(OwnedMemoryWorkspace {
            root: self.root.clone(),
            root_id: self.root_id,
            root_instance: self.root_instance.clone(),
            identity: self.identity.clone(),
            project_key: self.project_key.clone(),
            store,
            access,
        })
    }

    pub(crate) fn store(&self) -> &LocalMemoryStore {
        self.store
    }

    #[cfg(any(unix, windows))]
    pub(crate) fn access(&self) -> &dyn MemoryReadAccess {
        self.access
    }

    pub fn observe_scope(
        &self,
        purpose: crate::DiscoveryPurpose,
        control: &crate::DiscoveryControl,
    ) -> Result<crate::NativeScopeObservation, ReadError> {
        let phase = control.phase(Duration::from_secs(5));
        let _permit = ReadPermit::acquire(&phase)?;
        self.checked_root(&phase)?;
        let local = self.store.load().map_err(ReadError::Store)?;
        if self.identity["machineId"] != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        let observation = crate::discovery::gather(
            &self.root,
            local.installation_id(),
            self.access,
            purpose,
            control,
        )?;
        self.checked_root(&control.phase(Duration::from_secs(5)))?;
        let current = self.store.load().map_err(ReadError::Store)?;
        if current.installation_id() != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        if current.revision() != local.revision() {
            return Err(ReadError::Store(StoreError::Conflict));
        }
        control.phase(Duration::from_secs(5)).check()?;
        Ok(observation)
    }
    pub fn open(
        store: &'a LocalMemoryStore,
        requested: &Path,
        access: &'a dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<Self, ReadError> {
        platform::ensure_supported()?;
        let _permit = ReadPermit::acquire(control)?;
        let project = ProjectMemoryWorkspace::open_inner(requested, access, control)?;
        let local = store.load().map_err(ReadError::Store)?;
        control.check()?;
        let identity = json!({
            "schema":1, "kind":"local", "machineId":local.installation_id(),
            "filesystemId":project.filesystem_id, "canonicalRoot":project.canonical_root,
        });
        let project_key = memory_project_key(&identity.to_string()).map_err(ReadError::Contract)?;
        control.check()?;
        Ok(Self {
            root: project.root,
            root_id: project.root_id,
            root_instance: project.root_instance,
            identity,
            project_key,
            store,
            access,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn identity(&self) -> &Value {
        &self.identity
    }

    pub fn project_key(&self) -> &str {
        &self.project_key
    }

    /// Observes only this captured root's effective preference. It neither reads
    /// instructions nor establishes that an accepted digest is still current.
    pub fn observe_preference(
        &self,
        control: &ReadControl,
    ) -> Result<(LocalMemorySnapshot, Option<ProjectPreference>), ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        self.checked_root(control)?;
        let snapshot = self.store.load().map_err(ReadError::Store)?;
        if self.identity["machineId"] != snapshot.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        let preference = snapshot.project_for_root(&self.project_key, self.root_instance.as_ref());
        self.checked_root(control)?;
        Ok((snapshot, preference))
    }

    /// Records an explicit local choice without accepting instructions or enabling
    /// a session. The caller must retain its original native owner until settlement.
    pub fn set_policy(
        &self,
        revision: u64,
        policy: crate::MemoryPolicy,
        control: &ReadControl,
    ) -> Result<LocalMemorySnapshot, ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        self.checked_root(control)?;
        let root = self.root_instance.as_ref().ok_or(ReadError::Unsupported)?;
        control.check()?;
        let result = self
            .store
            .policy_for_root(
                revision,
                self.identity["machineId"]
                    .as_str()
                    .ok_or(ReadError::InvalidInput)?,
                &self.project_key,
                root,
                policy,
            )
            .map_err(ReadError::Store)?;
        self.checked_root(control)?;
        Ok(result)
    }

    pub fn observe_deployment(
        &self,
        links: RootLinks,
        control: &ReadControl,
    ) -> Result<BTreeMap<String, PathFact>, ReadError> {
        self.collect(&deployment_inventory(links), 1024 * 1024, control)
            .map(|(facts, _)| facts)
    }

    pub(crate) fn read_publication_artifact(
        &self,
        path: &str,
        control: &ReadControl,
    ) -> Result<PathFact, ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        let directory = self.checked_root(control)?;
        let fact = directory.read_text(&self.root, path, self.access, control)?;
        self.checked_root(control)?;
        Ok(fact)
    }

    pub fn observe_context(
        &self,
        role: Option<&str>,
        control: &ReadControl,
    ) -> Result<NativeContextObservation, ReadError> {
        let paths = context_inventory(role)?;
        let (facts, local_preferences) = self.collect(&paths, 2 * 1024 * 1024, control)?;
        let observed = project_context_observation(facts, role, control)?;
        Ok(NativeContextObservation {
            identity: self.identity.clone(),
            project_key: self.project_key.clone(),
            preference: local_preferences
                .project_for_root(&self.project_key, self.root_instance.as_ref()),
            local_preferences,
            config: observed.config,
            instructions: observed.instructions,
            fingerprint: observed.fingerprint,
            project: observed.project,
            context: observed.context,
        })
    }

    pub(crate) fn checked_root(
        &self,
        control: &ReadControl,
    ) -> Result<platform::Directory, ReadError> {
        checked_project_root(
            &self.root,
            self.root_id,
            &self.root_instance,
            self.identity["canonicalRoot"]
                .as_str()
                .ok_or(ReadError::InvalidInput)?,
            self.access,
            control,
        )
    }

    pub(crate) fn trust_instructions(
        &self,
        revision: u64,
        digest: &str,
        control: &ReadControl,
    ) -> Result<LocalMemorySnapshot, ReadError> {
        self.checked_root(control)?;
        let root = self.root_instance.as_ref().ok_or(ReadError::Unsupported)?;
        control.check()?;
        self.store
            .trust_for_root(
                revision,
                self.identity["machineId"]
                    .as_str()
                    .ok_or(ReadError::InvalidInput)?,
                &self.project_key,
                root,
                digest,
            )
            .map_err(ReadError::Store)
    }

    fn collect(
        &self,
        paths: &BTreeSet<String>,
        max_bytes: usize,
        control: &ReadControl,
    ) -> Result<(BTreeMap<String, PathFact>, LocalMemorySnapshot), ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        let directory = self.checked_root(control)?;
        let local = self.store.load().map_err(ReadError::Store)?;
        if self.identity["machineId"] != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        let facts = collect_project_facts(
            &directory,
            &self.root,
            self.access,
            paths,
            max_bytes,
            control,
        )?;
        self.checked_root(control)?;
        let current = self.store.load().map_err(ReadError::Store)?;
        if current.installation_id() != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        if current.revision() != local.revision() {
            return Err(ReadError::Store(StoreError::Conflict));
        }
        control.check()?;
        Ok((facts, current))
    }
}

fn inventory(bases_only: bool) -> BTreeSet<String> {
    let manifest: Value =
        serde_json::from_str(resource("manifest.json").expect("embedded manifest"))
            .expect("validated manifest");
    manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .filter(|entry| entry["kind"] != "link" && (!bases_only || entry["kind"] == "base"))
        .map(|entry| {
            format!(
                ".voktty/{}",
                entry["source"]
                    .as_str()
                    .expect("source")
                    .strip_prefix("dot-voktty/")
                    .expect("kit source")
            )
        })
        .collect()
}

pub(crate) fn fact_value(fact: &PathFact) -> Value {
    match fact {
        PathFact::File { text } => json!({"kind":"file","text":text}),
        PathFact::Absent => json!({"kind":"absent"}),
        PathFact::Blocked => json!({"kind":"blocked"}),
    }
}

fn context_inventory(role: Option<&str>) -> Result<BTreeSet<String>, ReadError> {
    let mut paths = inventory(true);
    if let Some(role) = role {
        let name = role
            .strip_prefix(".voktty/team/roles/")
            .and_then(|s| s.strip_suffix(".md"));
        if role.len() > 256
            || !name.is_some_and(|s| {
                !s.is_empty()
                    && s.bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            })
        {
            return Err(ReadError::InvalidInput);
        }
        paths.insert(role.into());
    }
    paths.extend(["AGENTS.md".into(), "CLAUDE.md".into()]);
    paths.extend([
        ".voktty/kit.json".into(),
        ".voktty/PROJECT.md".into(),
        ".voktty/CONTEXT.md".into(),
    ]);
    Ok(paths)
}

fn project_context_observation(
    mut facts: BTreeMap<String, PathFact>,
    role: Option<&str>,
    control: &ReadControl,
) -> Result<ProjectContextObservation, ReadError> {
    let mut instruction_paths = inventory(true);
    instruction_paths.extend(["AGENTS.md".into(), "CLAUDE.md".into()]);
    if let Some(role) = role {
        instruction_paths.insert(role.into());
    }
    let instructions = json!({"schema":1,"role":role,"files":instruction_paths.iter().map(|path| json!({"path":path,"fact":fact_value(&facts[path])})).collect::<Vec<_>>()});
    let fingerprint =
        instruction_fingerprint(&instructions.to_string()).map_err(ReadError::Contract)?;
    let config = match &facts[".voktty/kit.json"] {
        PathFact::File { text } => parse_kit_config(text).map_err(ReadError::Contract)?,
        _ => return Err(ReadError::Unavailable),
    };
    let project = facts.remove(".voktty/PROJECT.md").expect("fixed inventory");
    let context = facts.remove(".voktty/CONTEXT.md").expect("fixed inventory");
    if !matches!(project, PathFact::File { .. }) || !matches!(context, PathFact::File { .. }) {
        return Err(ReadError::Unavailable);
    }
    control.check()?;
    Ok(ProjectContextObservation {
        config,
        instructions,
        fingerprint,
        project,
        context,
    })
}
