use std::io;
use std::process::Child;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LocalWaitOutcome {
    Reaped(Option<i32>),
    WaitFailed,
}

pub(super) struct LocalWaitReceipt {
    epoch: u64,
    outcome: OnceLock<LocalWaitOutcome>,
    gate: Mutex<()>,
    wake: Condvar,
}

impl LocalWaitReceipt {
    pub(super) fn new(epoch: u64) -> Self {
        Self {
            epoch,
            outcome: OnceLock::new(),
            gate: Mutex::new(()),
            wake: Condvar::new(),
        }
    }

    pub(super) fn epoch(&self) -> u64 {
        self.epoch
    }

    pub(super) fn wait_until(&self, deadline: Instant) -> Option<LocalWaitOutcome> {
        let mut gate = self
            .gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        loop {
            if let Some(outcome) = self.outcome.get().copied() {
                return Some(outcome);
            }
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            let (next, _) = self
                .wake
                .wait_timeout(gate, deadline.saturating_duration_since(now))
                .unwrap_or_else(|poison| poison.into_inner());
            gate = next;
        }
    }

    fn record(&self, result: io::Result<Option<i32>>) -> Option<i32> {
        let outcome = match result {
            Ok(code) => LocalWaitOutcome::Reaped(code),
            Err(_) => LocalWaitOutcome::WaitFailed,
        };
        let code = match outcome {
            LocalWaitOutcome::Reaped(code) => code,
            LocalWaitOutcome::WaitFailed => None,
        };
        let gate = self
            .gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let published = self.outcome.set(outcome).is_ok();
        drop(gate);
        if published {
            self.wake.notify_all();
        }
        code
    }
}

pub(super) fn wait_child(child: &mut Child, receipt: &LocalWaitReceipt) -> Option<i32> {
    receipt.record(child.wait().map(|status| status.code()))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct LocalWaitSummary {
    pub(super) reaped: usize,
    pub(super) failed: usize,
    pub(super) expired: usize,
}

pub(super) fn wait_cohort(
    receipts: &[std::sync::Arc<LocalWaitReceipt>],
    deadline: std::time::Instant,
) -> LocalWaitSummary {
    let mut summary = LocalWaitSummary::default();
    for receipt in receipts {
        match receipt.wait_until(deadline) {
            Some(LocalWaitOutcome::Reaped(_)) => summary.reaped += 1,
            Some(LocalWaitOutcome::WaitFailed) => summary.failed += 1,
            None => summary.expired += 1,
        }
    }
    summary
}

#[cfg(test)]
#[path = "host_local_wait_cohort_tests.rs"]
mod cohort_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::process::{ChildStdin, Command, Stdio};
    use std::sync::{mpsc, Arc};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    fn observed(receipt: &LocalWaitReceipt) -> Option<LocalWaitOutcome> {
        receipt.outcome.get().copied()
    }

    #[test]
    fn fresh_receipt_is_pending_and_keeps_its_original_epoch() {
        let receipt = LocalWaitReceipt::new(41);
        assert_eq!(observed(&receipt), None);
        assert_eq!(receipt.epoch, 41);
    }

    #[test]
    fn successful_wait_publishes_reaped_with_its_exit_code() {
        let receipt = LocalWaitReceipt::new(41);
        assert_eq!(receipt.record(Ok(Some(47))), Some(47));
        assert_eq!(observed(&receipt), Some(LocalWaitOutcome::Reaped(Some(47))));
    }

    #[test]
    fn successful_wait_without_code_is_not_pending_or_failed() {
        let receipt = LocalWaitReceipt::new(41);
        assert_eq!(receipt.record(Ok(None)), None);
        assert_eq!(observed(&receipt), Some(LocalWaitOutcome::Reaped(None)));
    }

    #[test]
    fn wait_error_is_not_reaped_even_though_its_wire_code_is_none() {
        let receipt = LocalWaitReceipt::new(41);
        assert_eq!(receipt.record(Err(io::Error::other("wait failed"))), None);
        assert_eq!(observed(&receipt), Some(LocalWaitOutcome::WaitFailed));
    }

    #[test]
    fn duplicate_publication_keeps_first_fact_but_returns_actual_result_code() {
        let receipt = LocalWaitReceipt::new(41);
        assert_eq!(receipt.record(Ok(Some(47))), Some(47));
        assert_eq!(receipt.record(Err(io::Error::other("late error"))), None);
        assert_eq!(observed(&receipt), Some(LocalWaitOutcome::Reaped(Some(47))));
        assert_eq!(receipt.epoch, 41);
    }

    #[test]
    fn failed_wait_cannot_be_relabelled_reaped_by_another_publication() {
        let receipt = LocalWaitReceipt::new(41);
        assert_eq!(receipt.record(Err(io::Error::other("wait failed"))), None);
        assert_eq!(receipt.record(Ok(Some(47))), Some(47));
        assert_eq!(observed(&receipt), Some(LocalWaitOutcome::WaitFailed));
    }

    #[test]
    fn one_receipt_cannot_publish_another_epoch_outcome() {
        let old = LocalWaitReceipt::new(41);
        let replacement = LocalWaitReceipt::new(42);
        old.record(Ok(Some(47)));
        assert_eq!(observed(&replacement), None);
        assert_eq!(replacement.epoch, 42);
        assert_eq!(observed(&old), Some(LocalWaitOutcome::Reaped(Some(47))));
    }

    #[test]
    fn ordered_concurrent_publication_does_not_overwrite_first_fact() {
        let receipt = Arc::new(LocalWaitReceipt::new(41));
        let first_receipt = Arc::clone(&receipt);
        let (published, ready) = mpsc::channel();
        let first = thread::spawn(move || {
            let code = first_receipt.record(Ok(Some(47)));
            published.send(()).unwrap();
            code
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(receipt.record(Ok(Some(48))), Some(48));
        assert_eq!(first.join().unwrap(), Some(47));
        assert_eq!(observed(&receipt), Some(LocalWaitOutcome::Reaped(Some(47))));
    }

    struct RunningWait {
        stdin: Option<ChildStdin>,
        waiter: Option<JoinHandle<Option<i32>>>,
        reader: Option<JoinHandle<()>>,
    }

    impl Drop for RunningWait {
        fn drop(&mut self) {
            self.stdin.take();
            if let Some(waiter) = self.waiter.take() {
                let _ = waiter.join();
            }
            if let Some(reader) = self.reader.take() {
                let _ = reader.join();
            }
        }
    }

    fn running_wait(receipt: Arc<LocalWaitReceipt>) -> RunningWait {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "modules::harness::host::local_wait::tests::child_fixture",
                "--nocapture",
            ])
            .env("VOKTTY_NATIVE_WAIT_FIXTURE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (ready, ready_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            let found = BufReader::new(stdout).lines().take(32).any(|line| {
                line.is_ok_and(|line| {
                    line.split_whitespace()
                        .any(|word| word == "NATIVE_WAIT_READY")
                })
            });
            let _ = ready.send(found);
        });
        let (started, started_rx) = mpsc::channel();
        let waiter = thread::spawn(move || {
            let _ = started.send(());
            wait_child(&mut child, &receipt)
        });
        let running = RunningWait {
            stdin: Some(stdin),
            waiter: Some(waiter),
            reader: Some(reader),
        };
        assert!(ready_rx.recv_timeout(Duration::from_secs(5)).unwrap());
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        running
    }

    #[test]
    fn actual_owning_wait_publishes_only_after_child_leaves_input_gate() {
        let receipt = Arc::new(LocalWaitReceipt::new(41));
        let mut running = running_wait(Arc::clone(&receipt));
        assert_eq!(observed(&receipt), None);
        running.stdin.as_mut().unwrap().write_all(b"x").unwrap();
        running.stdin.take();
        assert_eq!(running.waiter.take().unwrap().join().unwrap(), Some(47));
        assert_eq!(observed(&receipt), Some(LocalWaitOutcome::Reaped(Some(47))));
    }

    #[test]
    fn retained_receipt_does_not_keep_child_stdin_open() {
        let receipt = Arc::new(LocalWaitReceipt::new(41));
        let retained = Arc::clone(&receipt);
        let mut running = running_wait(Arc::clone(&receipt));
        assert_eq!(observed(&receipt), None);
        running.stdin.take();
        assert_eq!(running.waiter.take().unwrap().join().unwrap(), Some(48));
        assert_eq!(
            observed(&retained),
            Some(LocalWaitOutcome::Reaped(Some(48)))
        );
    }

    #[test]
    fn child_fixture() {
        if std::env::var("VOKTTY_NATIVE_WAIT_FIXTURE").as_deref() != Ok("1") {
            return;
        }
        println!("NATIVE_WAIT_READY");
        io::stdout().flush().unwrap();
        let mut gate = [0_u8; 1];
        let code = if io::stdin().read_exact(&mut gate).is_ok() {
            47
        } else {
            48
        };
        std::process::exit(code);
    }
}
