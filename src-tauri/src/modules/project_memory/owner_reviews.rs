use super::*;
use voktty_memory_local::{MemoryDeploymentWorkError, MemoryWriteAccess};

impl NativeMemoryOwners {
    pub fn prepare_preview(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        request: NativeMemoryPreviewRequest,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .prepare_preview(selected, registry, request)
    }

    pub fn reserve_preview(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        target: NativeMemoryPreviewTarget,
    ) -> Result<NativeMemoryPreviewReceipt, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .reserve_preview(selected, registry, target)
    }

    pub fn start_preview(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPreviewReceipt,
        values: NativeMemoryPreviewValues,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .start_preview(selected, reserved, values)
    }

    pub(in crate::modules::project_memory) fn preview_store_control(
        &self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPreviewReceipt,
    ) -> Result<ReadControl, MemoryDeploymentWorkError> {
        self.selection(window, presentation)?
            .preview_store_control(selected, reserved)
    }

    pub fn accept_preview(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        prepared: NativeMemoryPreparedPreview,
    ) -> Result<NativeMemoryPreviewReceipt, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .accept_preview(selected, prepared)
    }

    pub fn preview_snapshot(
        &self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
    ) -> Result<NativeMemoryPreviewSnapshot, MemoryDeploymentWorkError> {
        Ok(NativeMemoryPreviewSnapshot::capture(
            self.selection(window, presentation)?
                .preview(selected, preview)?,
        ))
    }

    pub fn is_preview_current(
        &self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
    ) -> bool {
        self.selection(window, presentation)
            .is_ok_and(|selection| selection.is_preview_current(selected, preview))
    }

    pub fn cancel_preview(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
    ) -> Result<bool, MemoryDeploymentWorkError> {
        Ok(self
            .selection_mut(window, presentation)?
            .cancel_preview(selected, preview))
    }

    pub fn publish_preview(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        preview: &NativeMemoryPreviewReceipt,
        access: Arc<dyn MemoryWriteAccess>,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPublication, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .publish_preview(selected, preview, access, control)
    }
}
