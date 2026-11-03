use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageDiagnostic {
    stage: &'static str,
    windows_error: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct MemorySetupError {
    #[serde(flatten)]
    error: MemoryCommandError,
    #[serde(skip_serializing_if = "Option::is_none")]
    storage: Option<StorageDiagnostic>,
}

impl From<MemoryCommandError> for MemorySetupError {
    fn from(error: MemoryCommandError) -> Self {
        Self {
            error,
            storage: None,
        }
    }
}

impl MemorySetupError {
    fn observed(
        error: MemoryWorkError,
        failure: Option<voktty_memory_local::StorageFailure>,
    ) -> Self {
        Self {
            error: error.into(),
            storage: failure.map(|failure| StorageDiagnostic {
                stage: failure.stage.as_str(),
                windows_error: failure.windows_error,
            }),
        }
    }
}

pub(super) async fn initialize(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    selection: &str,
) -> Result<(), MemorySetupError> {
    resource.check(app, selection)?;
    let control = ReadControl::default().with_storage_diagnostics();
    let result = app
        .store(
            &resource.window,
            MemoryStoreMode::Initialize,
            control.clone(),
        )
        .await;
    resource.check(app, selection)?;
    result
        .map(|_| ())
        .map_err(|error| MemorySetupError::observed(error, control.storage_failure()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use crate::modules::project_memory::tests::{project, runtime};
    use serde_json::json;

    #[test]
    fn setup_diagnostic_contains_only_the_original_code_fixed_stage_and_numeric_status() {
        let error = MemorySetupError::observed(
            ReadError::Denied.into(),
            Some(voktty_memory_local::StorageFailure {
                stage: voktty_memory_local::StorageStage::WindowsDirectoryOpen,
                windows_error: Some(5),
            }),
        );
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({"code":"denied","storage":{"stage":"windows-directory-open","windowsError":5}})
        );
        let error = MemorySetupError::from(cancelled());
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({"code":"cancelled"})
        );
    }

    #[cfg(unix)]
    #[test]
    fn unsafe_application_storage_is_reported_without_paths_writes_or_permission_repair() {
        use std::os::unix::fs::PermissionsExt;
        let (state, app, resource) = super::super::tests::fixture();
        std::fs::set_permissions(state.path(), std::fs::Permissions::from_mode(0o777)).unwrap();
        let project = project();
        let registry = WorkspaceRegistry::default();
        let root = registry.authorize(project.path()).unwrap();
        let selected = resource
            .select(&app, &registry, root, &WorkspaceEnv::Local, 1)
            .unwrap();
        runtime().block_on(async {
            let error = initialize(&app, &resource, &selected).await.unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap(), json!({"code":"denied","storage":{"stage":"application-parent","windowsError":null}}));
            resource.retire();
            let error = initialize(&app, &resource, &selected).await.unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap(), json!({"code":"cancelled"}));
        });
        assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
        assert_eq!(
            std::fs::metadata(state.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o777
        );
    }
}
