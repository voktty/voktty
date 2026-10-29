use super::*;
use voktty_memory_local::MemoryTrustError;

impl NativeMemoryApplication {
    pub fn reserve_trust(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryTrustReservation, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            owners.reserve_trust(receipt, presentation, selected, control)
        })
    }

    pub fn review_trust(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        reservation: &NativeMemoryTrustReservation,
        store: Arc<LocalMemoryStore>,
        role: Option<String>,
    ) -> Result<NativeMemoryTrustRead, MemoryTrustError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.selection(receipt, presentation)?.review_trust(
                selected,
                reservation,
                store,
                role,
            ))
        })?
    }

    pub fn accept_trust(
        &self,
        window: &NativeMemoryWindow,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        review: NativeMemoryTrustReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryTrustWrite, MemoryTrustError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.accept_trust(receipt, presentation, selected, review, control))
        })?
    }
}
