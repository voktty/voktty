use super::*;
use std::sync::{mpsc, Condvar, Mutex};
use tokio::runtime::{Builder, Runtime};

struct Gate {
    released: Mutex<bool>,
    wake: Condvar,
}
impl Gate {
    fn new() -> Self {
        Self {
            released: Mutex::new(false),
            wake: Condvar::new(),
        }
    }
    fn wait(&self) {
        let (_held, timeout) = self
            .wake
            .wait_timeout_while(
                self.released.lock().unwrap(),
                Duration::from_secs(3),
                |released| !*released,
            )
            .unwrap();
        assert!(!timeout.timed_out(), "test gate was not released");
    }
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.wake.notify_all();
    }
}
struct Release(Arc<Gate>);
impl Drop for Release {
    fn drop(&mut self) {
        self.0.release();
    }
}
fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}
fn workers() -> MemoryWorkers {
    MemoryWorkers {
        active: Arc::new(AtomicUsize::new(0)),
    }
}
async fn drain(workers: &MemoryWorkers) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while workers.active.load(Ordering::Acquire) != 0 {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
}

#[test]
fn instances_share_one_production_budget_without_starting_a_runtime() {
    let first = MemoryWorkers::default();
    let second = MemoryWorkers::default();
    assert!(Arc::ptr_eq(&first.active, &second.active));
    let called = Arc::new(AtomicUsize::new(0));
    let work_called = called.clone();
    let result = first.spawn(Control::Read(ReadControl::default()), move || {
        work_called.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });
    assert!(matches!(result, Err(MemoryWorkError::RuntimeUnavailable)));
    assert_eq!(called.load(Ordering::SeqCst), 0);
    assert_eq!(first.active.load(Ordering::Acquire), 0);
}

#[test]
fn dropped_consumers_retain_all_four_slots_until_their_original_workers_settle() {
    let runtime = runtime();
    let workers = workers();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    let (started, observed) = mpsc::channel();
    let mut jobs = Vec::new();
    let mut controls = Vec::new();
    {
        let _entered = runtime.enter();
        for _ in 0..CAPACITY {
            let gate = gate.clone();
            let started = started.clone();
            let control = ReadControl::default();
            controls.push(control.clone());
            jobs.push(
                workers
                    .spawn(Control::Read(control), move || {
                        started.send(()).unwrap();
                        gate.wait();
                        Ok(())
                    })
                    .unwrap(),
            );
        }
    }
    for _ in 0..CAPACITY {
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
    }
    drop(jobs);
    for control in controls {
        assert_eq!(control.check(), Err(ReadError::Cancelled));
    }
    assert_eq!(workers.active.load(Ordering::Acquire), CAPACITY);
    {
        let _entered = runtime.enter();
        assert!(matches!(
            workers
                .clone()
                .spawn(Control::Read(ReadControl::default()), || Ok(())),
            Err(MemoryWorkError::Read(ReadError::Busy))
        ));
    }
    drop(release);
    runtime.block_on(drain(&workers));
    runtime.block_on(async {
        assert_eq!(
            workers
                .spawn(Control::Read(ReadControl::default()), || Ok(7))
                .unwrap()
                .finish()
                .await,
            Ok(7)
        );
    });
}

#[test]
fn response_timeout_does_not_release_a_blocked_worker_or_extend_its_deadline() {
    let runtime = runtime();
    let workers = workers();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    let (started, observed) = mpsc::channel();
    let job = {
        let _entered = runtime.enter();
        workers
            .spawn(
                Control::Read(ReadControl::new(Duration::from_millis(40))),
                move || {
                    started.send(()).unwrap();
                    gate.wait();
                    Ok(42)
                },
            )
            .unwrap()
    };
    observed.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(
        runtime.block_on(job.finish()),
        Err(MemoryWorkError::Read(ReadError::Timeout))
    );
    assert_eq!(workers.active.load(Ordering::Acquire), 1);
    drop(release);
    runtime.block_on(drain(&workers));
}

#[test]
fn completed_results_remain_bounded_and_are_rejected_after_the_original_deadline() {
    let runtime = runtime();
    let workers = workers();
    let (completed, observed) = mpsc::channel();
    let mut jobs = Vec::new();
    {
        let _entered = runtime.enter();
        for _ in 0..CAPACITY {
            let completed = completed.clone();
            jobs.push(
                workers
                    .spawn(
                        Control::Read(ReadControl::new(Duration::from_millis(40))),
                        move || {
                            completed.send(()).unwrap();
                            Ok(1)
                        },
                    )
                    .unwrap(),
            );
        }
    }
    for _ in 0..CAPACITY {
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
    }
    assert_eq!(workers.active.load(Ordering::Acquire), CAPACITY);
    runtime.block_on(async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        for job in jobs {
            assert_eq!(
                job.finish().await,
                Err(MemoryWorkError::Read(ReadError::Timeout))
            );
        }
        drain(&workers).await;
    });
}

#[test]
fn dropping_an_unpolled_finish_future_retires_its_original_control() {
    let runtime = runtime();
    let workers = workers();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    let (started, observed) = mpsc::channel();
    let control = ReadControl::default();
    let job = {
        let _entered = runtime.enter();
        workers
            .spawn(Control::Read(control.clone()), move || {
                started.send(()).unwrap();
                gate.wait();
                Ok(())
            })
            .unwrap()
    };
    observed.recv_timeout(Duration::from_secs(3)).unwrap();
    drop(job.finish());
    assert_eq!(control.check(), Err(ReadError::Cancelled));
    assert_eq!(workers.active.load(Ordering::Acquire), 1);
    drop(release);
    runtime.block_on(drain(&workers));
}

#[test]
fn a_queued_worker_stays_charged_and_never_enters_io_after_consumer_timeout() {
    let runtime = Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    let workers = workers();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    let (started, observed) = mpsc::channel();
    let occupied = runtime.spawn_blocking(move || {
        started.send(()).unwrap();
        gate.wait();
    });
    observed.recv_timeout(Duration::from_secs(3)).unwrap();
    let called = Arc::new(AtomicUsize::new(0));
    let work_called = called.clone();
    runtime.block_on(async {
        let job = workers
            .spawn(
                Control::Read(ReadControl::new(Duration::from_millis(40))),
                move || {
                    work_called.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(
            job.finish().await,
            Err(MemoryWorkError::Read(ReadError::Timeout))
        );
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        drop(release);
        occupied.await.unwrap();
        drain(&workers).await;
    });
    assert_eq!(called.load(Ordering::SeqCst), 0);
}

#[test]
fn panic_or_read_failure_releases_only_its_own_slot_without_acknowledging_success() {
    runtime().block_on(async {
        let workers = workers();
        let panicked = workers
            .spawn::<()>(Control::Read(ReadControl::default()), || {
                panic!("test worker failure")
            })
            .unwrap();
        assert_eq!(panicked.finish().await, Err(MemoryWorkError::Failed));
        let failed = workers
            .spawn::<()>(Control::Read(ReadControl::default()), || {
                Err(ReadError::Denied)
            })
            .unwrap();
        assert_eq!(
            failed.finish().await,
            Err(MemoryWorkError::Read(ReadError::Denied))
        );
        drain(&workers).await;
    });
}

#[test]
fn cancelled_and_expired_requests_do_not_admit_work() {
    let workers = workers();
    let control = ReadControl::default();
    control.cancel();
    assert!(matches!(
        workers.spawn(Control::Read(control), || Ok(())),
        Err(MemoryWorkError::Read(ReadError::Cancelled))
    ));
    assert!(matches!(
        workers.spawn(
            Control::Scope(DiscoveryControl::new(Duration::ZERO)),
            || Ok(())
        ),
        Err(MemoryWorkError::Read(ReadError::Timeout))
    ));
    assert_eq!(workers.active.load(Ordering::Acquire), 0);
}

#[test]
fn store_initialization_shares_capacity_with_running_observations() {
    let runtime = runtime();
    let workers = workers();
    let directory = tempfile::tempdir().unwrap();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    runtime.block_on(async {
        let mut jobs = Vec::new();
        for _ in 0..CAPACITY {
            let gate = gate.clone();
            jobs.push(
                workers
                    .spawn(Control::Read(ReadControl::default()), move || {
                        gate.wait();
                        Ok(())
                    })
                    .unwrap(),
            );
        }
        assert!(matches!(
            workers.store(
                directory.path().to_path_buf(),
                MemoryStoreMode::Initialize,
                ReadControl::default()
            ),
            Err(MemoryWorkError::Read(ReadError::Busy))
        ));
        assert!(!directory.path().join("project-memory").exists());
        drop(release);
        for job in jobs {
            job.finish().await.unwrap();
        }
    });
}

#[test]
fn a_queued_initialization_times_out_without_creating_private_state() {
    let runtime = Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    let workers = workers();
    let directory = tempfile::tempdir().unwrap();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    let (started, observed) = mpsc::channel();
    let occupied = runtime.spawn_blocking(move || {
        started.send(()).unwrap();
        gate.wait();
    });
    observed.recv_timeout(Duration::from_secs(3)).unwrap();
    runtime.block_on(async {
        let job = workers
            .store(
                directory.path().to_path_buf(),
                MemoryStoreMode::Initialize,
                ReadControl::new(Duration::from_millis(40)),
            )
            .unwrap();
        assert!(matches!(
            job.finish().await,
            Err(MemoryWorkError::Read(ReadError::Timeout))
        ));
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        drop(release);
        occupied.await.unwrap();
        drain(&workers).await;
    });
    assert!(!directory.path().join("project-memory").exists());
}

#[test]
fn finishing_without_an_entered_runtime_returns_an_error_and_retires_the_consumer() {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    let runtime = runtime();
    let workers = workers();
    let control = ReadControl::default();
    let job = {
        let _entered = runtime.enter();
        workers
            .spawn(Control::Read(control.clone()), || Ok(()))
            .unwrap()
    };
    let mut finish = Box::pin(job.finish());
    assert_eq!(
        finish
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop())),
        Poll::Ready(Err(MemoryWorkError::RuntimeUnavailable))
    );
    assert_eq!(control.check(), Err(ReadError::Cancelled));
    runtime.block_on(drain(&workers));
}

#[test]
fn a_completed_phase_does_not_cancel_the_shared_request_control() {
    runtime().block_on(async {
        let workers = workers();
        for control in [
            Control::Read(ReadControl::default()),
            Control::Scope(DiscoveryControl::default()),
        ] {
            assert_eq!(
                workers
                    .spawn(control.clone(), || Ok(1))
                    .unwrap()
                    .finish()
                    .await,
                Ok(1)
            );
            assert_eq!(control.check(), Ok(()));
            assert_eq!(
                workers
                    .spawn(control.clone(), || Ok(2))
                    .unwrap()
                    .finish()
                    .await,
                Ok(2)
            );
            assert_eq!(control.check(), Ok(()));
        }
        drain(&workers).await;
    });
}

#[test]
fn cancellation_keeps_its_cause_when_a_blocked_worker_outlives_the_response_deadline() {
    let runtime = runtime();
    let workers = workers();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    let control = ReadControl::new(Duration::from_millis(500));
    let (started, observed) = mpsc::channel();
    let job = {
        let _entered = runtime.enter();
        workers
            .spawn(Control::Read(control.clone()), move || {
                started.send(()).unwrap();
                gate.wait();
                Ok(())
            })
            .unwrap()
    };
    observed.recv_timeout(Duration::from_secs(3)).unwrap();
    runtime.block_on(async {
        let cancel = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1)).await;
            control.cancel();
        });
        assert_eq!(
            job.finish().await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        );
        cancel.await.unwrap();
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        drop(release);
        drain(&workers).await;
    });
}
