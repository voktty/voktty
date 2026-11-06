use std::sync::{atomic::AtomicU64, atomic::Ordering, OnceLock};
use std::time::Instant;

#[derive(Clone, Copy)]
pub(super) enum Operation {
    Open,
    Select,
    Inspect,
    Close,
}
impl Operation {
    fn name(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Select => "select",
            Self::Inspect => "inspect",
            Self::Close => "close",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Stage {
    Enter,
    WindowOwner,
    Presentation,
    ResourceTable,
    Selection,
    WorkerAdmission,
    WorkerWait,
    Revalidate,
    Reply,
}

pub(super) struct Event {
    id: u64,
    operation: Operation,
    stage: Stage,
    scope_closed: bool,
    elapsed_ms: u128,
}

struct Active {
    id: u64,
    operation: Operation,
    stage: Stage,
    started: Instant,
}

pub(super) struct Trace<S: Fn(Event) = fn(Event)> {
    active: Option<Active>,
    emit: S,
}

fn emit(event: Event) {
    log::info!(target: "voktty::memory_inspection",
        "memory-inspection id={} operation={} stage={:?} scope_closed={} elapsed_ms={}",
        event.id, event.operation.name(), event.stage, event.scope_closed, event.elapsed_ms);
}

impl Trace {
    pub(super) fn new(operation: Operation) -> Self {
        static ENABLED: OnceLock<bool> = OnceLock::new();
        let enabled = *ENABLED.get_or_init(|| {
            std::env::var_os("VOKTTY_MEMORY_DIAGNOSTICS").as_deref()
                == Some(std::ffi::OsStr::new("1"))
        });
        Self::start(operation, enabled, emit)
    }
}

impl<S: Fn(Event)> Trace<S> {
    fn start(operation: Operation, enabled: bool, emit: S) -> Self {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        let mut trace = Self {
            active: enabled.then(|| Active {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                operation,
                stage: Stage::Enter,
                started: Instant::now(),
            }),
            emit,
        };
        trace.step(Stage::Enter);
        trace
    }

    pub(super) fn step(&mut self, stage: Stage) {
        if let Some(active) = &mut self.active {
            active.stage = stage;
        }
        self.record(false);
    }

    fn record(&self, scope_closed: bool) {
        if let Some(active) = &self.active {
            (self.emit)(Event {
                id: active.id,
                operation: active.operation,
                stage: active.stage,
                scope_closed,
                elapsed_ms: active.started.elapsed().as_millis(),
            });
        }
    }
}

impl<S: Fn(Event)> Drop for Trace<S> {
    fn drop(&mut self) {
        self.record(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn disabled_tracing_emits_nothing_and_early_return_keeps_the_last_stage() {
        let events = RefCell::new(Vec::new());
        {
            let mut trace = Trace::start(Operation::Select, false, |e| events.borrow_mut().push(e));
            trace.step(Stage::Selection);
        }
        assert!(events.borrow().is_empty());
        let rejected = || -> Result<(), ()> {
            let mut trace = Trace::start(Operation::Inspect, true, |e| events.borrow_mut().push(e));
            trace.step(Stage::WorkerAdmission);
            Err(())?;
            trace.step(Stage::Reply);
            Ok(())
        };
        assert!(rejected().is_err());
        let events = events.borrow();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].stage, Stage::Enter);
        assert_eq!(events[1].stage, Stage::WorkerAdmission);
        assert_eq!(events[2].stage, Stage::WorkerAdmission);
        assert!(events.iter().all(|event| event.id == events[0].id));
        assert!(!events[1].scope_closed);
        assert!(events[2].scope_closed);
    }
}
