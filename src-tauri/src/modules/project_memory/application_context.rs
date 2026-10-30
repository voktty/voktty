use super::*;
use voktty_memory_local::{MemoryContextRead, MemorySessionUse, MemoryTrustError};

impl NativeMemoryApplication {
    pub fn open_context(
        &self,
        window: &NativeMemoryWindow,
    ) -> Result<NativeMemoryContextReceipt, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| owners.open_context(receipt))
    }

    pub fn bind_context_session(
        &self,
        window: &NativeMemoryWindow,
        target: NativeMemoryContextTarget<'_>,
        review: NativeMemoryTrustReview,
        choice: MemorySessionUse,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryContextBinding, MemoryTrustError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.bind_context_session(receipt, target, review, choice, control))
        })?
    }

    pub fn promote_context(
        &self,
        window: &NativeMemoryWindow,
        target: NativeMemoryContextTarget<'_>,
        prepared: NativeMemoryPreparedContext,
    ) -> Result<(), MemoryTrustError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.promote_context(receipt, target, prepared))
        })?
    }

    pub fn is_context_current(
        &self,
        window: &NativeMemoryWindow,
        context: &NativeMemoryContextReceipt,
    ) -> bool {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.is_context_current(receipt, context))
        })
        .unwrap_or(false)
    }

    pub fn context_root(
        &self,
        window: &NativeMemoryWindow,
        context: &NativeMemoryContextReceipt,
    ) -> Result<PathBuf, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            owners.context_root(receipt, context)
        })
    }

    pub fn session_context(
        &self,
        window: &NativeMemoryWindow,
        context: &NativeMemoryContextReceipt,
        control: DiscoveryControl,
    ) -> Result<MemoryContextRead, MemoryTrustError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.session_context(receipt, context, control))
        })?
    }

    pub fn close_context(
        &self,
        window: &NativeMemoryWindow,
        context: &NativeMemoryContextReceipt,
    ) -> Result<bool, MemoryWorkError> {
        self.with_owners(window, |owners, receipt| {
            Ok(owners.close_context(receipt, context))
        })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "application_context_tests.rs"]
mod tests;
