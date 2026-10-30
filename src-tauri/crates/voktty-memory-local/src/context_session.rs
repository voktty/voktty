use super::*;
use crate::reader::fact_value;
use crate::workers::{Control, Job};
use crate::ProjectPreference;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;
use voktty_workspace_kit::{build_memory_context, evaluate_memory_use, MemoryContextResult};

const MAX_SESSIONS: usize = 256;
static SESSIONS: OnceLock<Arc<AtomicUsize>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemorySessionUse {
    Inherit,
    Enabled,
    Disabled,
}

struct SessionSlot(Arc<AtomicUsize>);
impl SessionSlot {
    fn acquire(active: Arc<AtomicUsize>) -> Result<Self, ReadError> {
        let mut count = active.load(Ordering::Acquire);
        loop {
            if count >= MAX_SESSIONS {
                return Err(ReadError::Limit);
            }
            match active.compare_exchange_weak(
                count,
                count + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(Self(active)),
                Err(current) => count = current,
            }
        }
    }
}
impl Drop for SessionSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

struct BoundContext {
    origin: OwnedMemoryWorkspace,
    memory: OwnedMemoryWorkspace,
    config: Value,
    fingerprint: voktty_workspace_kit::InstructionFingerprint,
    id: String,
    choice: MemorySessionUse,
    live: AtomicBool,
    _slot: SessionSlot,
}

/// An exact native context owner, never a logical Harness or provider session ID.
/// The caller must associate it with its original conversation incarnation.
pub struct MemoryContextSession {
    bound: Arc<BoundContext>,
}
impl MemoryContextSession {
    pub fn root(&self) -> &Path {
        self.bound.memory.root()
    }

    pub fn retire(&self) {
        self.bound.live.store(false, Ordering::Release);
    }
}
impl Drop for MemoryContextSession {
    fn drop(&mut self) {
        self.retire();
    }
}

#[must_use = "finish or drop the context binding job"]
pub struct MemoryContextSessionJob {
    job: Job<MemoryContextSession, MemoryTrustError>,
}
impl MemoryContextSessionJob {
    pub async fn finish(self) -> Result<MemoryContextSession, MemoryTrustError> {
        let session = self.job.receive().await??;
        session.bound.check()?;
        Ok(session)
    }
}

#[must_use = "finish or drop the context read job"]
pub struct MemoryContextRead {
    job: Job<MemoryContextResult, MemoryTrustError>,
    bound: Arc<BoundContext>,
}
impl MemoryContextRead {
    pub async fn finish(self) -> Result<MemoryContextResult, MemoryTrustError> {
        let result = self.job.receive().await?;
        self.bound.check()?;
        result
    }
}

impl BoundContext {
    fn check(&self) -> Result<(), ReadError> {
        if !self.live.load(Ordering::Acquire) {
            return Err(ReadError::Cancelled);
        }
        if !self.origin.is_authorized() || !self.memory.is_authorized() {
            return Err(ReadError::Denied);
        }
        if !self.live.load(Ordering::Acquire) {
            return Err(ReadError::Cancelled);
        }
        Ok(())
    }

    fn check_scope(&self, control: &DiscoveryControl) -> Result<(), MemoryTrustError> {
        self.check()?;
        let origin = self.origin.borrow();
        let memory = self.memory.borrow();
        origin.checked_root(&control.read_control()?)?;
        memory.checked_root(&control.read_control()?)?;
        if resolve(&origin, control)? != (memory.root().to_owned(), memory.project_key().into()) {
            return Err(MemoryTrustError::Changed);
        }
        self.check()?;
        Ok(())
    }

    fn facts(&self, preference: Option<&ProjectPreference>) -> Value {
        let key = self.memory.borrow().project_key().to_owned();
        let session = match self.choice {
            MemorySessionUse::Inherit => Value::Null,
            choice => json!({
                "projectKey":key, "sessionId":self.id,
                "context":if choice == MemorySessionUse::Enabled { "enabled" } else { "disabled" },
                "captures":false,
            }),
        };
        json!({
            "schema":1, "projectKey":key, "sessionId":self.id, "kitState":"ready",
            "instructionDigest":self.fingerprint.digest,
            "localPolicy":preference.map(|p| json!({"projectKey":p.project_key, "mode":p.policy})),
            "trust":preference.and_then(|p| p.instruction_digest.as_ref().map(|digest|
                json!({"projectKey":p.project_key, "instructionDigest":digest}))),
            "session":session, "capabilities":{"context":true, "capture":false},
        })
    }

    fn read(&self, control: &DiscoveryControl) -> Result<MemoryContextResult, MemoryTrustError> {
        self.check_scope(control)?;
        let memory = self.memory.borrow();
        let (preferences, preference) = memory.observe_preference(&control.read_control()?)?;
        let facts = self.facts(preference.as_ref());
        let decision = evaluate_memory_use(&facts.to_string()).map_err(ReadError::Contract)?;
        let result = if decision.context_allowed {
            let observed = memory
                .observe_context(self.fingerprint.role.as_deref(), &control.read_control()?)?;
            if observed.config != self.config || observed.local_preferences != preferences {
                return Err(MemoryTrustError::Changed);
            }
            build_memory_context(&json!({
                "schema":1, "identity":observed.identity, "use":facts,
                "config":observed.config, "instructions":observed.instructions,
                "project":fact_value(&observed.project), "context":fact_value(&observed.context), "activePlan":null,
            }).to_string()).map_err(ReadError::Contract)?
        } else {
            MemoryContextResult {
                schema: 1,
                decision,
                packet: None,
            }
        };
        self.check_scope(control)?;
        if memory.observe_preference(&control.read_control()?)?.0 != preferences {
            return Err(MemoryTrustError::Changed);
        }
        self.check()?;
        Ok(result)
    }
}

impl MemoryWorkers {
    /// Consumes the exact displayed review without writing trust or preferences.
    /// A policy or trust review by itself never enables this session.
    pub fn bind_context_session(
        &self,
        review: MemoryTrustReview,
        choice: MemorySessionUse,
        control: DiscoveryControl,
    ) -> Result<MemoryContextSessionJob, MemoryTrustError> {
        self.bind_context_with_budget(
            review,
            choice,
            control,
            SESSIONS
                .get_or_init(|| Arc::new(AtomicUsize::new(0)))
                .clone(),
        )
    }

    fn bind_context_with_budget(
        &self,
        review: MemoryTrustReview,
        choice: MemorySessionUse,
        control: DiscoveryControl,
        active: Arc<AtomicUsize>,
    ) -> Result<MemoryContextSessionJob, MemoryTrustError> {
        let slot = SessionSlot::acquire(active)?;
        let job = self.submit(Control::Scope(control.clone()), move || {
            review.revalidate(&control)?;
            Ok(MemoryContextSession {
                bound: Arc::new(BoundContext {
                    origin: review.origin,
                    memory: review.memory,
                    config: review.observed.config,
                    fingerprint: review.observed.fingerprint,
                    id: uuid::Uuid::new_v4().to_string(),
                    choice,
                    live: AtomicBool::new(true),
                    _slot: slot,
                }),
            })
        })?;
        Ok(MemoryContextSessionJob { job })
    }

    pub fn session_context(
        &self,
        session: &MemoryContextSession,
        control: DiscoveryControl,
    ) -> Result<MemoryContextRead, MemoryTrustError> {
        session.bound.check()?;
        let bound = session.bound.clone();
        let worker_bound = bound.clone();
        let job = self.submit(Control::Scope(control.clone()), move || {
            worker_bound.read(&control)
        })?;
        Ok(MemoryContextRead { job, bound })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "context_session_tests.rs"]
mod tests;
