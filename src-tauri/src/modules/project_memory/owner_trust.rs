use super::*;
use voktty_memory_local::MemoryTrustError;

impl NativeMemoryOwners {
    pub fn reserve_trust(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryTrustReservation, MemoryWorkError> {
        self.selection_mut(window, presentation)?
            .reserve_trust(selected, control)
    }

    pub fn accept_trust(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        presentation: &NativeMemoryPresentationReceipt,
        selected: &NativeMemorySelectionReceipt,
        review: NativeMemoryTrustReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryTrustWrite, MemoryTrustError> {
        self.selection_mut(window, presentation)?
            .accept_trust(selected, review, control)
    }
}
