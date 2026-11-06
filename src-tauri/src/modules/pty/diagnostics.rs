use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

#[derive(Clone, Copy, Debug)]
pub(super) enum Operation {
    Write,
    Resize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Stage {
    Enter,
    Session,
    Writer,
    Write,
    OutputGate,
    Master,
    Resize,
    Collaboration,
    Reply,
}

struct Active {
    id: u64,
    operation: Operation,
    stage: Stage,
    started: Instant,
}

pub(super) struct Event {
    id: u64,
    operation: Operation,
    stage: Stage,
    scope_closed: bool,
    elapsed_ms: u128,
}

pub(super) struct Trace<S: Fn(Event) = fn(Event)> {
    active: Option<Active>,
    emit: S,
}

fn emit(event: Event) {
    log::info!(target: "voktty::pty_io",
        "pty-io id={} operation={:?} stage={:?} scope_closed={} elapsed_ms={}",
        event.id, event.operation, event.stage, event.scope_closed, event.elapsed_ms);
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
    fn disabled_trace_has_no_active_clock_or_events() {
        let events = RefCell::new(Vec::new());
        {
            let mut trace = Trace::start(Operation::Write, false, |e| events.borrow_mut().push(e));
            assert!(trace.active.is_none());
            trace.step(Stage::Write);
        }
        assert!(events.borrow().is_empty());
    }

    #[test]
    fn early_failure_closes_at_the_last_stage_and_separate_operations_have_distinct_ids() {
        let events = RefCell::new(Vec::new());
        let failed = || -> Result<(), ()> {
            let mut trace = Trace::start(Operation::Resize, true, |e| events.borrow_mut().push(e));
            trace.step(Stage::Master);
            Err(())?;
            trace.step(Stage::Reply);
            Ok(())
        };
        assert!(failed().is_err());
        {
            let mut trace = Trace::start(Operation::Write, true, |e| events.borrow_mut().push(e));
            trace.step(Stage::Reply);
        }
        let events = events.borrow();
        assert_eq!(events.len(), 6);
        assert_eq!(events[0].stage, Stage::Enter);
        assert_eq!(events[1].stage, Stage::Master);
        assert!(!events[1].scope_closed);
        assert_eq!(events[2].stage, Stage::Master);
        assert!(events[2].scope_closed);
        assert!(events[..3].iter().all(|e| e.id == events[0].id));
        assert_ne!(events[0].id, events[3].id);
        assert_eq!(events[5].stage, Stage::Reply);
        assert!(events[5].scope_closed);
    }
}
