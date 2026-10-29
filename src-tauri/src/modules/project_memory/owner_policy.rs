use super::*;
use voktty_memory_local::{MemoryPolicy, MemoryPolicyError};

impl NativeMemoryOwners {
    pub fn reserve_policy(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPolicyReservation, MemoryWorkError> {
        self.selection_mut(window, presentation)?
            .reserve_policy(selected, control)
    }
    pub(in crate::modules::project_memory) fn policy_store_control(
        &self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPolicyReservation,
    ) -> Result<ReadControl, MemoryPolicyError> {
        self.selection(window, presentation)?
            .policy_store_control(selected, reserved)
    }
    pub fn review_policy(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPolicyReservation,
        store: Arc<LocalMemoryStore>,
        policy: MemoryPolicy,
    ) -> Result<NativeMemoryPolicyRead, MemoryPolicyError> {
        self.selection_mut(window, presentation)?
            .review_policy(selected, reserved, store, policy)
    }
    pub fn accept_policy(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        review: NativeMemoryPolicyReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPolicyWrite, MemoryPolicyError> {
        self.selection_mut(window, presentation)?
            .accept_policy(selected, review, control)
    }
    pub fn cancel_policy(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPolicyReservation,
    ) -> Result<bool, MemoryWorkError> {
        Ok(self
            .selection_mut(window, presentation)?
            .cancel_policy(selected, reserved))
    }
}
