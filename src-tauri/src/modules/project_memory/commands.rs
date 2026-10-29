use super::*;
use serde::{Deserialize, Serialize};
use std::sync::{atomic::AtomicBool, Mutex};
use tauri::{Manager, Resource, ResourceId, ResourceTable, State, WebviewWindow};
use voktty_memory_local::MemoryStoreMode;
use voktty_workspace_kit::MemoryScope;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationHandle {
    id: ResourceId,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCommandError {
    code: &'static str,
}

impl From<MemoryWorkError> for MemoryCommandError {
    fn from(error: MemoryWorkError) -> Self {
        use voktty_memory_local::StoreError;
        let code = match error {
            MemoryWorkError::Read(error) => match error {
                ReadError::InvalidInput => "invalidInput",
                ReadError::Denied => "denied",
                ReadError::Cancelled => "cancelled",
                ReadError::Timeout => "timeout",
                ReadError::Busy | ReadError::Store(StoreError::Busy) => "busy",
                ReadError::Limit | ReadError::Store(StoreError::Limit) => "limit",
                ReadError::Unsupported => "unsupported",
                ReadError::Store(StoreError::Missing) => "missingState",
                ReadError::Store(StoreError::InvalidStore) => "invalidState",
                ReadError::StaleRoot | ReadError::StaleInstallation => "stale",
                _ => "unavailable",
            },
            _ => "unavailable",
        };
        Self { code }
    }
}

fn cancelled() -> MemoryCommandError {
    MemoryWorkError::Read(ReadError::Cancelled).into()
}

struct Selected {
    token: String,
    receipt: NativeMemorySelectionReceipt,
    reviews: deployment::CommandReviews,
    trust: trust::CommandTrust,
    policy: policy::CommandPolicy,
}

#[derive(Default)]
struct SelectionState {
    revision: u64,
    selected: Option<Selected>,
}

struct PresentationResource {
    token: String,
    window: Arc<NativeMemoryWindow>,
    receipt: NativeMemoryPresentationReceipt,
    selected: Mutex<SelectionState>,
    live: AtomicBool,
}

impl PresentationResource {
    fn retire(&self) {
        self.live.store(false, Ordering::Release);
        self.selected
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .selected = None;
        self.window.close_presentation(&self.receipt);
    }

    fn validate(&self, handle: &PresentationHandle) -> Result<(), MemoryCommandError> {
        if handle.token.len() != 36
            || self.token != handle.token
            || !self.live.load(Ordering::Acquire)
        {
            return Err(cancelled());
        }
        Ok(())
    }

    fn capture(&self, token: &str) -> Result<NativeMemorySelectionReceipt, MemoryCommandError> {
        if token.len() != 36 || !self.live.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        self.selected
            .lock()
            .map_err(|_| cancelled())?
            .selected
            .as_ref()
            .filter(|selected| selected.token == token)
            .map(|selected| selected.receipt.clone())
            .ok_or_else(cancelled)
    }

    fn check(
        &self,
        app: &NativeMemoryApplication,
        token: &str,
    ) -> Result<NativeMemorySelectionReceipt, MemoryCommandError> {
        let selected = self.capture(token)?;
        if !app.is_current(&self.window, &self.receipt, &selected) {
            return Err(cancelled());
        }
        Ok(selected)
    }

    fn select(
        &self,
        app: &NativeMemoryApplication,
        registry: &WorkspaceRegistry,
        path: PathBuf,
        environment: &WorkspaceEnv,
        revision: u64,
    ) -> Result<String, MemoryCommandError> {
        self.select_with_inspection(app, registry, path, environment, revision, false)
    }

    fn select_with_inspection(
        &self,
        app: &NativeMemoryApplication,
        registry: &WorkspaceRegistry,
        path: PathBuf,
        environment: &WorkspaceEnv,
        revision: u64,
        inspect_ancestors: bool,
    ) -> Result<String, MemoryCommandError> {
        let mut selected = self.selected.lock().map_err(|_| cancelled())?;
        if revision == 0 || revision > 9_007_199_254_740_991 || revision <= selected.revision {
            return Err(cancelled());
        }
        selected.revision = revision;
        selected.selected = None;
        if !self.live.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        let receipt = if inspect_ancestors {
            app.select_with_inspection(&self.window, &self.receipt, registry, path, environment)?
        } else {
            app.select(&self.window, &self.receipt, registry, path, environment)?
        };
        let token = uuid::Uuid::new_v4().to_string();
        selected.selected = Some(Selected {
            token: token.clone(),
            receipt,
            reviews: deployment::CommandReviews::default(),
            trust: trust::CommandTrust::default(),
            policy: policy::CommandPolicy::default(),
        });
        Ok(token)
    }
}

impl Resource for PresentationResource {
    fn close(self: Arc<Self>) {
        self.retire();
    }
}

impl Drop for PresentationResource {
    fn drop(&mut self) {
        self.retire();
    }
}

fn presentation(
    window: &WebviewWindow,
    handle: &PresentationHandle,
) -> Result<Arc<PresentationResource>, MemoryCommandError> {
    lookup(&window.resources_table(), handle)
}

fn lookup(
    table: &ResourceTable,
    handle: &PresentationHandle,
) -> Result<Arc<PresentationResource>, MemoryCommandError> {
    let resource = table
        .get::<PresentationResource>(handle.id)
        .map_err(|_| cancelled())?;
    resource.validate(handle)?;
    Ok(resource)
}

fn take(
    table: &mut ResourceTable,
    handle: &PresentationHandle,
) -> Result<Arc<PresentationResource>, MemoryCommandError> {
    lookup(table, handle)?;
    table
        .take::<PresentationResource>(handle.id)
        .map_err(|_| cancelled())
}

#[tauri::command]
pub fn project_memory_open(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
) -> Result<PresentationHandle, MemoryCommandError> {
    let owner = app.bound_window(&window)?;
    let receipt = app.open_presentation(&owner)?;
    let resource = Arc::new(PresentationResource {
        token: uuid::Uuid::new_v4().to_string(),
        window: owner,
        receipt,
        selected: Mutex::new(SelectionState::default()),
        live: AtomicBool::new(true),
    });
    let id = window.resources_table().add_arc(resource.clone());
    if !app.window_is_current(&resource.window) {
        let removed = {
            let mut table = window.resources_table();
            if table
                .get::<PresentationResource>(id)
                .is_ok_and(|stored| Arc::ptr_eq(&stored, &resource))
            {
                table.take::<PresentationResource>(id).ok()
            } else {
                None
            }
        };
        if let Some(removed) = removed {
            removed.retire();
        }
        return Err(cancelled());
    }
    Ok(PresentationHandle {
        id,
        token: resource.token.clone(),
    })
}

#[tauri::command]
pub fn project_memory_close(
    window: WebviewWindow,
    handle: PresentationHandle,
) -> Result<(), MemoryCommandError> {
    let resource = {
        let mut table = window.resources_table();
        take(&mut table, &handle)?
    };
    resource.retire();
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn project_memory_select(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    registry: State<'_, WorkspaceRegistry>,
    handle: PresentationHandle,
    path: PathBuf,
    environment: WorkspaceEnv,
    revision: u64,
    inspect_ancestors: Option<bool>,
) -> Result<String, MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    if inspect_ancestors == Some(true) {
        resource.select_with_inspection(&app, &registry, path, &environment, revision, true)
    } else {
        resource.select(&app, &registry, path, &environment, revision)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeReply {
    schema: u8,
    scope: MemoryScope,
    root: Option<String>,
    blocked_count: usize,
}

async fn discover(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    token: &str,
) -> Result<ScopeReply, MemoryCommandError> {
    resource.check(app, token)?;
    let store = app
        .store(
            &resource.window,
            MemoryStoreMode::OpenExisting,
            ReadControl::default(),
        )
        .await;
    let selected = resource.check(app, token)?;
    let store = store?;
    let result = app
        .discover(
            &resource.window,
            &resource.receipt,
            &selected,
            store,
            DiscoveryControl::new(std::time::Duration::from_secs(5)),
        )?
        .finish()
        .await;
    resource.check(app, token)?;
    let observation = result?;
    let root = observation
        .scope
        .root_key
        .as_ref()
        .and_then(|key| {
            observation
                .directories
                .iter()
                .find(|directory| &directory.directory_key == key)
        })
        .map(|directory| {
            directory
                .path
                .to_str()
                .map(str::to_owned)
                .ok_or(MemoryWorkError::Read(ReadError::InvalidInput))
        })
        .transpose()?;
    Ok(ScopeReply {
        schema: 1,
        scope: observation.scope,
        root,
        blocked_count: observation.blocked_paths.len(),
    })
}

#[tauri::command]
pub async fn project_memory_discover(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
) -> Result<ScopeReply, MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    discover(&app, &resource, &selection).await
}

#[tauri::command]
pub async fn project_memory_initialize_local_state(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
) -> Result<(), MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    resource.check(&app, &selection)?;
    let result = app
        .store(
            &resource.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await;
    resource.check(&app, &selection)?;
    result?;
    Ok(())
}

#[path = "commands_deployment.rs"]
pub mod deployment;

#[path = "commands_trust.rs"]
pub mod trust;

#[path = "commands_policy.rs"]
pub mod policy;

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
