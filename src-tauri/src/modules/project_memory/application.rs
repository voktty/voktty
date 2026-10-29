use super::*;
use std::collections::HashMap;
use std::sync::{Mutex, Weak};
use tauri::{Manager, Resource, ResourceId, Runtime, WebviewWindow, WindowEvent};
use voktty_memory_local::MemoryStoreMode;

pub struct NativeMemoryApplication {
    storage: Result<NativeMemoryStorage, MemoryWorkError>,
    owners: Arc<Mutex<Option<NativeMemoryOwners>>>,
    bindings: Mutex<HashMap<String, (ResourceId, Weak<NativeMemoryWindow>)>>,
}

pub struct NativeMemoryWindow {
    owners: Weak<Mutex<Option<NativeMemoryOwners>>>,
    receipt: NativeMemoryWindowReceipt,
}

impl NativeMemoryWindow {
    pub(super) fn close_presentation(&self, presentation: &NativeMemoryPresentationReceipt) {
        if let Some(owners) = self.owners.upgrade() {
            let mut owners = owners
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(owners) = owners.as_mut() {
                owners.close_presentation(&self.receipt, presentation);
            }
        }
    }

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
    #[cfg(test)]
    pub(super) fn test_origin(storage: NativeMemoryStorage) -> (Self, Arc<NativeMemoryWindow>) {
        let app = Self {
            storage: Ok(storage),
            owners: Arc::new(Mutex::new(Some(NativeMemoryOwners::default()))),
            bindings: Mutex::new(HashMap::new()),
        };
        let window = app.register_window("main").unwrap();
        (app, window)
    }

    pub fn capture<R: Runtime>(app: &tauri::AppHandle<R>) -> Self {
        Self {
            storage: NativeMemoryStorage::capture(app),
            owners: Arc::new(Mutex::new(Some(NativeMemoryOwners::default()))),
            bindings: Mutex::new(HashMap::new()),
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
        let id = window.resources_table().add_arc(owner.clone());
        let result = self
            .bindings
            .lock()
            .map_err(|_| ReadError::Unavailable)
            .and_then(|mut bindings| {
                bindings.retain(|_, (_, owner)| {
                    owner
                        .upgrade()
                        .is_some_and(|owner| self.window_is_current(&owner))
                });
                if !self.window_is_current(&owner) {
                    return Err(ReadError::Cancelled);
                }
                bindings.insert(window.label().to_owned(), (id, Arc::downgrade(&owner)));
                Ok(id)
            });
        if result.is_err() {
            let mut table = window.resources_table();
            if table
                .get::<NativeMemoryWindow>(id)
                .is_ok_and(|stored| Arc::ptr_eq(&stored, &owner))
            {
                let _ = table.take::<NativeMemoryWindow>(id);
            }
            owner.retire();
        }
        result.map_err(Into::into)
    }

    pub(super) fn window_is_current(&self, window: &NativeMemoryWindow) -> bool {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.is_window_current(receipt))
        })
        .unwrap_or(false)
    }

    pub(super) fn bound_window<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
    ) -> Result<Arc<NativeMemoryWindow>, MemoryWorkError> {
        let (id, expected) = self
            .bindings
            .lock()
            .map_err(|_| ReadError::Unavailable)?
            .get(window.label())
            .cloned()
            .ok_or(ReadError::Cancelled)?;
        self.resolve_binding(&window.resources_table(), id, &expected)
    }

    fn resolve_binding(
        &self,
        table: &tauri::ResourceTable,
        id: ResourceId,
        expected: &Weak<NativeMemoryWindow>,
    ) -> Result<Arc<NativeMemoryWindow>, MemoryWorkError> {
        let owner = table
            .get::<NativeMemoryWindow>(id)
            .map_err(|_| ReadError::Cancelled)?;
        if !expected
            .upgrade()
            .is_some_and(|expected| Arc::ptr_eq(&expected, &owner))
            || !self.window_is_current(&owner)
        {
            return Err(ReadError::Cancelled.into());
        }
        Ok(owner)
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

    pub fn select_with_inspection(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
    ) -> Result<NativeMemorySelectionReceipt, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            owners.select_with_inspection(receipt, presentation, registry, requested, environment)
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

#[path = "application_reviews.rs"]
mod reviews;
