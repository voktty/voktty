use super::super::{wait_captured_children, HarnessHost, LiveChild};
use super::*;
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

struct Waiting {
    receipt: Arc<LocalWaitReceipt>,
    results: mpsc::Receiver<Option<LocalWaitOutcome>>,
    threads: Vec<JoinHandle<()>>,
    deadline: Instant,
}

impl Drop for Waiting {
    fn drop(&mut self) {
        if !self.threads.is_empty() {
            self.receipt
                .record(Err(io::Error::other("test waiter cleanup")));
            for thread in self.threads.drain(..) {
                let _ = thread.join();
            }
        }
    }
}

fn waiting(receipt: Arc<LocalWaitReceipt>, count: usize) -> Waiting {
    let (results, receiver) = mpsc::channel();
    let (started, ready) = mpsc::channel();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut waiting = Waiting {
        receipt,
        results: receiver,
        threads: Vec::new(),
        deadline,
    };
    for _ in 0..count {
        let receipt = Arc::clone(&waiting.receipt);
        let result = results.clone();
        let started = started.clone();
        waiting.threads.push(thread::spawn(move || {
            let _ = started.send(());
            let outcome = receipt.wait_until(deadline);
            let _ = result.send(outcome);
        }));
    }
    for _ in 0..count {
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    waiting
}

fn child(receipt: Option<Arc<LocalWaitReceipt>>) -> Arc<LiveChild> {
    Arc::new(LiveChild {
        stdin: Mutex::new(None),
        pid: 0,
        account: None,
        _askpass: None,
        remote: None,
        local_wait: receipt,
    })
}

#[test]
fn observed_reaped_code_survives_an_already_expired_cutoff() {
    let receipt = LocalWaitReceipt::new(41);
    receipt.record(Ok(Some(47)));
    assert_eq!(
        receipt.wait_until(Instant::now()),
        Some(LocalWaitOutcome::Reaped(Some(47)))
    );
}

#[test]
fn observed_reaped_without_code_is_not_expired() {
    let receipt = LocalWaitReceipt::new(41);
    receipt.record(Ok(None));
    assert_eq!(
        receipt.wait_until(Instant::now()),
        Some(LocalWaitOutcome::Reaped(None))
    );
}

#[test]
fn observed_wait_failure_is_not_reaped_or_expired() {
    let receipt = LocalWaitReceipt::new(41);
    receipt.record(Err(io::Error::other("wait failed")));
    assert_eq!(
        receipt.wait_until(Instant::now()),
        Some(LocalWaitOutcome::WaitFailed)
    );
}

#[test]
fn pending_receipt_with_expired_cutoff_has_no_positive_observation() {
    let receipt = LocalWaitReceipt::new(41);
    assert_eq!(receipt.wait_until(Instant::now()), None);
    assert!(receipt.outcome.get().is_none());
}

#[test]
fn unpublished_receipt_cannot_return_none_before_its_cutoff() {
    let receipt = LocalWaitReceipt::new(41);
    let deadline = Instant::now() + Duration::from_millis(20);
    assert_eq!(receipt.wait_until(deadline), None);
    assert!(
        Instant::now() >= deadline,
        "wait returned pending before the cutoff"
    );
    assert!(receipt.outcome.get().is_none());
}

#[test]
fn successful_publication_wakes_the_waiter() {
    let receipt = Arc::new(LocalWaitReceipt::new(41));
    let waiting = waiting(Arc::clone(&receipt), 1);
    assert!(matches!(
        waiting.results.recv_timeout(Duration::from_millis(20)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    assert!(waiting.deadline.saturating_duration_since(Instant::now()) > Duration::from_secs(2));
    receipt.record(Ok(Some(47)));
    assert_eq!(
        waiting
            .results
            .recv_timeout(Duration::from_secs(1))
            .unwrap(),
        Some(LocalWaitOutcome::Reaped(Some(47)))
    );
}

#[test]
fn failed_publication_wakes_the_waiter_without_positive_reaping() {
    let receipt = Arc::new(LocalWaitReceipt::new(41));
    let waiting = waiting(Arc::clone(&receipt), 1);
    assert!(matches!(
        waiting.results.recv_timeout(Duration::from_millis(20)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    assert!(waiting.deadline.saturating_duration_since(Instant::now()) > Duration::from_secs(2));
    receipt.record(Err(io::Error::other("wait failed")));
    assert_eq!(
        waiting
            .results
            .recv_timeout(Duration::from_secs(1))
            .unwrap(),
        Some(LocalWaitOutcome::WaitFailed)
    );
}

#[test]
fn first_publication_wakes_all_waiters_without_code() {
    let receipt = Arc::new(LocalWaitReceipt::new(41));
    let waiting = waiting(Arc::clone(&receipt), 8);
    assert!(matches!(
        waiting.results.recv_timeout(Duration::from_millis(20)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    assert!(waiting.deadline.saturating_duration_since(Instant::now()) > Duration::from_secs(2));
    receipt.record(Ok(None));
    let received_by = Instant::now() + Duration::from_secs(1);
    for _ in 0..8 {
        assert_eq!(
            waiting
                .results
                .recv_timeout(received_by.saturating_duration_since(Instant::now()))
                .unwrap(),
            Some(LocalWaitOutcome::Reaped(None))
        );
    }
}

#[test]
fn every_unpublished_receipt_uses_the_same_absolute_cutoff() {
    let receipts: Vec<_> = (1..=128)
        .map(|epoch| Arc::new(LocalWaitReceipt::new(epoch)))
        .collect();
    let start = Instant::now();
    let deadline = start + Duration::from_millis(20);
    assert_eq!(
        wait_cohort(&receipts, deadline),
        LocalWaitSummary {
            reaped: 0,
            failed: 0,
            expired: 128
        }
    );
    assert!(Instant::now() >= deadline);
    assert!(
        start.elapsed() < Duration::from_secs(1),
        "receipt budgets were multiplied by cohort size"
    );
}

#[test]
fn mixed_observations_count_only_actual_local_wait_facts() {
    let receipts: Vec<_> = (1..=4)
        .map(|epoch| Arc::new(LocalWaitReceipt::new(epoch)))
        .collect();
    receipts[0].record(Ok(Some(47)));
    receipts[1].record(Ok(None));
    receipts[2].record(Err(io::Error::other("wait failed")));
    assert_eq!(
        wait_cohort(&receipts, Instant::now()),
        LocalWaitSummary {
            reaped: 2,
            failed: 1,
            expired: 1
        }
    );
}

#[test]
fn empty_cohort_does_not_invent_positive_observations() {
    assert_eq!(
        wait_cohort(&[], Instant::now()),
        LocalWaitSummary::default()
    );
}

#[test]
fn absent_local_receipt_does_not_invent_positive_observations() {
    let children = [child(None)];
    let mut signalled = false;
    let summary = wait_captured_children(&children, Instant::now(), |captured| {
        signalled = true;
        assert!(Arc::ptr_eq(&captured[0], &children[0]));
    });
    assert!(signalled);
    assert_eq!(summary, LocalWaitSummary::default());
}

#[test]
fn batch_wait_keeps_original_receipt_when_signalling_replaces_the_host_actor() {
    let host = HarnessHost::new();
    let (old_epoch, old_generation, _) = host.begin_spawn("same-id");
    let old_receipt = Arc::new(LocalWaitReceipt::new(old_epoch));
    let old = child(Some(Arc::clone(&old_receipt)));
    assert!(host
        .install_spawn(
            "same-id".to_string(),
            old_epoch,
            old_generation,
            Arc::clone(&old)
        )
        .is_none());
    let children = [Arc::clone(&old)];
    let mut replacement = None;
    let summary = wait_captured_children(&children, Instant::now(), |captured| {
        assert!(Arc::ptr_eq(&captured[0], &old));
        assert!(Arc::ptr_eq(
            captured[0].local_wait.as_ref().unwrap(),
            &old_receipt
        ));
        assert!(Arc::ptr_eq(&host.kill_session("same-id").unwrap(), &old));
        let (epoch, generation, _) = host.begin_spawn("same-id");
        let receipt = Arc::new(LocalWaitReceipt::new(epoch));
        let live = child(Some(Arc::clone(&receipt)));
        assert!(host
            .install_spawn("same-id".to_string(), epoch, generation, Arc::clone(&live))
            .is_none());
        replacement = Some((epoch, receipt, live));
        old_receipt.record(Ok(Some(47)));
    });
    assert_eq!(
        summary,
        LocalWaitSummary {
            reaped: 1,
            failed: 0,
            expired: 0
        }
    );
    let (epoch, receipt, live) = replacement.unwrap();
    assert_ne!(epoch, old_epoch);
    assert!(receipt.outcome.get().is_none());
    let inner = host.lock_inner();
    assert_eq!(inner.epochs.get("same-id"), Some(&epoch));
    assert!(Arc::ptr_eq(inner.children.get("same-id").unwrap(), &live));
    drop(inner);
    receipt.record(Ok(Some(0)));
}
