use crate::modules::workspace::{RegistrySnapshotError, WorkspaceEnv, WorkspaceRegistry};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use voktty_memory_local::{
    path_policy, DiscoveryControl, DiscoveryPurpose, LocalMemoryStore, MemoryJob, MemoryReadAccess,
    MemoryWorkError, MemoryWorkers, NativeContextObservation, NativeScopeObservation, ReadControl,
    ReadError,
};

struct Access {
    roots: Vec<PathBuf>,
    ancestor_inspection: Option<PathBuf>,
    live: AtomicBool,
}

fn native_spelling(path: &Path) -> Result<PathBuf, ReadError> {
    path.to_str().ok_or(ReadError::InvalidInput)?;
    #[cfg(windows)]
    {
        Ok(PathBuf::from(voktty_paths::canonical_display_path(path)))
    }
    #[cfg(not(windows))]
    {
        Ok(path.to_path_buf())
    }
}

fn authorized_roots(registry: &WorkspaceRegistry) -> Result<Vec<PathBuf>, MemoryWorkError> {
    registry
        .snapshot_authorized_roots(256, 1024 * 1024)
        .map_err(|error| {
            MemoryWorkError::Read(match error {
                RegistrySnapshotError::Unavailable => ReadError::Denied,
                RegistrySnapshotError::Limit => ReadError::Limit,
            })
        })?
        .iter()
        .map(|root| native_spelling(root))
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

impl Access {
    fn inspection_allows(&self, path: &Path, suffix: Option<&Path>) -> bool {
        let Some(anchor) = &self.ancestor_inspection else {
            return false;
        };
        if !self.live.load(Ordering::Acquire) {
            return false;
        }
        let Ok(path) = native_spelling(path) else {
            return false;
        };
        anchor.ancestors().skip(1).any(|ancestor| {
            let expected = suffix.map_or_else(|| ancestor.to_owned(), |s| ancestor.join(s));
            path == expected && path.to_str().is_some_and(path_policy::readable)
        })
    }

    fn authorized(&self, path: &Path) -> bool {
        let Ok(path) = native_spelling(path) else {
            return false;
        };
        self.live.load(Ordering::Acquire)
            && path.is_absolute()
            && !path.components().any(|c| matches!(c, Component::ParentDir))
            && self.roots.iter().any(|root| path.starts_with(root))
    }
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.authorized(path)
            || self.inspection_allows(path, None)
            || self.inspection_allows(path, Some(Path::new(".voktty")))
            || self.inspection_allows(path, Some(Path::new(".voktty/kit.json")))
            || (!path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
                && path.parent().is_some_and(|parent| {
                    self.inspection_allows(parent, Some(Path::new(".voktty")))
                }))
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.authorized(path) && path.to_str().is_some_and(path_policy::readable)
    }
    fn allows_read(&self, path: &Path) -> bool {
        (self.authorized(path) && path.to_str().is_some_and(path_policy::readable))
            || self.inspection_allows(path, Some(Path::new(".voktty/kit.json")))
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.authorized(path) || self.inspection_allows(path, Some(Path::new(".voktty")))
    }
}

/// An owned local source captured from native workspace authorization. It cannot
/// be deserialized from repository data or used as a write or instruction grant.
pub struct NativeMemorySource {
    requested: PathBuf,
    access: Arc<Access>,
}

pub struct NativeMemoryRead<T> {
    job: MemoryJob<T>,
    access: Arc<Access>,
}
impl<T> NativeMemoryRead<T> {
    pub async fn finish(self) -> Result<T, MemoryWorkError> {
        let result = self.job.finish().await;
        if !self.access.live.load(Ordering::Acquire) {
            return Err(ReadError::Cancelled.into());
        }
        result
    }
}

impl NativeMemorySource {
    pub fn capture(
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
    ) -> Result<Self, MemoryWorkError> {
        Self::capture_with_inspection(registry, requested, environment, None)
    }

    fn capture_with_inspection(
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
        ancestor_inspection: Option<PathBuf>,
    ) -> Result<Self, MemoryWorkError> {
        if !matches!(environment, WorkspaceEnv::Local) {
            return Err(ReadError::Unsupported.into());
        }
        let text = requested.to_str().ok_or(ReadError::InvalidInput)?;
        if text.starts_with("remote://")
            || text.starts_with("//")
            || (text.starts_with(r"\\") && !text.starts_with(r"\\?\"))
            || text.starts_with(r"\\?\UNC\")
            || text.starts_with(r"\\?\GLOBALROOT\")
        {
            return Err(ReadError::Unsupported.into());
        }
        if !requested.is_absolute()
            || text.chars().any(|c| c <= '\u{001f}')
            || requested
                .components()
                .any(|c| matches!(c, Component::ParentDir))
        {
            return Err(ReadError::InvalidInput.into());
        }
        if text.len() > 4096 || requested.components().count() > 128 {
            return Err(ReadError::Limit.into());
        }
        let roots = authorized_roots(registry)?;
        let access = Arc::new(Access {
            roots,
            ancestor_inspection,
            live: AtomicBool::new(true),
        });
        if !access.allows_workspace_root(&requested) {
            return Err(ReadError::Denied.into());
        }
        Ok(Self { requested, access })
    }

    pub fn scope(
        &self,
        store: Arc<LocalMemoryStore>,
        purpose: DiscoveryPurpose,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryRead<NativeScopeObservation>, MemoryWorkError> {
        Ok(NativeMemoryRead {
            job: MemoryWorkers::default().scope(
                store,
                self.requested.clone(),
                self.access.clone(),
                purpose,
                control,
            )?,
            access: self.access.clone(),
        })
    }

    pub fn context(
        &self,
        store: Arc<LocalMemoryStore>,
        role: Option<String>,
        control: ReadControl,
    ) -> Result<NativeMemoryRead<NativeContextObservation>, MemoryWorkError> {
        Ok(NativeMemoryRead {
            job: MemoryWorkers::default().context(
                store,
                self.requested.clone(),
                self.access.clone(),
                role,
                control,
            )?,
            access: self.access.clone(),
        })
    }
}
impl Drop for NativeMemorySource {
    fn drop(&mut self) {
        self.access.live.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod ancestor_inspection_tests;

mod selection;
pub use selection::{NativeMemorySelection, NativeMemorySelectionReceipt};

mod trust;
pub use trust::{
    NativeMemoryTrustRead, NativeMemoryTrustReservation, NativeMemoryTrustReview,
    NativeMemoryTrustSnapshot, NativeMemoryTrustWrite,
};

mod policy;
pub use policy::{
    NativeMemoryPolicyRead, NativeMemoryPolicyReservation, NativeMemoryPolicyReview,
    NativeMemoryPolicySnapshot, NativeMemoryPolicyWrite,
};

mod context;
pub use context::{
    NativeMemoryContextBinding, NativeMemoryContextReceipt, NativeMemoryContextTarget,
    NativeMemoryPreparedContext,
};

mod deployment;
mod write_authority;
pub use deployment::{
    NativeMemoryPreparedPreview, NativeMemoryPreviewRead, NativeMemoryPreviewReceipt,
    NativeMemoryPreviewRequest, NativeMemoryPreviewSnapshot, NativeMemoryPreviewTarget,
    NativeMemoryPreviewValues, NativeMemoryPublication,
};

mod storage;
pub use storage::NativeMemoryStorage;

mod owners;
pub use owners::{NativeMemoryOwners, NativeMemoryPresentationReceipt, NativeMemoryWindowReceipt};

mod application;
pub use application::{NativeMemoryApplication, NativeMemoryWindow};

pub mod commands;
