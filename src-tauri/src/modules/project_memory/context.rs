use super::*;
use std::sync::Weak;
use voktty_memory_local::{
    MemoryContextRead, MemoryContextSession, MemoryContextSessionJob, MemoryTrustError,
};

#[must_use = "finish or drop the owned context binding request"]
pub struct NativeMemoryContextBinding {
    pub(super) target: NativeMemoryContextReceipt,
    pub(super) job: MemoryContextSessionJob,
    pub(super) access: Arc<Access>,
    pub(super) live: Arc<AtomicBool>,
}
impl NativeMemoryContextBinding {
    pub async fn finish(self) -> Result<NativeMemoryPreparedContext, MemoryTrustError> {
        let native = self.job.finish().await?;
        if self.target.identity.upgrade().is_none()
            || !self.access.live.load(Ordering::Acquire)
            || !self.live.load(Ordering::Acquire)
        {
            return Err(ReadError::Cancelled.into());
        }
        Ok(NativeMemoryPreparedContext {
            target: self.target,
            native,
            access: self.access,
            live: self.live,
        })
    }
}

pub struct NativeMemoryPreparedContext {
    pub(super) target: NativeMemoryContextReceipt,
    pub(super) native: MemoryContextSession,
    pub(super) access: Arc<Access>,
    pub(super) live: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct NativeMemoryContextReceipt {
    pub(super) identity: Weak<()>,
}

pub struct NativeMemoryContextTarget<'a> {
    pub context: &'a NativeMemoryContextReceipt,
    pub presentation: &'a NativeMemoryPresentationReceipt,
    pub selected: &'a NativeMemorySelectionReceipt,
}

pub(super) struct ContextControl {
    live: Arc<AtomicBool>,
    target: NativeMemoryContextReceipt,
    control: DiscoveryControl,
}
impl ContextControl {
    pub(super) fn is_pending(&self) -> bool {
        self.target.identity.upgrade().is_some()
            && self.live.load(Ordering::Acquire)
            && self.control.read_control().is_ok()
    }
    pub(super) fn matches(&self, prepared: &NativeMemoryPreparedContext) -> bool {
        self.is_pending()
            && Arc::ptr_eq(&self.live, &prepared.live)
            && Weak::ptr_eq(&self.target.identity, &prepared.target.identity)
    }
}
impl Drop for ContextControl {
    fn drop(&mut self) {
        self.live.store(false, Ordering::Release);
        self.control.cancel();
    }
}

impl NativeMemorySource {
    pub(super) fn bind_project_context(
        &self,
        target: &NativeMemoryContextReceipt,
        control: DiscoveryControl,
    ) -> Result<(NativeMemoryContextBinding, ContextControl), MemoryTrustError> {
        if !self.access.live.load(Ordering::Acquire) || target.identity.upgrade().is_none() {
            return Err(ReadError::Cancelled.into());
        }
        let live = Arc::new(AtomicBool::new(true));
        let binding = NativeMemoryContextBinding {
            target: target.clone(),
            job: MemoryWorkers::default().bind_project_context(
                self.requested.clone(),
                self.access.clone(),
                None,
                control.clone(),
            )?,
            access: self.access.clone(),
            live: live.clone(),
        };
        Ok((
            binding,
            ContextControl {
                live,
                target: target.clone(),
                control,
            },
        ))
    }
}

pub(super) struct NativeMemoryContext {
    pub(super) source: NativeMemorySource,
    pub(super) native: MemoryContextSession,
}
impl NativeMemoryContext {
    pub(super) fn read(
        &self,
        control: DiscoveryControl,
    ) -> Result<MemoryContextRead, MemoryTrustError> {
        MemoryWorkers::default().session_context(&self.native, control)
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "context_project_tests.rs"]
mod project_tests;
