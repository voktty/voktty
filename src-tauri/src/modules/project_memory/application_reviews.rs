use super::*;
use voktty_memory_local::{MemoryDeploymentWorkError, MemoryWriteAccess};

impl NativeMemoryApplication {
    fn with_deployment<T>(
        &self,
        window: &NativeMemoryWindow,
        action: impl FnOnce(
            &mut NativeMemoryOwners,
            &NativeMemoryWindowReceipt,
        ) -> Result<T, MemoryDeploymentWorkError>,
    ) -> Result<T, MemoryDeploymentWorkError> {
        self.with_owners(window, |owners, receipt| Ok(action(owners, receipt)))?
    }

    pub fn prepare_preview(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        request: NativeMemoryPreviewRequest,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.prepare_preview(receipt, presentation, selected, registry, request)
        })
    }

    pub fn reserve_preview(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        target: NativeMemoryPreviewTarget,
    ) -> Result<NativeMemoryPreviewReceipt, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.reserve_preview(receipt, presentation, selected, registry, target)
        })
    }

    pub async fn open_preview_store(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPreviewReceipt,
    ) -> Result<Arc<LocalMemoryStore>, MemoryDeploymentWorkError> {
        let control = self.with_deployment(window, |owners, receipt| {
            owners.preview_store_control(receipt, presentation, selected, reserved)
        })?;
        let result = self
            .store(window, MemoryStoreMode::OpenExisting, control)
            .await;
        self.with_deployment(window, |owners, receipt| {
            owners.preview_store_control(receipt, presentation, selected, reserved)?;
            result.map_err(Into::into)
        })
    }

    pub fn start_preview(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPreviewReceipt,
        values: NativeMemoryPreviewValues,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.start_preview(receipt, presentation, selected, reserved, values)
        })
    }

    pub fn accept_preview(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        prepared: NativeMemoryPreparedPreview,
    ) -> Result<NativeMemoryPreviewReceipt, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.accept_preview(receipt, presentation, selected, prepared)
        })
    }

    pub fn preview_snapshot(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
    ) -> Result<NativeMemoryPreviewSnapshot, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.preview_snapshot(receipt, presentation, selected, preview)
        })
    }

    pub fn is_preview_current(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
    ) -> bool {
        self.with_deployment(window, |owners, receipt| {
            Ok(owners.is_preview_current(receipt, presentation, selected, preview))
        })
        .unwrap_or(false)
    }

    pub fn cancel_preview(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
    ) -> Result<bool, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.cancel_preview(receipt, presentation, selected, preview)
        })
    }

    pub fn publish_preview(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
        access: Arc<dyn MemoryWriteAccess>,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPublication, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.publish_preview(receipt, presentation, selected, preview, access, control)
        })
    }

    pub fn confirm_preview(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
        registry: &WorkspaceRegistry,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPublication, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.confirm_preview(receipt, presentation, selected, preview, registry, control)
        })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "application_review_tests.rs"]
mod tests;
