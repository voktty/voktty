use super::*;
use serde::Serialize;
use serde_json::Value;
use std::sync::Weak;
use voktty_memory_local::{
    LocalMemorySnapshot, MemoryTrustError, MemoryTrustJob, MemoryTrustReview, ProjectPreference,
};
use voktty_workspace_kit::InstructionFingerprint;

pub(super) struct TrustControl {
    pub(super) live: Arc<AtomicBool>,
    pub(super) control: DiscoveryControl,
}
impl TrustControl {
    pub(super) fn new(control: DiscoveryControl) -> Self {
        Self {
            live: Arc::new(AtomicBool::new(true)),
            control,
        }
    }
    pub(super) fn receipt(&self) -> NativeMemoryTrustReservation {
        NativeMemoryTrustReservation {
            live: Arc::downgrade(&self.live),
        }
    }
    pub(super) fn matches(&self, review: &NativeMemoryTrustReview) -> bool {
        self.live.load(Ordering::Acquire) && Arc::ptr_eq(&self.live, &review.live)
    }
    pub(super) fn matches_reservation(&self, reservation: &NativeMemoryTrustReservation) -> bool {
        self.live.load(Ordering::Acquire)
            && Weak::ptr_eq(&Arc::downgrade(&self.live), &reservation.live)
    }
    pub(super) fn accepting(&mut self, control: DiscoveryControl) {
        self.control.cancel();
        self.control = control;
    }
}
impl Drop for TrustControl {
    fn drop(&mut self) {
        self.live.store(false, Ordering::Release);
        self.control.cancel();
    }
}

#[derive(Clone)]
pub struct NativeMemoryTrustReservation {
    live: Weak<AtomicBool>,
}
impl NativeMemoryTrustReservation {
    pub fn is_live(&self) -> bool {
        self.live
            .upgrade()
            .is_some_and(|live| live.load(Ordering::Acquire))
    }

    pub fn retire(&self) {
        if let Some(live) = self.live.upgrade() {
            live.store(false, Ordering::Release);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMemoryTrustSnapshot {
    pub root: PathBuf,
    pub project_key: String,
    pub config: Value,
    pub instructions: Value,
    pub fingerprint: InstructionFingerprint,
    pub preference: Option<ProjectPreference>,
}

pub struct NativeMemoryTrustReview {
    native: MemoryTrustReview,
    access: Arc<Access>,
    live: Arc<AtomicBool>,
}
impl NativeMemoryTrustReview {
    pub fn snapshot(
        &self,
        reservation: &NativeMemoryTrustReservation,
    ) -> Result<NativeMemoryTrustSnapshot, MemoryTrustError> {
        check(&self.access, &self.live)?;
        if !Weak::ptr_eq(&Arc::downgrade(&self.live), &reservation.live) {
            return Err(ReadError::Cancelled.into());
        }
        let observed = self.native.observation();
        Ok(NativeMemoryTrustSnapshot {
            root: self.native.root().to_owned(),
            project_key: observed.project_key.clone(),
            config: observed.config.clone(),
            instructions: observed.instructions.clone(),
            fingerprint: observed.fingerprint.clone(),
            preference: observed.preference.clone(),
        })
    }
}

fn check(access: &Access, live: &AtomicBool) -> Result<(), MemoryTrustError> {
    if !access.live.load(Ordering::Acquire) || !live.load(Ordering::Acquire) {
        return Err(ReadError::Cancelled.into());
    }
    Ok(())
}

struct Operation<T> {
    job: MemoryTrustJob<T>,
    access: Arc<Access>,
    live: Arc<AtomicBool>,
}
impl<T> Operation<T> {
    async fn finish(self) -> Result<T, MemoryTrustError> {
        let result = self.job.finish().await;
        check(&self.access, &self.live)?;
        result
    }
}

#[must_use = "finish or drop the instruction review request"]
pub struct NativeMemoryTrustRead {
    operation: Operation<MemoryTrustReview>,
}
impl NativeMemoryTrustRead {
    pub async fn finish(self) -> Result<NativeMemoryTrustReview, MemoryTrustError> {
        let access = self.operation.access.clone();
        let live = self.operation.live.clone();
        Ok(NativeMemoryTrustReview {
            native: self.operation.finish().await?,
            access,
            live,
        })
    }
}

#[must_use = "finish or drop the instruction acceptance request"]
pub struct NativeMemoryTrustWrite {
    operation: Operation<LocalMemorySnapshot>,
    project_key: String,
}
impl NativeMemoryTrustWrite {
    pub async fn finish(self) -> Result<ProjectPreference, MemoryTrustError> {
        self.operation
            .finish()
            .await?
            .project(&self.project_key)
            .cloned()
            .ok_or_else(|| ReadError::Unavailable.into())
    }
}

impl NativeMemorySource {
    pub(super) fn bind_context_session(
        &self,
        target: &NativeMemoryContextReceipt,
        review: NativeMemoryTrustReview,
        choice: voktty_memory_local::MemorySessionUse,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryContextBinding, MemoryTrustError> {
        self.validate_trust(&review)?;
        Ok(NativeMemoryContextBinding {
            target: target.clone(),
            job: MemoryWorkers::default().bind_context_session(review.native, choice, control)?,
            access: self.access.clone(),
            live: review.live,
        })
    }

    pub(super) fn review_trust(
        &self,
        store: Arc<LocalMemoryStore>,
        role: Option<String>,
        reservation: &TrustControl,
    ) -> Result<NativeMemoryTrustRead, MemoryTrustError> {
        check(&self.access, &reservation.live)?;
        Ok(NativeMemoryTrustRead {
            operation: Operation {
                job: MemoryWorkers::default().review_trust(
                    store,
                    self.requested.clone(),
                    self.access.clone(),
                    role,
                    reservation.control.clone(),
                )?,
                access: self.access.clone(),
                live: reservation.live.clone(),
            },
        })
    }

    pub(super) fn accept_trust(
        &self,
        review: NativeMemoryTrustReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryTrustWrite, MemoryTrustError> {
        self.validate_trust(&review)?;
        Ok(NativeMemoryTrustWrite {
            project_key: review.native.observation().project_key.clone(),
            operation: Operation {
                job: MemoryWorkers::default().accept_trust(review.native, control)?,
                access: self.access.clone(),
                live: review.live,
            },
        })
    }

    pub(super) fn validate_trust(
        &self,
        review: &NativeMemoryTrustReview,
    ) -> Result<(), MemoryTrustError> {
        check(&self.access, &review.live)?;
        if !Arc::ptr_eq(&self.access, &review.access) {
            return Err(ReadError::Cancelled.into());
        }
        Ok(())
    }
}
