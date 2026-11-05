use super::*;
use serde_json::{Map, Value};
use std::sync::Weak;
use voktty_memory_local::{
    MemoryDeploymentJob, MemoryDeploymentWorkError, MemoryWriteAccess,
    OwnedProjectInitializationPreview, ProjectInitializationRequest, PublicationError,
    PublicationReport, RecoveryFile,
};
use voktty_workspace_kit::{PreparedDeployment, RootLinks};

pub struct NativeMemoryPreviewTarget {
    pub destination: PathBuf,
    pub environment: WorkspaceEnv,
    pub control: DiscoveryControl,
}

pub struct NativeMemoryPreviewValues {
    pub inputs: Map<String, Value>,
    pub links: RootLinks,
}

/// Detached display data, never a plan accepted for publication.
#[derive(Debug)]
pub struct NativeMemoryPreviewSnapshot {
    pub root: PathBuf,
    pub deployment: PreparedDeployment,
    pub is_resuming: bool,
    pub recovery_files: Vec<RecoveryFile>,
    pub publication_blocker: Option<PublicationError>,
}

impl NativeMemoryPreviewSnapshot {
    pub(super) fn capture(preview: &OwnedProjectInitializationPreview) -> Self {
        Self {
            root: preview.write_requirements().root,
            deployment: preview.deployment().clone(),
            is_resuming: false,
            recovery_files: Vec::new(),
            publication_blocker: preview.publication_blocker(),
        }
    }
}

/// Explicit native review inputs. The selected origin is never caller supplied.
pub struct NativeMemoryPreviewRequest {
    pub destination: PathBuf,
    pub environment: WorkspaceEnv,
    pub inputs: Map<String, Value>,
    pub links: RootLinks,
    pub control: DiscoveryControl,
}

#[derive(Default)]
pub(super) struct NativeMemoryDeployment {
    review: Option<Review>,
}

struct Review {
    live: Arc<AtomicBool>,
    destination: NativeMemorySource,
    control: DiscoveryControl,
    state: ReviewState,
}

enum ReviewState {
    Reserved,
    Opening,
    Ready(Box<OwnedProjectInitializationPreview>),
    Publishing,
    RecoveryReserved,
    RecoveryOpening,
    RecoveryReady(Box<voktty_memory_local::OwnedRecoveryReview>),
    Restoring,
}

#[path = "deployment_recovery.rs"]
mod recovery;
pub use recovery::{
    NativeMemoryPreparedRecovery, NativeMemoryRecoveryConfirmation, NativeMemoryRecoveryRead,
    NativeMemoryRecoveryReceipt, NativeMemoryRecoverySnapshot, NativeMemoryRecoveryTarget,
    NativeMemoryRestoration,
};

impl Drop for Review {
    fn drop(&mut self) {
        self.live.store(false, Ordering::Release);
        self.control.cancel();
    }
}

/// A native-only, weak identity. Equal paths never identify the same review.
#[derive(Clone)]
pub struct NativeMemoryPreviewReceipt {
    live: Weak<AtomicBool>,
}

pub struct NativeMemoryPreparedPreview {
    receipt: NativeMemoryPreviewReceipt,
    preview: OwnedProjectInitializationPreview,
}

impl NativeMemoryPreparedPreview {
    pub(super) fn root(&self) -> &Path {
        self.preview.root()
    }
}

struct ReviewOperation<T> {
    job: MemoryDeploymentJob<T>,
    live: Arc<AtomicBool>,
    origin: Arc<Access>,
    destination: Arc<Access>,
}

fn cancelled() -> MemoryDeploymentWorkError {
    ReadError::Cancelled.into()
}

impl<T> ReviewOperation<T> {
    async fn finish(self) -> Result<T, MemoryDeploymentWorkError> {
        let result = self.job.finish().await;
        if !self.live.load(Ordering::Acquire)
            || !self.origin.live.load(Ordering::Acquire)
            || !self.destination.live.load(Ordering::Acquire)
        {
            return Err(cancelled());
        }
        result
    }
}

#[must_use = "finish or drop this preview request to retire its consumer"]
pub struct NativeMemoryPreviewRead {
    operation: ReviewOperation<OwnedProjectInitializationPreview>,
    receipt: NativeMemoryPreviewReceipt,
}
impl NativeMemoryPreviewRead {
    pub fn receipt(&self) -> NativeMemoryPreviewReceipt {
        self.receipt.clone()
    }

    pub async fn finish(self) -> Result<NativeMemoryPreparedPreview, MemoryDeploymentWorkError> {
        Ok(NativeMemoryPreparedPreview {
            preview: self.operation.finish().await?,
            receipt: self.receipt,
        })
    }
}

#[must_use = "finish or drop this publication request to retire its consumer"]
pub struct NativeMemoryPublication {
    operation: ReviewOperation<PublicationReport>,
}
impl NativeMemoryPublication {
    pub async fn finish(self) -> Result<PublicationReport, MemoryDeploymentWorkError> {
        self.operation.finish().await
    }
}

impl NativeMemoryDeployment {
    pub(super) fn clear(&mut self) {
        self.review = None;
    }

    pub(super) fn reserve(
        &mut self,
        destination: NativeMemorySource,
        control: DiscoveryControl,
    ) -> NativeMemoryPreviewReceipt {
        self.reserve_state(destination, control, ReviewState::Reserved)
    }

    fn reserve_state(
        &mut self,
        destination: NativeMemorySource,
        control: DiscoveryControl,
        state: ReviewState,
    ) -> NativeMemoryPreviewReceipt {
        self.clear();
        let review = Review {
            live: Arc::new(AtomicBool::new(true)),
            destination,
            control,
            state,
        };
        let receipt = NativeMemoryPreviewReceipt {
            live: Arc::downgrade(&review.live),
        };
        self.review = Some(review);
        receipt
    }

    pub(super) fn prepare_reserved(
        &mut self,
        source: &NativeMemorySource,
        receipt: &NativeMemoryPreviewReceipt,
        values: NativeMemoryPreviewValues,
    ) -> Result<NativeMemoryPreviewRead, MemoryDeploymentWorkError> {
        if !self.is_current(receipt) {
            return Err(cancelled());
        }
        let review = self.review.as_mut().ok_or_else(cancelled)?;
        if !matches!(review.state, ReviewState::Reserved) {
            return Err(cancelled());
        }
        review.state = ReviewState::Opening;
        let job = MemoryWorkers::default().preview_project_at_root(
            ProjectInitializationRequest {
                origin: source.requested.clone(),
                origin_access: source.access.clone(),
                destination: review.destination.requested.clone(),
                destination_access: review.destination.access.clone(),
                inputs: values.inputs,
                links: values.links,
            },
            review.control.clone(),
        );
        match job {
            Ok(job) => Ok(NativeMemoryPreviewRead {
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

    pub(super) fn is_current(&self, receipt: &NativeMemoryPreviewReceipt) -> bool {
        self.review.as_ref().is_some_and(|review| {
            Weak::ptr_eq(&receipt.live, &Arc::downgrade(&review.live))
                && review.live.load(Ordering::Acquire)
        })
    }

    pub(super) fn accept(
        &mut self,
        prepared: NativeMemoryPreparedPreview,
    ) -> Result<NativeMemoryPreviewReceipt, MemoryDeploymentWorkError> {
        if !self.is_current(&prepared.receipt) {
            return Err(cancelled());
        }
        let review = self.review.as_mut().ok_or_else(cancelled)?;
        if !matches!(review.state, ReviewState::Opening) {
            return Err(cancelled());
        }
        review.state = ReviewState::Ready(Box::new(prepared.preview));
        Ok(prepared.receipt)
    }

    pub(super) fn preview(
        &self,
        receipt: &NativeMemoryPreviewReceipt,
    ) -> Result<&OwnedProjectInitializationPreview, MemoryDeploymentWorkError> {
        if !self.is_current(receipt) {
            return Err(cancelled());
        }
        match &self.review.as_ref().ok_or_else(cancelled)?.state {
            ReviewState::Ready(preview) => Ok(preview),
            _ => Err(cancelled()),
        }
    }

    pub(super) fn cancel(&mut self, receipt: &NativeMemoryPreviewReceipt) -> bool {
        if !self.is_current(receipt) {
            return false;
        }
        self.clear();
        true
    }

    pub(super) fn publish(
        &mut self,
        source: &NativeMemorySource,
        receipt: &NativeMemoryPreviewReceipt,
        access: Arc<dyn MemoryWriteAccess>,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPublication, MemoryDeploymentWorkError> {
        self.preview(receipt)?;
        let review = self.review.as_mut().ok_or_else(cancelled)?;
        let ReviewState::Ready(preview) =
            std::mem::replace(&mut review.state, ReviewState::Publishing)
        else {
            return Err(cancelled());
        };
        review.control = control.clone();
        let digest = preview.acceptance_digest();
        let job = MemoryWorkers::default().publish_project(*preview, digest, access, control);
        match job {
            Ok(job) => Ok(NativeMemoryPublication {
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

    pub(super) fn confirm(
        &mut self,
        source: &NativeMemorySource,
        receipt: &NativeMemoryPreviewReceipt,
        registry: &WorkspaceRegistry,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPublication, MemoryDeploymentWorkError> {
        let preview = self.preview(receipt)?;
        let review = self.review.as_ref().ok_or_else(cancelled)?;
        let access = super::write_authority::NativeMemoryWriteAuthority::capture(
            registry,
            preview,
            source.access.clone(),
            review.destination.access.clone(),
            &review.live,
        );
        match access {
            Ok(access) => self.publish(source, receipt, Arc::new(access), control),
            Err(error) => {
                self.clear();
                Err(error.into())
            }
        }
    }
}
