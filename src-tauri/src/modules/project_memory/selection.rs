use super::*;
use std::sync::Weak;
use voktty_memory_local::{
    MemoryDeploymentWorkError, MemoryWriteAccess, OwnedInitializationPreview,
};

/// One native presentation's selected source. Changing selection retires the
/// previous authority even when capture of the new destination fails.
#[derive(Default)]
pub struct NativeMemorySelection {
    source: Option<NativeMemorySource>,
    deployment: deployment::NativeMemoryDeployment,
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
        self.deployment.clear();
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
        self.deployment.clear();
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

    pub fn prepare_preview(
        &mut self,
        receipt: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        request: NativeMemoryPreviewRequest,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        self.current(receipt)?;
        self.deployment.clear();
        let destination =
            NativeMemorySource::capture(registry, request.destination, &request.environment)?;
        self.deployment.prepare(
            self.source.as_ref().ok_or(ReadError::Cancelled)?,
            destination,
            request.store,
            request.inputs,
            request.links,
            request.control,
        )
    }

    pub fn accept_preview(
        &mut self,
        receipt: &NativeMemorySelectionReceipt,
        prepared: NativeMemoryPreparedPreview,
    ) -> Result<NativeMemoryPreviewReceipt, MemoryDeploymentWorkError> {
        self.current(receipt)?;
        self.deployment.accept(prepared)
    }

    pub fn preview(
        &self,
        selection: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPreviewReceipt,
    ) -> Result<&OwnedInitializationPreview, MemoryDeploymentWorkError> {
        self.current(selection)?;
        self.deployment.preview(receipt)
    }

    pub fn cancel_preview(
        &mut self,
        selection: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPreviewReceipt,
    ) -> bool {
        self.is_current(selection) && self.deployment.cancel(receipt)
    }

    /// Revalidate before delivering an already returned result. Current lifetime
    /// does not imply that the review is ready or remains unconsumed.
    pub fn is_preview_current(
        &self,
        selection: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPreviewReceipt,
    ) -> bool {
        self.is_current(selection) && self.deployment.is_current(receipt)
    }

    /// The native caller must supply independent, qualified write authority.
    /// A reviewed plan and read grants never manufacture that authority.
    pub fn publish_preview(
        &mut self,
        selection: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPreviewReceipt,
        access: Arc<dyn MemoryWriteAccess>,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPublication, MemoryDeploymentWorkError> {
        self.current(selection)?;
        self.deployment.publish(
            self.source.as_ref().ok_or(ReadError::Cancelled)?,
            receipt,
            access,
            control,
        )
    }
}
