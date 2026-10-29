//! Native local memory storage and bounded observations. Store callers own a
//! private application directory, never selected by repository data or transports.
//! Successful reads are observations, not permission to deliver context or do IO.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple_acl;
mod application;
mod bootstrap;
mod discovery;
pub mod path_policy;
mod preferences;
mod publication;
mod reader;
mod workers;
pub use discovery::{DiscoveryControl, DiscoveryPurpose, NativeScopeObservation, ScopeDirectory};
pub use publication::{
    InitializationPreview, MemoryWriteAccess, OwnedInitializationPreview, PublicationError,
    PublicationFailure, PublicationReport, PublicationWriteRequirements, RecoveryFile,
};
pub use workers::{
    MemoryDeploymentJob, MemoryDeploymentWorkError, MemoryJob, MemoryPreviewRequest,
    MemoryStoreMode, MemoryTrustError, MemoryTrustJob, MemoryTrustReview, MemoryWorkError,
    MemoryWorkers,
};
#[cfg(not(any(unix, windows)))]
mod reader_unavailable;
#[cfg(unix)]
mod reader_unix;
#[cfg(windows)]
mod reader_windows;

pub use reader::{
    LocalMemoryWorkspace, MemoryReadAccess, NativeContextObservation, ReadControl, ReadError,
};

const STORE: &str = "memory-local.json";
const LOCK: &str = "memory-local.lock";
const DEPLOYMENT_LOCK: &str = "memory-deployment.lock";
const MAX_BYTES: u64 = 256 * 1024;
const MAX_PROJECTS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreError {
    InvalidInput,
    InvalidStore,
    Missing,
    Busy,
    Conflict,
    Limit,
    Io,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid local memory store input",
            Self::InvalidStore => "local memory store is invalid; review is required",
            Self::Missing => "local memory store has not been initialized",
            Self::Busy => "local memory store is busy",
            Self::Conflict => "local memory preferences changed; reload before accepting",
            Self::Limit => "local memory store limit reached",
            Self::Io => "local memory store IO failed",
        })
    }
}

impl std::error::Error for StoreError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryPolicy {
    #[serde(alias = "ask")]
    Manual,
    Always,
    Never,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectPreference {
    pub project_key: String,
    pub policy: MemoryPolicy,
    pub instruction_digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalMemorySnapshot {
    schema: u8,
    installation_id: String,
    revision: u64,
    projects: Vec<ProjectPreference>,
    #[serde(
        default,
        deserialize_with = "preferences::RootBindings::deserialize",
        skip_serializing_if = "preferences::RootBindings::is_legacy"
    )]
    bindings: preferences::RootBindings,
}

impl LocalMemorySnapshot {
    pub fn installation_id(&self) -> &str {
        &self.installation_id
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn project(&self, key: &str) -> Option<&ProjectPreference> {
        self.projects.iter().find(|entry| entry.project_key == key)
    }

    fn validate(&self) -> Result<(), StoreError> {
        let id = Uuid::parse_str(&self.installation_id).map_err(|_| StoreError::InvalidStore)?;
        if id.get_version_num() != 4
            || id.get_variant() != uuid::Variant::RFC4122
            || id.to_string() != self.installation_id
            || self.projects.len() > MAX_PROJECTS
        {
            return Err(StoreError::InvalidStore);
        }
        let mut keys = HashSet::new();
        for entry in &self.projects {
            if !digest(&entry.project_key)
                || !keys.insert(&entry.project_key)
                || entry
                    .instruction_digest
                    .as_ref()
                    .is_some_and(|s| !digest(s))
            {
                return Err(StoreError::InvalidStore);
            }
        }
        if !self.bindings.valid(self.schema, &keys) {
            return Err(StoreError::InvalidStore);
        }
        Ok(())
    }
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// Requires an existing, native-owned application directory on a local filesystem.
/// No workspace authorization is created, inherited or persisted by this API.
pub struct LocalMemoryStore {
    directory: PathBuf,
}

/// Serializes cooperating publishers in this native installation, including
/// overlapping parent/child destinations. It grants no workspace write access.
/// Keep this owned by the worker until all publication IO has settled.
#[must_use = "dropping the deployment lock releases publication exclusion"]
pub struct LocalDeploymentLock<'a> {
    _store: &'a LocalMemoryStore,
    _file: File,
}

impl LocalMemoryStore {
    pub fn open(directory: &Path) -> Result<Self, StoreError> {
        if !directory.is_absolute() {
            return Err(StoreError::InvalidInput);
        }
        let metadata = fs::symlink_metadata(directory).map_err(|_| StoreError::Io)?;
        if !metadata.is_dir() || is_link(&metadata) {
            return Err(StoreError::InvalidInput);
        }
        #[cfg(unix)]
        if !owned_and_not_shared_writable(&metadata) {
            return Err(StoreError::InvalidInput);
        }
        let directory = fs::canonicalize(directory).map_err(|_| StoreError::Io)?;
        Ok(Self { directory })
    }

    /// Acquires publication exclusion without waiting or initializing identity.
    /// Scope, destination, preferences and accepted bytes must be revalidated
    /// after acquiring it. Do not hold it while waiting for user acceptance.
    pub fn try_lock_deployment(&self) -> Result<LocalDeploymentLock<'_>, StoreError> {
        Ok(LocalDeploymentLock {
            _store: self,
            _file: self.lock_named(DEPLOYMENT_LOCK)?,
        })
    }

    /// Explicitly creates an installation identity only if the store is absent.
    /// Corrupt, oversized and unsupported stores are never replaced automatically.
    pub fn initialize(&self) -> Result<LocalMemorySnapshot, StoreError> {
        let _lock = self.lock()?;
        match self.read() {
            Ok(snapshot) => Ok(snapshot),
            Err(StoreError::Missing) => {
                let snapshot = LocalMemorySnapshot {
                    schema: 1,
                    installation_id: Uuid::new_v4().to_string(),
                    revision: 0,
                    projects: Vec::new(),
                    bindings: preferences::RootBindings::Legacy,
                };
                self.write(&snapshot)?;
                Ok(snapshot)
            }
            Err(error) => Err(error),
        }
    }

    pub fn load(&self) -> Result<LocalMemorySnapshot, StoreError> {
        let _lock = self.lock()?;
        self.read()
    }

    pub fn set_policy(
        &self,
        revision: u64,
        key: &str,
        policy: MemoryPolicy,
    ) -> Result<LocalMemorySnapshot, StoreError> {
        self.update(revision, key, |entry| entry.policy = policy)
    }

    /// The caller must obtain and review the digest through its native reader.
    /// Storing it grants neither session consent nor capture consent.
    pub fn trust_instructions(
        &self,
        revision: u64,
        key: &str,
        instruction_digest: &str,
    ) -> Result<LocalMemorySnapshot, StoreError> {
        if !digest(instruction_digest) {
            return Err(StoreError::InvalidInput);
        }
        self.update(revision, key, |entry| {
            entry.instruction_digest = Some(instruction_digest.to_owned());
        })
    }

    pub fn revoke_trust(
        &self,
        revision: u64,
        key: &str,
    ) -> Result<LocalMemorySnapshot, StoreError> {
        self.update(revision, key, |entry| entry.instruction_digest = None)
    }

    fn update(
        &self,
        revision: u64,
        key: &str,
        change: impl FnOnce(&mut ProjectPreference),
    ) -> Result<LocalMemorySnapshot, StoreError> {
        self.update_snapshot(revision, key, None, |snapshot, index| {
            change(&mut snapshot.projects[index])
        })
    }

    fn update_snapshot(
        &self,
        revision: u64,
        key: &str,
        installation: Option<&str>,
        change: impl FnOnce(&mut LocalMemorySnapshot, usize),
    ) -> Result<LocalMemorySnapshot, StoreError> {
        if !digest(key) {
            return Err(StoreError::InvalidInput);
        }
        let _lock = self.lock()?;
        let mut snapshot = self.read()?;
        if snapshot.revision != revision
            || installation.is_some_and(|installation| installation != snapshot.installation_id)
        {
            return Err(StoreError::Conflict);
        }
        let index = match snapshot
            .projects
            .iter()
            .position(|entry| entry.project_key == key)
        {
            Some(index) => index,
            None => {
                if snapshot.projects.len() == MAX_PROJECTS {
                    return Err(StoreError::Limit);
                }
                snapshot.projects.push(ProjectPreference {
                    project_key: key.to_owned(),
                    policy: MemoryPolicy::Manual,
                    instruction_digest: None,
                });
                snapshot.projects.len() - 1
            }
        };
        change(&mut snapshot, index);
        snapshot.revision = snapshot.revision.checked_add(1).ok_or(StoreError::Limit)?;
        snapshot
            .projects
            .sort_by(|a, b| a.project_key.cmp(&b.project_key));
        self.write(&snapshot)?;
        Ok(snapshot)
    }

    fn lock(&self) -> Result<File, StoreError> {
        self.lock_named(LOCK)
    }

    fn lock_named(&self, name: &str) -> Result<File, StoreError> {
        let file = regular_file(&self.directory.join(name), true, true)?;
        match file.try_lock() {
            Ok(()) => Ok(file),
            Err(TryLockError::WouldBlock) => Err(StoreError::Busy),
            Err(TryLockError::Error(_)) => Err(StoreError::Io),
        }
    }

    fn read(&self) -> Result<LocalMemorySnapshot, StoreError> {
        let file = regular_file(&self.directory.join(STORE), false, false)?;
        if file.metadata().map_err(|_| StoreError::Io)?.len() > MAX_BYTES {
            return Err(StoreError::InvalidStore);
        }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| StoreError::Io)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(StoreError::InvalidStore);
        }
        let snapshot: LocalMemorySnapshot =
            serde_json::from_slice(&bytes).map_err(|_| StoreError::InvalidStore)?;
        snapshot.validate()?;
        Ok(snapshot)
    }

    fn write(&self, snapshot: &LocalMemorySnapshot) -> Result<(), StoreError> {
        snapshot.validate()?;
        let bytes = serde_json::to_vec_pretty(snapshot).map_err(|_| StoreError::InvalidStore)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(StoreError::Limit);
        }
        let mut staging = tempfile::Builder::new()
            .prefix(".memory-local-")
            .tempfile_in(&self.directory)
            .map_err(|_| StoreError::Io)?;
        staging.write_all(&bytes).map_err(|_| StoreError::Io)?;
        staging.as_file().sync_all().map_err(|_| StoreError::Io)?;
        staging
            .persist(self.directory.join(STORE))
            .map_err(|_| StoreError::Io)?;
        #[cfg(unix)]
        File::open(&self.directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| StoreError::Io)?;
        Ok(())
    }
}

fn regular_file(path: &Path, write: bool, create: bool) -> Result<File, StoreError> {
    let mut options = OpenOptions::new();
    options.read(true).write(write).create(create);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StoreError::Missing
        } else {
            StoreError::Io
        }
    })?;
    let metadata = file.metadata().map_err(|_| StoreError::Io)?;
    if !metadata.is_file() || is_link(&metadata) {
        return Err(StoreError::InvalidStore);
    }
    #[cfg(windows)]
    reader_windows::qualify_state_file(&file).map_err(|_| StoreError::InvalidStore)?;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    apple_acl::restrictive_only(&file).map_err(|_| StoreError::InvalidStore)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 || !owned_and_not_shared_writable(&metadata) {
            return Err(StoreError::InvalidStore);
        }
    }
    Ok(file)
}

#[cfg(unix)]
fn owned_and_not_shared_writable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    // The store carries consent, so another local account must not control it.
    metadata.uid() == unsafe { libc::geteuid() } && metadata.mode() & 0o022 == 0
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}
