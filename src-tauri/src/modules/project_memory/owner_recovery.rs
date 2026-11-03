use super::*;
use voktty_memory_local::MemoryDeploymentWorkError;

impl NativeMemoryOwners {
    pub fn reserve_recovery(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        target: NativeMemoryRecoveryTarget,
    ) -> Result<NativeMemoryRecoveryReceipt, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .reserve_recovery(selected, registry, target)
    }

    pub(in crate::modules::project_memory) fn recovery_store_control(
        &self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryRecoveryReceipt,
    ) -> Result<ReadControl, MemoryDeploymentWorkError> {
        self.selection(window, presentation)?
            .recovery_store_control(selected, reserved)
    }

    pub fn start_recovery(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryRecoveryReceipt,
        store: Arc<LocalMemoryStore>,
    ) -> Result<NativeMemoryRecoveryRead, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .start_recovery(selected, reserved, store)
    }

    pub fn accept_recovery(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        prepared: NativeMemoryPreparedRecovery,
    ) -> Result<NativeMemoryRecoveryReceipt, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?
            .accept_recovery(selected, prepared)
    }

    pub fn recovery_snapshot(
        &self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> Result<NativeMemoryRecoverySnapshot, MemoryDeploymentWorkError> {
        self.selection(window, presentation)?
            .recovery_snapshot(selected, receipt)
    }

    pub fn is_recovery_current(
        &self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> bool {
        self.selection(window, presentation)
            .is_ok_and(|selection| selection.is_recovery_current(selected, receipt))
    }

    pub fn cancel_recovery(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> Result<bool, MemoryDeploymentWorkError> {
        Ok(self
            .selection_mut(window, presentation)?
            .cancel_recovery(selected, receipt))
    }

    pub fn confirm_recovery(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryRecoveryReceipt,
        registry: &WorkspaceRegistry,
        confirmation: NativeMemoryRecoveryConfirmation,
    ) -> Result<NativeMemoryRestoration, MemoryDeploymentWorkError> {
        self.selection_mut(window, presentation)?.confirm_recovery(
            selected,
            receipt,
            registry,
            confirmation.digest,
            confirmation.control,
        )
    }
}
