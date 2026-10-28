use super::{
    LocalMemoryStore, MemoryJob, MemoryWorkError, MemoryWorkers, PathBuf, ReadControl, ReadError,
};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use voktty_memory_local::MemoryStoreMode;

/// Captures only the native application's storage origin. Construction performs
/// no IO and never uses a selected project or serialized environment as fallback.
pub struct NativeMemoryStorage {
    parent: PathBuf,
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;

impl NativeMemoryStorage {
    #[cfg(test)]
    pub(super) fn test_origin(parent: PathBuf) -> Self {
        Self { parent }
    }

    pub fn capture<R: Runtime>(app: &AppHandle<R>) -> Result<Self, MemoryWorkError> {
        Ok(Self {
            parent: app
                .path()
                .app_local_data_dir()
                .map_err(|_| ReadError::Unavailable)?,
        })
    }

    pub fn open(
        &self,
        control: ReadControl,
    ) -> Result<MemoryJob<Arc<LocalMemoryStore>>, MemoryWorkError> {
        MemoryWorkers::default().store(self.parent.clone(), MemoryStoreMode::OpenExisting, control)
    }

    pub fn initialize(
        &self,
        control: ReadControl,
    ) -> Result<MemoryJob<Arc<LocalMemoryStore>>, MemoryWorkError> {
        MemoryWorkers::default().store(self.parent.clone(), MemoryStoreMode::Initialize, control)
    }
}
