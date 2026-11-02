use super::*;
use voktty_memory_local::NativeMemoryDocuments;

async fn read(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    token: &str,
    root: String,
) -> Result<NativeMemoryDocuments, MemoryCommandError> {
    let selected = resource.check(app, token)?;
    let result = app
        .documents(
            &resource.window,
            &resource.receipt,
            &selected,
            root,
            DiscoveryControl::default(),
        )?
        .finish()
        .await;
    resource.check(app, token)?;
    Ok(result?)
}

#[tauri::command]
pub async fn project_memory_documents(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    root: String,
) -> Result<NativeMemoryDocuments, MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    read(&app, &resource, &selection, root).await
}

#[cfg(all(test, target_os = "linux"))]
#[path = "commands_documents_tests.rs"]
mod tests;
