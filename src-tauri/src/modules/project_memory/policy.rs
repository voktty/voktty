use super::*;
use std::sync::Weak;
use voktty_memory_local::{
    MemoryPolicy, MemoryPolicyError, MemoryPolicyJob, MemoryPolicyReview, ProjectPreference,
};

pub(super) struct PolicyControl {
    live: Arc<AtomicBool>,
    control: DiscoveryControl,
    started: bool,
}
impl PolicyControl {
    pub(super) fn new(control: DiscoveryControl) -> Self {
        Self {
            live: Arc::new(AtomicBool::new(true)),
            control,
            started: false,
        }
    }
    pub(super) fn receipt(&self) -> NativeMemoryPolicyReservation {
        NativeMemoryPolicyReservation {
            live: Arc::downgrade(&self.live),
        }
    }
    pub(super) fn matches(&self, receipt: &NativeMemoryPolicyReservation) -> bool {
        self.live.load(Ordering::Acquire)
            && Weak::ptr_eq(&Arc::downgrade(&self.live), &receipt.live)
    }
    pub(super) fn start(
        &mut self,
        receipt: &NativeMemoryPolicyReservation,
    ) -> Result<DiscoveryControl, MemoryPolicyError> {
        if !self.matches(receipt) || self.started {
            return Err(ReadError::Cancelled.into());
        }
        self.started = true;
        Ok(self.control.clone())
    }
    pub(super) fn accepting(
        &mut self,
        review: &NativeMemoryPolicyReview,
        control: DiscoveryControl,
    ) -> Result<(), MemoryPolicyError> {
        if !self.live.load(Ordering::Acquire) || !Arc::ptr_eq(&self.live, &review.live) {
            return Err(ReadError::Cancelled.into());
        }
        self.control.cancel();
        self.control = control;
        Ok(())
    }
}
impl Drop for PolicyControl {
    fn drop(&mut self) {
        self.live.store(false, Ordering::Release);
        self.control.cancel();
    }
}

#[derive(Clone)]
pub struct NativeMemoryPolicyReservation {
    live: Weak<AtomicBool>,
}
impl NativeMemoryPolicyReservation {
    pub fn is_live(&self) -> bool {
        self.live
            .upgrade()
            .is_some_and(|live| live.load(Ordering::Acquire))
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMemoryPolicySnapshot {
    pub root: PathBuf,
    pub project_key: String,
    pub policy: MemoryPolicy,
    pub preference: Option<ProjectPreference>,
}
pub struct NativeMemoryPolicyReview {
    native: MemoryPolicyReview,
    access: Arc<Access>,
    live: Arc<AtomicBool>,
}
impl NativeMemoryPolicyReview {
    pub fn snapshot(
        &self,
        receipt: &NativeMemoryPolicyReservation,
    ) -> Result<NativeMemoryPolicySnapshot, MemoryPolicyError> {
        check(&self.access, &self.live)?;
        if !Weak::ptr_eq(&Arc::downgrade(&self.live), &receipt.live) {
            return Err(ReadError::Cancelled.into());
        }
        Ok(NativeMemoryPolicySnapshot {
            root: self.native.root().to_owned(),
            project_key: self.native.project_key().to_owned(),
            policy: self.native.policy(),
            preference: self.native.preference().cloned(),
        })
    }
}
fn check(access: &Access, live: &AtomicBool) -> Result<(), MemoryPolicyError> {
    if !access.live.load(Ordering::Acquire) || !live.load(Ordering::Acquire) {
        return Err(ReadError::Cancelled.into());
    }
    Ok(())
}
struct Operation<T> {
    job: MemoryPolicyJob<T>,
    access: Arc<Access>,
    live: Arc<AtomicBool>,
}
impl<T> Operation<T> {
    async fn finish(self) -> Result<T, MemoryPolicyError> {
        let result = self.job.finish().await;
        check(&self.access, &self.live)?;
        result
    }
}
#[must_use = "finish or drop the policy review request"]
pub struct NativeMemoryPolicyRead {
    operation: Operation<MemoryPolicyReview>,
}
impl NativeMemoryPolicyRead {
    pub async fn finish(self) -> Result<NativeMemoryPolicyReview, MemoryPolicyError> {
        let access = self.operation.access.clone();
        let live = self.operation.live.clone();
        Ok(NativeMemoryPolicyReview {
            native: self.operation.finish().await?,
            access,
            live,
        })
    }
}
#[must_use = "finish or drop the policy acceptance request"]
pub struct NativeMemoryPolicyWrite {
    operation: Operation<ProjectPreference>,
}
impl NativeMemoryPolicyWrite {
    pub async fn finish(self) -> Result<ProjectPreference, MemoryPolicyError> {
        self.operation.finish().await
    }
}

impl NativeMemorySource {
    pub(super) fn review_policy(
        &self,
        store: Arc<LocalMemoryStore>,
        policy: MemoryPolicy,
        control: DiscoveryControl,
        live: Arc<AtomicBool>,
    ) -> Result<NativeMemoryPolicyRead, MemoryPolicyError> {
        check(&self.access, &live)?;
        Ok(NativeMemoryPolicyRead {
            operation: Operation {
                job: MemoryWorkers::default().review_policy(
                    store,
                    self.requested.clone(),
                    self.access.clone(),
                    policy,
                    control,
                )?,
                access: self.access.clone(),
                live,
            },
        })
    }
    pub(super) fn validate_policy(
        &self,
        review: &NativeMemoryPolicyReview,
    ) -> Result<(), MemoryPolicyError> {
        check(&self.access, &review.live)?;
        if !Arc::ptr_eq(&self.access, &review.access) {
            return Err(ReadError::Cancelled.into());
        }
        Ok(())
    }
    pub(super) fn accept_policy(
        &self,
        review: NativeMemoryPolicyReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPolicyWrite, MemoryPolicyError> {
        self.validate_policy(&review)?;
        Ok(NativeMemoryPolicyWrite {
            operation: Operation {
                job: MemoryWorkers::default().accept_policy(review.native, control)?,
                access: self.access.clone(),
                live: review.live,
            },
        })
    }
}

impl NativeMemorySelection {
    pub(super) fn policy_store_control(
        &self,
        selected: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPolicyReservation,
    ) -> Result<ReadControl, MemoryPolicyError> {
        self.current(selected)?;
        let reservation = self
            .policy_control
            .as_ref()
            .filter(|control| control.matches(receipt) && !control.started)
            .ok_or(ReadError::Cancelled)?;
        Ok(reservation.control.read_control()?)
    }
    pub fn reserve_policy(
        &mut self,
        selected: &NativeMemorySelectionReceipt,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPolicyReservation, MemoryWorkError> {
        self.current(selected)?;
        let control = PolicyControl::new(control);
        let receipt = control.receipt();
        self.policy_control = Some(control);
        Ok(receipt)
    }
    pub fn review_policy(
        &mut self,
        selected: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPolicyReservation,
        store: Arc<LocalMemoryStore>,
        policy: MemoryPolicy,
    ) -> Result<NativeMemoryPolicyRead, MemoryPolicyError> {
        self.current(selected)?;
        let reservation = self.policy_control.as_mut().ok_or(ReadError::Cancelled)?;
        let control = reservation.start(receipt)?;
        let live = reservation.live.clone();
        self.current(selected)?
            .review_policy(store, policy, control, live)
    }
    pub fn accept_policy(
        &mut self,
        selected: &NativeMemorySelectionReceipt,
        review: NativeMemoryPolicyReview,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryPolicyWrite, MemoryPolicyError> {
        self.current(selected)?.validate_policy(&review)?;
        self.policy_control
            .as_mut()
            .ok_or(ReadError::Cancelled)?
            .accepting(&review, control.clone())?;
        self.current(selected)?.accept_policy(review, control)
    }
    pub fn cancel_policy(
        &mut self,
        selected: &NativeMemorySelectionReceipt,
        receipt: &NativeMemoryPolicyReservation,
    ) -> bool {
        if !self.is_current(selected)
            || !self
                .policy_control
                .as_ref()
                .is_some_and(|control| control.matches(receipt))
        {
            return false;
        }
        self.policy_control = None;
        true
    }
}
