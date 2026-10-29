use super::*;
use voktty_memory_local::{MemoryPolicy, MemoryPolicyError};

impl NativeMemoryApplication {
    pub fn reserve_policy(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPolicyReservation, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            owners.reserve_policy(receipt, presentation, selected, control)
        })
    }
    pub async fn open_policy_store(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPolicyReservation,
    ) -> Result<Arc<LocalMemoryStore>, MemoryPolicyError> {
        let control = self.with_owners(window, |owners, receipt| {
            Ok(owners.policy_store_control(receipt, presentation, selected, reserved))
        })??;
        let result = self
            .store(window, MemoryStoreMode::OpenExisting, control)
            .await;
        self.with_owners(window, |owners, receipt| {
            Ok(owners
                .policy_store_control(receipt, presentation, selected, reserved)
                .and_then(|_| result.map_err(Into::into)))
        })?
    }
    pub fn review_policy(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPolicyReservation,
        store: Arc<LocalMemoryStore>,
        policy: MemoryPolicy,
    ) -> Result<NativeMemoryPolicyRead, MemoryPolicyError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.review_policy(receipt, presentation, selected, reserved, store, policy))
        })?
    }
    pub fn accept_policy(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        review: NativeMemoryPolicyReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPolicyWrite, MemoryPolicyError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.accept_policy(receipt, presentation, selected, review, control))
        })?
    }
    pub fn cancel_policy(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPolicyReservation,
    ) -> Result<bool, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            owners.cancel_policy(receipt, presentation, selected, reserved)
        })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "application_policy_tests.rs"]
mod tests;
