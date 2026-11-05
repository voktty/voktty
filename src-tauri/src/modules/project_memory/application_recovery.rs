use super::*;
use voktty_memory_local::MemoryDeploymentWorkError;

impl NativeMemoryApplication {
    pub fn reserve_recovery(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        target: NativeMemoryRecoveryTarget,
    ) -> Result<NativeMemoryRecoveryReceipt, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.reserve_recovery(receipt, presentation, selected, registry, target)
        })
    }

    pub fn start_recovery(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryRecoveryReceipt,
    ) -> Result<NativeMemoryRecoveryRead, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.start_recovery(receipt, presentation, selected, reserved)
        })
    }

    pub fn accept_recovery(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        prepared: NativeMemoryPreparedRecovery,
    ) -> Result<NativeMemoryRecoveryReceipt, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.accept_recovery(receipt, presentation, selected, prepared)
        })
    }

    pub fn recovery_snapshot(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        recovery: &NativeMemoryRecoveryReceipt,
    ) -> Result<NativeMemoryRecoverySnapshot, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.recovery_snapshot(receipt, presentation, selected, recovery)
        })
    }

    pub fn is_recovery_current(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        recovery: &NativeMemoryRecoveryReceipt,
    ) -> bool {
        self.with_deployment(window, |owners, receipt| {
            Ok(owners.is_recovery_current(receipt, presentation, selected, recovery))
        })
        .unwrap_or(false)
    }

    pub fn cancel_recovery(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        recovery: &NativeMemoryRecoveryReceipt,
    ) -> Result<bool, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.cancel_recovery(receipt, presentation, selected, recovery)
        })
    }

    pub fn confirm_recovery(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        recovery: &NativeMemoryRecoveryReceipt,
        registry: &WorkspaceRegistry,
        confirmation: NativeMemoryRecoveryConfirmation,
    ) -> Result<NativeMemoryRestoration, MemoryDeploymentWorkError> {
        self.with_deployment(window, |owners, receipt| {
            owners.confirm_recovery(
                receipt,
                presentation,
                selected,
                recovery,
                registry,
                confirmation,
            )
        })
    }
}
