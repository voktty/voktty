use super::*;
use std::sync::{Mutex, Weak};
use tauri::{Manager, Resource, ResourceId, Runtime, WebviewWindow, WindowEvent};
use voktty_memory_local::MemoryStoreMode;

pub struct NativeMemoryApplication {
    storage: Result<NativeMemoryStorage, MemoryWorkError>,
    owners: Arc<Mutex<Option<NativeMemoryOwners>>>,
}

pub struct NativeMemoryWindow {
    owners: Weak<Mutex<Option<NativeMemoryOwners>>>,
    receipt: NativeMemoryWindowReceipt,
}

impl NativeMemoryWindow {
    pub fn retire(&self) {
        if let Some(owners) = self.owners.upgrade() {
            let mut owners = owners
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(owners) = owners.as_mut() {
                owners.retire_window(&self.receipt);
            }
        }
    }

    fn observe(&self, event: &WindowEvent) {
        if matches!(event, WindowEvent::Destroyed) {
            self.retire();
        }
    }
}

impl Resource for NativeMemoryWindow {
    fn close(self: Arc<Self>) {
        self.retire();
    }
}

impl Drop for NativeMemoryWindow {
    fn drop(&mut self) {
        self.retire();
    }
}

impl NativeMemoryApplication {
    pub fn capture<R: Runtime>(app: &tauri::AppHandle<R>) -> Self {
        Self {
            storage: NativeMemoryStorage::capture(app),
            owners: Arc::new(Mutex::new(Some(NativeMemoryOwners::default()))),
        }
    }

    fn register_window(&self, label: &str) -> Result<Arc<NativeMemoryWindow>, MemoryWorkError> {
        let mut owners = self.owners.lock().map_err(|_| ReadError::Unavailable)?;
        let receipt = owners
            .as_mut()
            .ok_or(ReadError::Cancelled)?
            .register_window(label)?;
        Ok(Arc::new(NativeMemoryWindow {
            owners: Arc::downgrade(&self.owners),
            receipt,
        }))
    }

    pub fn attach_window<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
    ) -> Result<ResourceId, MemoryWorkError> {
        let owner = self.register_window(window.label())?;
        let observed = owner.clone();
        window.on_window_event(move |event| observed.observe(event));
        Ok(window.resources_table().add_arc(owner))
    }

    fn with_owners<T>(
        &self,
        window: &NativeMemoryWindow,
        action: impl FnOnce(
            &mut NativeMemoryOwners,
            &NativeMemoryWindowReceipt,
        ) -> Result<T, MemoryWorkError>,
    ) -> Result<T, MemoryWorkError> {
        if !Weak::ptr_eq(&window.owners, &Arc::downgrade(&self.owners)) {
            return Err(ReadError::Cancelled.into());
        }
        let mut owners = self.owners.lock().map_err(|_| ReadError::Unavailable)?;
        action(
            owners.as_mut().ok_or(ReadError::Cancelled)?,
            &window.receipt,
        )
    }

    pub fn open_presentation(
        &self,
        window: &NativeMemoryWindow,
    ) -> Result<NativeMemoryPresentationReceipt, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| owners.open_presentation(receipt))
    }

    pub fn close_presentation(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
    ) -> Result<bool, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.close_presentation(receipt, presentation))
        })
    }

    pub fn select(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
    ) -> Result<NativeMemorySelectionReceipt, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            owners.select(receipt, presentation, registry, requested, environment)
        })
    }

    pub fn is_current(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
    ) -> bool {
        self.with_owners(window, |owners, receipt| {
            Ok(owners
                .selection(receipt, presentation)?
                .is_current(selected))
        })
        .unwrap_or(false)
    }

    pub fn discover(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        store: Arc<LocalMemoryStore>,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryRead<NativeScopeObservation>, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            owners.selection(receipt, presentation)?.scope(
                selected,
                store,
                DiscoveryPurpose::Discover,
                control,
            )
        })
    }

    pub async fn store(
        &self,
        window: &NativeMemoryWindow,
        mode: MemoryStoreMode,
        control: ReadControl,
    ) -> Result<Arc<LocalMemoryStore>, MemoryWorkError> {
        let job = self.with_owners(window, |owners, receipt| {
            if !owners.is_window_current(receipt) {
                return Err(ReadError::Cancelled.into());
            }
            let storage = self.storage.as_ref().map_err(Clone::clone)?;
            match mode {
                MemoryStoreMode::OpenExisting => storage.open(control),
                MemoryStoreMode::Initialize => storage.initialize(control),
            }
        })?;
        let result = job.finish().await;
        self.with_owners(window, |owners, receipt| {
            if !owners.is_window_current(receipt) {
                return Err(ReadError::Cancelled.into());
            }
            result
        })
    }

    pub fn shutdown(&self) {
        *self
            .owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }
}

#[cfg(test)]
#[path = "application_tests.rs"]
mod tests;
