use super::*;
use std::sync::Weak;
use voktty_memory_local::{
    MemoryDeploymentWorkError, MemoryTrustError, MemoryWriteAccess, OwnedInitializationPreview,
};

/// One native presentation's selected source. Changing selection retires the
/// previous authority even when capture of the new destination fails.
#[derive(Default)]
pub struct NativeMemorySelection {
    source: Option<NativeMemorySource>,
    deployment: deployment::NativeMemoryDeployment,
    trust_control: Option<trust::TrustControl>,
    pub(super) policy_control: Option<policy::PolicyControl>,
}

/// Native-only identity, never a filesystem, instruction or session grant.
#[derive(Clone)]
pub struct NativeMemorySelectionReceipt {
    access: Weak<Access>,
}

impl NativeMemorySelection {
    pub fn bind_context_session(
        &mut self,
        target: &NativeMemoryContextReceipt,
        receipt: &NativeMemorySelectionReceipt,
        review: NativeMemoryTrustReview,
        choice: voktty_memory_local::MemorySessionUse,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryContextBinding, MemoryTrustError> {
        self.current(receipt)?.validate_trust(&review)?;
        self.trust_control
            .as_mut()
            .filter(|reservation| reservation.matches(&review))
            .ok_or(ReadError::Cancelled)?
            .accepting(control.clone());
        self.current(receipt)?
            .bind_context_session(target, review, choice, control)
    }

    pub(super) fn promote_context(
        &mut self,
        receipt: &NativeMemorySelectionReceipt,
        prepared: NativeMemoryPreparedContext,
    ) -> Result<context::NativeMemoryContext, MemoryTrustError> {
        let source = self.current(receipt)?;
        if !Arc::ptr_eq(&source.access, &prepared.access)
            || !prepared.live.load(Ordering::Acquire)
            || !self.trust_control.as_ref().is_some_and(|control| {
                Arc::ptr_eq(&control.live, &prepared.live) && control.live.load(Ordering::Acquire)
            })
        {
            return Err(ReadError::Cancelled.into());
        }
        let source = self.source.take().ok_or(ReadError::Cancelled)?;
        self.deployment.clear();
        self.trust_control = None;
        self.policy_control = None;
        Ok(context::NativeMemoryContext {
            source,
            native: prepared.native,
        })
    }

    pub fn select(
        &mut self,
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
    ) -> Result<NativeMemorySelectionReceipt, MemoryWorkError> {
        self.select_with_inspection(registry, requested, environment, false)
    }

    pub fn select_with_inspection(
        &mut self,
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
        inspect_ancestors: bool,
    ) -> Result<NativeMemorySelectionReceipt, MemoryWorkError> {
        self.deployment.clear();
        self.trust_control = None;
        self.policy_control = None;
        self.source = None;
        let inspection = inspect_ancestors
            .then(|| native_spelling(&requested))
            .transpose()?;
        let source = NativeMemorySource::capture_with_inspection(
            registry,
            requested,
            environment,
            inspection,
        )?;
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
        self.trust_control = None;
        self.policy_control = None;
        self.source = None;
        true
    }

    pub(super) fn current(
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

    pub fn review_trust(
        &self,
        receipt: &NativeMemorySelectionReceipt,
        reservation: &NativeMemoryTrustReservation,
        store: Arc<LocalMemoryStore>,
        role: Option<String>,
    ) -> Result<NativeMemoryTrustRead, MemoryTrustError> {
        let control = self
            .trust_control
            .as_ref()
            .filter(|control| control.matches_reservation(reservation))
            .ok_or(ReadError::Cancelled)?;
        self.current(receipt)?.review_trust(store, role, control)
    }

    pub fn reserve_trust(
        &mut self,
        receipt: &NativeMemorySelectionReceipt,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryTrustReservation, MemoryWorkError> {
        self.current(receipt)?;
        let control = trust::TrustControl::new(control);
        let receipt = control.receipt();
        self.trust_control = Some(control);
        Ok(receipt)
    }

    pub fn accept_trust(
        &mut self,
        receipt: &NativeMemorySelectionReceipt,
        review: NativeMemoryTrustReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryTrustWrite, MemoryTrustError> {
        self.current(receipt)?.validate_trust(&review)?;
        let reservation = self
            .trust_control
            .as_mut()
            .filter(|reservation| reservation.matches(&review))
            .ok_or(ReadError::Cancelled)?;
        reservation.accepting(control.clone());
        self.current(receipt)?.accept_trust(review, control)
    }

    pub fn prepare_preview(
        &mut self,
        receipt: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        request: NativeMemoryPreviewRequest,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        let reserved = self.reserve_preview(
            receipt,
            registry,
            NativeMemoryPreviewTarget {
                destination: request.destination,
                environment: request.environment,
                control: request.control,
            },
        )?;
        self.start_preview(
            receipt,
            &reserved,
            NativeMemoryPreviewValues {
                store: request.store,
                inputs: request.inputs,
                links: request.links,
            },
        )
    }

    pub fn reserve_preview(
        &mut self,
        receipt: &NativeMemorySelectionReceipt,
        registry: &WorkspaceRegistry,
        target: NativeMemoryPreviewTarget,
    ) -> Result<NativeMemoryPreviewReceipt, MemoryDeploymentWorkError> {
        self.current(receipt)?;
        self.deployment.clear();
        let inspection = self.current(receipt)?.access.ancestor_inspection.clone();
        let destination = NativeMemorySource::capture_with_inspection(
            registry,
            target.destination,
            &target.environment,
            inspection,
        )?;
        Ok(self.deployment.reserve(destination, target.control))
    }

    pub fn start_preview(
        &mut self,
        selection: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPreviewReceipt,
        values: NativeMemoryPreviewValues,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        self.current(selection)?;
        self.deployment.prepare_reserved(
            self.source.as_ref().ok_or(ReadError::Cancelled)?,
            reserved,
            values,
        )
    }

    pub(super) fn preview_store_control(
        &self,
        selection: &NativeMemorySelectionReceipt,
        reserved: &NativeMemoryPreviewReceipt,
    ) -> Result<ReadControl, MemoryDeploymentWorkError> {
        self.current(selection)?;
        self.deployment.store_control(reserved)
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

    pub fn confirm_preview(
        &mut self,
        selection: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPreviewReceipt,
        registry: &WorkspaceRegistry,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPublication, MemoryDeploymentWorkError> {
        self.current(selection)?;
        self.deployment.confirm(
            self.source.as_ref().ok_or(ReadError::Cancelled)?,
            receipt,
            registry,
            control,
        )
    }
}
