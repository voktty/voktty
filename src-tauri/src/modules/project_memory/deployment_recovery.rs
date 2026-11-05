use super::*;
use voktty_memory_local::{OwnedProjectRecoveryPreview, ProjectRecoveryRequest, RecoveryRestore};

#[cfg(all(test, target_os = "linux"))]
#[path = "recovery_authority_tests.rs"]
mod tests;

pub struct NativeMemoryRecoveryTarget {
    pub destination: PathBuf,
    pub environment: WorkspaceEnv,
    pub control: DiscoveryControl,
}

pub struct NativeMemoryRecoveryConfirmation {
    pub digest: String,
    pub control: DiscoveryControl,
}

#[derive(Clone)]
pub struct NativeMemoryRecoveryReceipt {
    receipt: NativeMemoryPreviewReceipt,
}

pub struct NativeMemoryPreparedRecovery {
    receipt: NativeMemoryRecoveryReceipt,
    review: OwnedProjectRecoveryPreview,
}

/// Display bytes and digest are not restoration authority.
#[derive(Debug)]
pub struct NativeMemoryRecoverySnapshot {
    pub root: PathBuf,
    pub digest: String,
    pub entries: Vec<RecoveryRestore>,
    pub deployment: voktty_workspace_kit::PreparedDeployment,
    pub cleanup: Vec<RecoveryFile>,
    pub publication_blocker: Option<PublicationError>,
}

#[must_use = "finish or drop this recovery request to retire its consumer"]
pub struct NativeMemoryRecoveryRead {
    operation: ReviewOperation<OwnedProjectRecoveryPreview>,
    receipt: NativeMemoryRecoveryReceipt,
}
impl NativeMemoryRecoveryRead {
    pub fn receipt(&self) -> NativeMemoryRecoveryReceipt {
        self.receipt.clone()
    }

    pub async fn finish(self) -> Result<NativeMemoryPreparedRecovery, MemoryDeploymentWorkError> {
        Ok(NativeMemoryPreparedRecovery {
            review: self.operation.finish().await?,
            receipt: self.receipt,
        })
    }
}

#[must_use = "finish or drop this restoration request to retire its consumer"]
pub struct NativeMemoryRestoration {
    operation: ReviewOperation<PublicationReport>,
}
impl NativeMemoryRestoration {
    pub async fn finish(self) -> Result<PublicationReport, MemoryDeploymentWorkError> {
        self.operation.finish().await
    }
}

impl NativeMemoryDeployment {
    pub(in crate::modules::project_memory) fn reserve_recovery(
        &mut self,
        destination: NativeMemorySource,
        control: DiscoveryControl,
    ) -> NativeMemoryRecoveryReceipt {
        let receipt = self.reserve_state(destination, control, ReviewState::RecoveryReserved);
        NativeMemoryRecoveryReceipt { receipt }
    }

    pub(in crate::modules::project_memory) fn prepare_recovery(
        &mut self,
        source: &NativeMemorySource,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> Result<NativeMemoryRecoveryRead, MemoryDeploymentWorkError> {
        if !self.is_recovery_current(receipt) {
            return Err(cancelled());
        }
        let review = self.review.as_mut().ok_or_else(cancelled)?;
        if !matches!(review.state, ReviewState::RecoveryReserved) {
            return Err(cancelled());
        }
        review.state = ReviewState::RecoveryOpening;
        let job = MemoryWorkers::default().review_recovery(
            ProjectRecoveryRequest {
                origin: source.requested.clone(),
                origin_access: source.access.clone(),
                destination: review.destination.requested.clone(),
                destination_access: review.destination.access.clone(),
            },
            review.control.clone(),
        );
        match job {
            Ok(job) => Ok(NativeMemoryRecoveryRead {
                operation: ReviewOperation {
                    job,
                    live: review.live.clone(),
                    origin: source.access.clone(),
                    destination: review.destination.access.clone(),
                },
                receipt: receipt.clone(),
            }),
            Err(error) => {
                self.clear();
                Err(error)
            }
        }
    }

    pub(in crate::modules::project_memory) fn is_recovery_current(
        &self,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> bool {
        self.is_current(&receipt.receipt)
    }

    pub(in crate::modules::project_memory) fn accept_recovery(
        &mut self,
        prepared: NativeMemoryPreparedRecovery,
    ) -> Result<NativeMemoryRecoveryReceipt, MemoryDeploymentWorkError> {
        if !self.is_recovery_current(&prepared.receipt) {
            return Err(cancelled());
        }
        let review = self.review.as_mut().ok_or_else(cancelled)?;
        if !matches!(review.state, ReviewState::RecoveryOpening) {
            return Err(cancelled());
        }
        review.state = ReviewState::RecoveryReady(Box::new(prepared.review));
        Ok(prepared.receipt)
    }

    fn recovery(
        &self,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> Result<&OwnedProjectRecoveryPreview, MemoryDeploymentWorkError> {
        if !self.is_recovery_current(receipt) {
            return Err(cancelled());
        }
        match &self.review.as_ref().ok_or_else(cancelled)?.state {
            ReviewState::RecoveryReady(review) => Ok(review),
            _ => Err(cancelled()),
        }
    }

    pub(in crate::modules::project_memory) fn recovery_snapshot(
        &self,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> Result<NativeMemoryRecoverySnapshot, MemoryDeploymentWorkError> {
        let review = self.recovery(receipt)?;
        Ok(NativeMemoryRecoverySnapshot {
            root: review.write_requirements().root,
            digest: review.acceptance_digest(),
            entries: review.restorations().to_vec(),
            deployment: review.deployment().clone(),
            cleanup: review.cleanup_files().into_iter().cloned().collect(),
            publication_blocker: review.publication_blocker(),
        })
    }

    pub(in crate::modules::project_memory) fn cancel_recovery(
        &mut self,
        receipt: &NativeMemoryRecoveryReceipt,
    ) -> bool {
        self.cancel(&receipt.receipt)
    }

    pub(in crate::modules::project_memory) fn confirm_recovery(
        &mut self,
        source: &NativeMemorySource,
        receipt: &NativeMemoryRecoveryReceipt,
        registry: &WorkspaceRegistry,
        digest: String,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryRestoration, MemoryDeploymentWorkError> {
        self.recovery(receipt)?;
        let review = self.review.as_mut().ok_or_else(cancelled)?;
        let ReviewState::RecoveryReady(original) =
            std::mem::replace(&mut review.state, ReviewState::Restoring)
        else {
            return Err(cancelled());
        };
        review.control = control.clone();
        let start = || {
            if digest != original.acceptance_digest() {
                return Err(MemoryDeploymentWorkError::Preview(
                    PublicationError::StalePreview,
                ));
            }
            let access =
                super::super::write_authority::NativeMemoryWriteAuthority::capture_recovery(
                    registry,
                    &original,
                    source.access.clone(),
                    review.destination.access.clone(),
                    &review.live,
                )?;
            MemoryWorkers::default().recover_project(*original, digest, Arc::new(access), control)
        };
        match start() {
            Ok(job) => Ok(NativeMemoryRestoration {
                operation: ReviewOperation {
                    job,
                    live: review.live.clone(),
                    origin: source.access.clone(),
                    destination: review.destination.access.clone(),
                },
            }),
            Err(error) => {
                self.clear();
                Err(error)
            }
        }
    }
}
