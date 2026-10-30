use super::*;
use std::sync::atomic::AtomicU8;
use voktty_memory_local::MemorySessionUse;
use voktty_workspace_kit::MemoryContextResult;

const OPEN: u8 = 0;
const BINDING: u8 = 1;
const READY: u8 = 2;
const CLOSED: u8 = 3;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextHandle {
    id: ResourceId,
    token: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextMode {
    Inherit,
    Enabled,
    Disabled,
}
impl From<ContextMode> for MemorySessionUse {
    fn from(mode: ContextMode) -> Self {
        match mode {
            ContextMode::Inherit => Self::Inherit,
            ContextMode::Enabled => Self::Enabled,
            ContextMode::Disabled => Self::Disabled,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextBindRequest {
    review: String,
    mode: ContextMode,
}

#[derive(Debug, Serialize)]
pub struct ContextBoundReply {
    schema: u8,
    root: String,
}

pub(super) struct ContextResource {
    token: String,
    window: Arc<NativeMemoryWindow>,
    pub(super) receipt: NativeMemoryContextReceipt,
    phase: AtomicU8,
}
impl ContextResource {
    fn open(
        app: &NativeMemoryApplication,
        window: Arc<NativeMemoryWindow>,
    ) -> Result<Arc<Self>, MemoryCommandError> {
        let receipt = app.open_context(&window)?;
        Ok(Arc::new(Self {
            token: uuid::Uuid::new_v4().to_string(),
            window,
            receipt,
            phase: AtomicU8::new(OPEN),
        }))
    }

    fn validate(&self, handle: &ContextHandle) -> Result<(), MemoryCommandError> {
        if handle.token.len() != 36 || self.token != handle.token {
            return Err(cancelled());
        }
        Ok(())
    }

    pub(super) fn check(
        &self,
        app: &NativeMemoryApplication,
        expected: &Arc<NativeMemoryWindow>,
    ) -> Result<(), MemoryCommandError> {
        if self.phase.load(Ordering::Acquire) == CLOSED
            || !Arc::ptr_eq(&self.window, expected)
            || !app.window_is_current(&self.window)
        {
            return Err(cancelled());
        }
        Ok(())
    }

    fn begin(
        &self,
        app: &NativeMemoryApplication,
        window: &Arc<NativeMemoryWindow>,
    ) -> Result<(), MemoryCommandError> {
        self.check(app, window)?;
        self.phase
            .compare_exchange(OPEN, BINDING, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|phase| {
                if phase == BINDING {
                    MemoryWorkError::Read(ReadError::Busy).into()
                } else {
                    cancelled()
                }
            })
    }

    fn check_bound(&self, app: &NativeMemoryApplication) -> Result<(), MemoryCommandError> {
        self.check(app, &self.window)?;
        if self.phase.load(Ordering::Acquire) != READY
            || !app.is_context_current(&self.window, &self.receipt)
        {
            return Err(cancelled());
        }
        Ok(())
    }

    fn retire(&self) {
        if self.phase.swap(CLOSED, Ordering::AcqRel) != CLOSED {
            self.window.close_context(&self.receipt);
        }
    }
}
impl Resource for ContextResource {
    fn close(self: Arc<Self>) {
        self.retire();
    }
}
impl Drop for ContextResource {
    fn drop(&mut self) {
        self.retire();
    }
}

fn lookup(
    table: &ResourceTable,
    handle: &ContextHandle,
) -> Result<Arc<ContextResource>, MemoryCommandError> {
    let resource = table
        .get::<ContextResource>(handle.id)
        .map_err(|_| cancelled())?;
    resource.validate(handle)?;
    Ok(resource)
}
fn take(
    table: &mut ResourceTable,
    handle: &ContextHandle,
) -> Result<Arc<ContextResource>, MemoryCommandError> {
    lookup(table, handle)?;
    table
        .take::<ContextResource>(handle.id)
        .map_err(|_| cancelled())
}
fn remove_failed(
    table: &mut ResourceTable,
    handle: &ContextHandle,
    expected: &Arc<ContextResource>,
) {
    if expected.phase.load(Ordering::Acquire) == CLOSED
        && table
            .get::<ContextResource>(handle.id)
            .is_ok_and(|current| Arc::ptr_eq(&current, expected))
    {
        let _ = table.take::<ContextResource>(handle.id);
    }
}

async fn bind(
    app: &NativeMemoryApplication,
    presentation: &PresentationResource,
    selection: &str,
    context: &ContextResource,
    request: ContextBindRequest,
) -> Result<ContextBoundReply, MemoryCommandError> {
    context.begin(app, &presentation.window)?;
    let result = async {
        trust::bind_context(
            app,
            presentation,
            selection,
            &request.review,
            context,
            request.mode.into(),
        )
        .await?;
        context.check(app, &presentation.window)?;
        let root = app
            .context_root(&context.window, &context.receipt)?
            .to_str()
            .ok_or_else(|| {
                MemoryCommandError::from(MemoryWorkError::Read(ReadError::InvalidInput))
            })?
            .to_owned();
        context
            .phase
            .compare_exchange(BINDING, READY, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| cancelled())?;
        context.check_bound(app)?;
        Ok(ContextBoundReply { schema: 1, root })
    }
    .await;
    if result.is_err() {
        context.retire();
    }
    result
}

async fn read(
    app: &NativeMemoryApplication,
    context: &ContextResource,
) -> Result<MemoryContextResult, MemoryCommandError> {
    context.check_bound(app)?;
    let result = app
        .session_context(
            &context.window,
            &context.receipt,
            DiscoveryControl::default(),
        )?
        .finish()
        .await;
    context.check_bound(app)?;
    Ok(result?)
}

#[tauri::command]
pub fn project_memory_context_open(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
) -> Result<ContextHandle, MemoryCommandError> {
    let resource = ContextResource::open(&app, app.bound_window(&window)?)?;
    let id = window.resources_table().add_arc(resource.clone());
    let handle = ContextHandle {
        id,
        token: resource.token.clone(),
    };
    if resource.check(&app, &resource.window).is_err() {
        resource.retire();
        remove_failed(&mut window.resources_table(), &handle, &resource);
        return Err(cancelled());
    }
    Ok(handle)
}

#[tauri::command]
pub fn project_memory_context_close(
    window: WebviewWindow,
    handle: ContextHandle,
) -> Result<(), MemoryCommandError> {
    let resource = take(&mut window.resources_table(), &handle)?;
    resource.retire();
    Ok(())
}

#[tauri::command]
pub async fn project_memory_context_bind(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    context: ContextHandle,
    request: ContextBindRequest,
) -> Result<ContextBoundReply, MemoryCommandError> {
    let resource = lookup(&window.resources_table(), &context)?;
    let presentation = presentation(&window, &handle)?;
    let result = bind(&app, &presentation, &selection, &resource, request).await;
    if result.is_err() {
        remove_failed(&mut window.resources_table(), &context, &resource);
    }
    result
}

#[tauri::command]
pub async fn project_memory_context_read(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: ContextHandle,
) -> Result<MemoryContextResult, MemoryCommandError> {
    let resource = lookup(&window.resources_table(), &handle)?;
    read(&app, &resource).await
}

#[cfg(all(test, target_os = "linux"))]
#[path = "commands_context_tests.rs"]
mod tests;
