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

impl Access {
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
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.authorized(path) && path.to_str().is_some_and(path_policy::readable)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.authorized(path) && path.to_str().is_some_and(path_policy::readable)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.authorized(path)
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
        let roots = registry
            .snapshot_authorized_roots(256, 1024 * 1024)
            .map_err(|error| {
                MemoryWorkError::Read(match error {
                    RegistrySnapshotError::Unavailable => ReadError::Denied,
                    RegistrySnapshotError::Limit => ReadError::Limit,
                })
            })?
            .iter()
            .map(|root| native_spelling(root))
            .collect::<Result<Vec<_>, _>>()?;
        let access = Arc::new(Access {
            roots,
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

mod selection;
pub use selection::{NativeMemorySelection, NativeMemorySelectionReceipt};

mod deployment;
pub use deployment::{
    NativeMemoryPreparedPreview, NativeMemoryPreviewRead, NativeMemoryPreviewReceipt,
    NativeMemoryPreviewRequest, NativeMemoryPublication,
};

mod storage;
pub use storage::NativeMemoryStorage;

mod owners;
pub use owners::{NativeMemoryOwners, NativeMemoryPresentationReceipt, NativeMemoryWindowReceipt};

mod application;
pub use application::{NativeMemoryApplication, NativeMemoryWindow};

pub mod commands;
