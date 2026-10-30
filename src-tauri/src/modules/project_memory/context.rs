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
