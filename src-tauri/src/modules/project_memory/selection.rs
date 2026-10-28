use super::*;
use std::sync::Weak;

/// One native presentation's selected source. Changing selection retires the
/// previous authority even when capture of the new destination fails.
#[derive(Default)]
pub struct NativeMemorySelection {
    source: Option<NativeMemorySource>,
}

/// Native-only identity, never a filesystem, instruction or session grant.
#[derive(Clone)]
pub struct NativeMemorySelectionReceipt {
    access: Weak<Access>,
}

impl NativeMemorySelection {
    pub fn select(
        &mut self,
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
    ) -> Result<NativeMemorySelectionReceipt, MemoryWorkError> {
        self.source = None;
        let source = NativeMemorySource::capture(registry, requested, environment)?;
        let receipt = NativeMemorySelectionReceipt {
            access: Arc::downgrade(&source.access),
        };
        self.source = Some(source);
        Ok(receipt)
    }

    pub fn is_current(&self, receipt: &NativeMemorySelectionReceipt) -> bool {
        self.source.as_ref().is_some_and(|source| {
            Weak::ptr_eq(&receipt.access, &Arc::downgrade(&source.access))
                && source.access.live.load(Ordering::Acquire)
        })
    }

    pub fn clear(&mut self, receipt: &NativeMemorySelectionReceipt) -> bool {
        if !self.is_current(receipt) {
            return false;
        }
        self.source = None;
        true
    }

    fn current(
        &self,
        receipt: &NativeMemorySelectionReceipt,
    ) -> Result<&NativeMemorySource, MemoryWorkError> {
        self.source
            .as_ref()
            .filter(|_| self.is_current(receipt))
            .ok_or_else(|| ReadError::Cancelled.into())
    }

    pub fn scope(
        &self,
        receipt: &NativeMemorySelectionReceipt,
        store: Arc<LocalMemoryStore>,
        purpose: DiscoveryPurpose,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryRead<NativeScopeObservation>, MemoryWorkError> {
        self.current(receipt)?.scope(store, purpose, control)
    }

    pub fn context(
        &self,
        receipt: &NativeMemorySelectionReceipt,
        store: Arc<LocalMemoryStore>,
        role: Option<String>,
        control: ReadControl,
    ) -> Result<NativeMemoryRead<NativeContextObservation>, MemoryWorkError> {
        self.current(receipt)?.context(store, role, control)
    }
}
