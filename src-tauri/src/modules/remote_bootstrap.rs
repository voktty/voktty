use super::{
    stop_owned_process, ProcessControl, RemoteSession, RemoteSshConnection,
    REMOTE_PROCESS_STOP_TIMEOUT,
};
use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

pub(super) const CLEANUP_PENDING: &str = "Remote SSH bootstrap cleanup is pending.";
const MAX_OWNERS: usize = 256;

#[derive(Clone, PartialEq, Eq)]
pub(super) struct AuthBinding {
    host: String,
    user: String,
    port: u16,
    identity: String,
    args: Vec<String>,
}

impl AuthBinding {
    pub(super) fn new(connection: &RemoteSshConnection) -> Result<Self, String> {
        super::validate_connection(connection)?;
        Ok(Self {
            host: match connection.host.trim().split_once('%') {
                Some((host, zone)) => format!("{}%{zone}", host.to_ascii_lowercase()),
                None => connection.host.trim().to_ascii_lowercase(),
            },
            user: connection
                .user
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_string(),
            port: connection.port.unwrap_or(22),
            identity: super::expand_tilde(connection.identity_file.as_deref().unwrap_or_default()),
            args: super::parse_extra_args(connection.extra_args.as_deref().unwrap_or_default()),
        })
    }
}

fn discard_buffered_input<W: std::io::Write>(writer: std::io::BufWriter<W>) {
    let _ = writer.into_parts();
}

type ReadyRegistry = Mutex<HashMap<u64, Arc<RemoteSession>>>;
pub(super) type IoResult = Result<Vec<u8>, String>;
pub(super) struct OwnedIo {
    pub(super) handle: JoinHandle<IoResult>,
    pub(super) stream: u8,
}

pub(super) struct BootstrapOwner<P = Child> {
    pub(super) id: u64,
    binding: AuthBinding,
    pub(super) retired: AtomicBool,
    pub(super) running: AtomicBool,
    pub(super) published: AtomicBool,
    pub(super) child: Mutex<Option<P>>,
    pub(super) workers: Mutex<Vec<OwnedIo>>,
    pub(super) session: Mutex<Option<Arc<RemoteSession>>>,
    pub(super) askpass: Mutex<Option<Arc<super::Askpass>>>,
    pub(super) ready_registry: Mutex<Option<std::sync::Weak<ReadyRegistry>>>,
    close_lock: Mutex<()>,
    spawn_gate: Arc<Mutex<()>>,
}

impl<P: ProcessControl> BootstrapOwner<P> {
    pub(super) fn ensure_active(&self) -> Result<(), String> {
        if self.retired.load(Ordering::Acquire) {
            Err(CLEANUP_PENDING.to_string())
        } else {
            Ok(())
        }
    }

    pub(super) fn retire(&self) {
        self.retired.store(true, Ordering::Release);
        let session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(session) = session {
            session.resources.retired.store(true, Ordering::Release);
            session.routing.fail_all("remote SSH session closed");
        }
    }

    pub(super) fn spawn_worker(
        &self,
        name: &str,
        stream: u8,
        work: impl FnOnce() -> IoResult + Send + 'static,
    ) -> Result<(), String> {
        self.retain_worker(
            std::thread::Builder::new()
                .name(name.to_string())
                .spawn(work),
            stream,
        )
    }

    fn retain_worker(
        &self,
        handle: std::io::Result<JoinHandle<IoResult>>,
        stream: u8,
    ) -> Result<(), String> {
        let handle = handle.map_err(|_| "could not start SSH I/O worker".to_string())?;
        self.workers
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(OwnedIo { handle, stream });
        Ok(())
    }

    pub(super) fn take_outputs(&self, deadline: Instant) -> Result<Vec<(u8, Vec<u8>)>, String> {
        loop {
            let mut workers = self
                .workers
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if workers.iter().all(|worker| worker.handle.is_finished()) {
                return workers
                    .drain(..)
                    .map(|worker| {
                        let output = worker
                            .handle
                            .join()
                            .map_err(|_| "SSH I/O worker failed".to_string())??;
                        Ok((worker.stream, output))
                    })
                    .collect();
            }
            drop(workers);
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CLEANUP_PENDING.to_string());
            }
            std::thread::sleep(remaining.min(std::time::Duration::from_millis(20)));
        }
    }

    fn discard_finished_workers(&self) -> bool {
        let mut workers = self
            .workers
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut index = 0;
        while index < workers.len() {
            if workers[index].handle.is_finished() {
                let worker = workers.swap_remove(index);
                let _ = worker.handle.join();
            } else {
                index += 1;
            }
        }
        workers.is_empty()
    }

    fn drain_workers(&self, deadline: Instant) -> Result<(), String> {
        loop {
            if self.discard_finished_workers() {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CLEANUP_PENDING.to_string());
            }
            std::thread::sleep(remaining.min(std::time::Duration::from_millis(20)));
        }
    }

    pub(super) fn rollback_stage(&self, deadline: Instant) -> Result<(), String> {
        let mut child = self.child.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(child) = child.as_mut() {
            stop_owned_process(child, deadline.saturating_duration_since(Instant::now()))?;
        }
        drop(child);
        self.drain_workers(deadline)?;
        self.child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        Ok(())
    }

    fn stop_installed_assets(
        &self,
        deadline: Instant,
    ) -> Result<Option<Arc<super::Askpass>>, String> {
        let askpass = self
            .askpass
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(askpass) = &askpass {
            let _ = askpass.close_with_timeout(std::time::Duration::ZERO);
        }
        let mut child = match self.child.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
            Err(_) => return Err(CLEANUP_PENDING.to_string()),
        };
        if let Some(process) = child.as_mut() {
            stop_owned_process(process, deadline.saturating_duration_since(Instant::now()))?;
        }
        drop(child);
        let session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(session) = session {
            session.routing.fail_all("remote SSH session closed");
            session
                .resources
                .close_with_timeout(deadline.saturating_duration_since(Instant::now()))?;
            let mut stdin = match session.stdin.try_lock() {
                Ok(guard) => guard,
                Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
                Err(_) => return Err(CLEANUP_PENDING.to_string()),
            };
            // Dropping BufWriter would flush into a potentially inherited, blocked pipe.
            let _ = stdin.take().map(discard_buffered_input);
            drop(stdin);
            match session._askpass.try_lock() {
                Ok(mut askpass) => {
                    askpass.take();
                }
                Err(std::sync::TryLockError::Poisoned(error)) => {
                    error.into_inner().take();
                }
                Err(_) => return Err(CLEANUP_PENDING.to_string()),
            }
        }
        Ok(askpass)
    }

    pub(super) fn cleanup(&self, deadline: Instant) -> Result<(), String> {
        let _close = match self.close_lock.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
            Err(_) => return Err(CLEANUP_PENDING.to_string()),
        };
        loop {
            if !self.running.load(Ordering::Acquire) {
                // All installs precede operation settlement; no earlier snapshot can certify this pass.
                let askpass = self.stop_installed_assets(deadline)?;
                self.drain_workers(deadline)?;
                if let Some(askpass) = askpass {
                    askpass
                        .close_with_timeout(deadline.saturating_duration_since(Instant::now()))?;
                }
                self.child
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .take();
                self.askpass
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .take();
                return Ok(());
            }
            self.stop_installed_assets(deadline)?;
            self.discard_finished_workers();
            if !self.running.load(Ordering::Acquire) {
                continue;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CLEANUP_PENDING.to_string());
            }
            std::thread::sleep(remaining.min(std::time::Duration::from_millis(20)));
        }
    }
}

pub(super) struct BootstrapRegistry<P = Child> {
    pub(super) owners: Mutex<HashMap<u64, Arc<BootstrapOwner<P>>>>,
}
impl<P> Default for BootstrapRegistry<P> {
    fn default() -> Self {
        Self {
            owners: Mutex::new(HashMap::new()),
        }
    }
}

impl<P: ProcessControl> BootstrapRegistry<P> {
    pub(super) fn reserve(
        self: &Arc<Self>,
        id: u64,
        binding: AuthBinding,
    ) -> Result<BootstrapPermit<P>, String> {
        let mut owners = self
            .owners
            .lock()
            .map_err(|_| "remote bootstrap state is poisoned")?;
        if owners.len() >= MAX_OWNERS {
            let retired: Vec<_> = owners
                .values()
                .filter(|owner| owner.retired.load(Ordering::Acquire))
                .cloned()
                .collect();
            drop(owners);
            let deadline = Instant::now();
            for owner in retired {
                if owner.cleanup(deadline).is_ok() {
                    self.remove(&owner);
                }
            }
            owners = self
                .owners
                .lock()
                .map_err(|_| "remote bootstrap state is poisoned")?;
            if owners.len() >= MAX_OWNERS {
                return Err("remote SSH resource capacity reached".to_string());
            }
        }
        if owners.contains_key(&id) {
            return Err("duplicate remote bootstrap owner".to_string());
        }
        let spawn_gate = owners
            .values()
            .find(|owner| owner.binding == binding)
            .map(|owner| owner.spawn_gate.clone())
            .unwrap_or_else(|| Arc::new(Mutex::new(())));
        let owner = Arc::new(BootstrapOwner {
            id,
            binding,
            retired: AtomicBool::new(false),
            running: AtomicBool::new(true),
            published: AtomicBool::new(false),
            child: Mutex::new(None),
            workers: Mutex::new(Vec::new()),
            session: Mutex::new(None),
            askpass: Mutex::new(None),
            ready_registry: Mutex::new(None),
            close_lock: Mutex::new(()),
            spawn_gate,
        });
        owners.insert(id, owner.clone());
        Ok(BootstrapPermit {
            owner,
            registry: self.clone(),
            settled: false,
        })
    }

    pub(super) fn retry_binding(
        &self,
        binding: &AuthBinding,
        deadline: Instant,
    ) -> Result<(), String> {
        let captured: Vec<_> = self
            .owners
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .filter(|owner| owner.binding == *binding && owner.retired.load(Ordering::Acquire))
            .cloned()
            .collect();
        let mut pending = false;
        for owner in captured {
            if owner.cleanup(deadline).is_ok() {
                self.remove(&owner);
            } else {
                pending = true;
            }
        }
        if pending {
            Err(CLEANUP_PENDING.to_string())
        } else {
            Ok(())
        }
    }

    pub(super) fn remove(&self, owner: &Arc<BootstrapOwner<P>>) {
        let removed = {
            let mut owners = self
                .owners
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if owners
                .get(&owner.id)
                .is_some_and(|current| Arc::ptr_eq(current, owner))
            {
                owners.remove(&owner.id)
            } else {
                None
            }
        };
        if removed.is_some() {
            let ready = owner
                .ready_registry
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .as_ref()
                .and_then(std::sync::Weak::upgrade);
            let session = owner
                .session
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone();
            if let (Some(ready), Some(session)) = (ready, session) {
                let removed_session = {
                    let mut ready = ready.lock().unwrap_or_else(|error| error.into_inner());
                    if ready
                        .get(&owner.id)
                        .is_some_and(|current| Arc::ptr_eq(current, &session))
                    {
                        ready.remove(&owner.id)
                    } else {
                        None
                    }
                };
                drop(removed_session);
            }
        }
        drop(removed);
    }

    fn check_stage(&self, owner: &BootstrapOwner<P>) -> Result<(), String> {
        owner.ensure_active()?;
        if self
            .owners
            .lock()
            .map_err(|_| "remote bootstrap state is poisoned")?
            .values()
            .any(|other| other.binding == owner.binding && other.retired.load(Ordering::Acquire))
        {
            return Err(CLEANUP_PENDING.to_string());
        }
        Ok(())
    }
}

pub(super) struct BootstrapPermit<P: ProcessControl = Child> {
    pub(super) owner: Arc<BootstrapOwner<P>>,
    pub(super) registry: Arc<BootstrapRegistry<P>>,
    settled: bool,
}
impl<P: ProcessControl> BootstrapPermit<P> {
    pub(super) fn prepare(&self) -> Result<(), String> {
        self.owner.ensure_active()?;
        self.registry.retry_binding(
            &self.owner.binding,
            Instant::now() + REMOTE_PROCESS_STOP_TIMEOUT,
        )?;
        self.registry.check_stage(&self.owner)
    }
    pub(super) fn finish<T>(mut self, result: Result<T, String>) -> Result<T, String> {
        self.owner.running.store(false, Ordering::Release);
        self.settled = true;
        if result.is_ok()
            && self.owner.published.load(Ordering::Acquire)
            && !self.owner.retired.load(Ordering::Acquire)
        {
            return result;
        }
        let already_pending = self.owner.retired.load(Ordering::Acquire);
        self.owner.retire();
        let deadline = if already_pending {
            Instant::now()
        } else {
            Instant::now() + REMOTE_PROCESS_STOP_TIMEOUT
        };
        if self.owner.cleanup(deadline).is_err() {
            return Err(CLEANUP_PENDING.to_string());
        }
        self.registry.remove(&self.owner);
        if self.owner.published.load(Ordering::Acquire) {
            Err(CLEANUP_PENDING.to_string())
        } else {
            result
        }
    }
}
impl BootstrapPermit<Child> {
    pub(super) fn spawn(&self, command: &mut Command, error_label: &str) -> Result<(), String> {
        self.prepare()?;
        let _claim = self
            .owner
            .spawn_gate
            .lock()
            .map_err(|_| "remote bootstrap spawn state is poisoned")?;
        self.registry.check_stage(&self.owner)?;
        if self
            .owner
            .child
            .lock()
            .map_err(|_| "remote bootstrap child state is poisoned")?
            .is_some()
        {
            return Err(CLEANUP_PENDING.to_string());
        }
        let child = command
            .spawn()
            .map_err(|error| format!("{error_label}: {error}"))?;
        *self
            .owner
            .child
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(child);
        self.registry.check_stage(&self.owner)
    }
}
impl<P: ProcessControl> Drop for BootstrapPermit<P> {
    fn drop(&mut self) {
        if !self.settled {
            self.owner.retire();
            self.owner.running.store(false, Ordering::Release);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct FakeProcess {
        terminal: bool,
        kill_fails: bool,
        inspect_fails: bool,
        ignore_kill: bool,
    }
    impl ProcessControl for FakeProcess {
        fn exited(&mut self) -> std::io::Result<bool> {
            if self.inspect_fails {
                Err(std::io::Error::other("private native detail"))
            } else {
                Ok(self.terminal)
            }
        }
        fn kill_owned(&mut self) -> std::io::Result<()> {
            if self.kill_fails {
                return Err(std::io::Error::other("private native detail"));
            }
            if !self.ignore_kill {
                self.terminal = true;
            }
            Ok(())
        }
    }
    fn binding() -> AuthBinding {
        AuthBinding {
            host: "server.example".to_string(),
            user: "user".to_string(),
            port: 22,
            identity: String::new(),
            args: Vec::new(),
        }
    }
    fn process() -> FakeProcess {
        FakeProcess {
            terminal: false,
            kill_fails: false,
            inspect_fails: false,
            ignore_kill: false,
        }
    }
    fn registry() -> Arc<BootstrapRegistry<FakeProcess>> {
        Arc::new(BootstrapRegistry::default())
    }

    #[test]
    fn pending_live_and_failed_owners_share_the_256_budget() {
        let registry = registry();
        let mut permits = Vec::new();
        for id in 1..=256 {
            let permit = registry.reserve(id, binding()).unwrap();
            if id % 3 == 0 {
                permit.owner.published.store(true, Ordering::Release);
            }
            if id % 3 == 1 {
                permit.owner.retire();
            }
            permits.push(permit);
        }
        assert!(registry.reserve(257, binding()).is_err());
        assert_eq!(registry.owners.lock().unwrap().len(), 256);
    }

    #[test]
    fn dropped_error_is_retryable_and_blocks_only_matching_binding() {
        let registry = registry();
        let first = registry.reserve(1, binding()).unwrap();
        let mut child = process();
        child.kill_fails = true;
        *first.owner.child.lock().unwrap() = Some(child);
        let captured = first.owner.clone();
        assert_eq!(
            first
                .finish::<()>(Err("original failure".into()))
                .unwrap_err(),
            CLEANUP_PENDING
        );
        let next = registry.reserve(2, binding()).unwrap();
        assert!(next.prepare().is_err());
        let mut other_binding = binding();
        other_binding.host = "other.example".into();
        let other = registry.reserve(3, other_binding).unwrap();
        other.prepare().unwrap();
        captured.child.lock().unwrap().as_mut().unwrap().kill_fails = false;
        next.prepare().unwrap();
        assert!(!registry.owners.lock().unwrap().contains_key(&1));
        assert!(!other.owner.retired.load(Ordering::Acquire));
    }

    #[test]
    fn confirmed_child_exit_does_not_acknowledge_a_held_reader() {
        let registry = registry();
        let permit = registry.reserve(1, binding()).unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        permit.owner.workers.lock().unwrap().push(OwnedIo {
            stream: 1,
            handle: std::thread::spawn(move || {
                receiver.recv().unwrap();
                Ok(Vec::new())
            }),
        });
        let mut child = process();
        child.terminal = true;
        *permit.owner.child.lock().unwrap() = Some(child);
        permit.owner.retire();
        permit.owner.running.store(false, Ordering::Release);
        assert!(permit.owner.cleanup(Instant::now()).is_err());
        assert_eq!(permit.owner.workers.lock().unwrap().len(), 1);
        sender.send(()).unwrap();
        permit
            .owner
            .cleanup(Instant::now() + Duration::from_secs(1))
            .unwrap();
        assert!(permit.owner.workers.lock().unwrap().is_empty());
    }

    #[test]
    fn eof_never_substitutes_for_process_terminal_evidence() {
        for failure in 0..3 {
            let registry = registry();
            let permit = registry.reserve(1, binding()).unwrap();
            let mut child = process();
            child.kill_fails = failure == 0;
            child.inspect_fails = failure == 1;
            child.ignore_kill = failure == 2;
            *permit.owner.child.lock().unwrap() = Some(child);
            permit.owner.running.store(false, Ordering::Release);
            permit.owner.retire();
            assert!(permit.owner.cleanup(Instant::now()).is_err());
            assert!(permit.owner.child.lock().unwrap().is_some());
        }
    }

    #[test]
    fn running_operation_prevents_empty_ack_and_late_publication() {
        let registry = registry();
        let permit = registry.reserve(1, binding()).unwrap();
        permit.owner.retire();
        assert!(permit.owner.cleanup(Instant::now()).is_err());
        assert!(permit.prepare().is_err());
        permit.owner.published.store(true, Ordering::Release);
        assert!(permit.finish(Ok(())).is_err());
    }

    #[test]
    fn normal_failure_survives_confirmed_cleanup() {
        let registry = registry();
        let permit = registry.reserve(1, binding()).unwrap();
        *permit.owner.child.lock().unwrap() = Some(process());
        assert_eq!(
            permit
                .finish::<()>(Err("ordinary failure".into()))
                .unwrap_err(),
            "ordinary failure"
        );
        assert!(registry.owners.lock().unwrap().is_empty());
    }

    #[test]
    fn removal_uses_exact_object_not_reused_numeric_id() {
        let registry = registry();
        let first = registry.reserve(1, binding()).unwrap();
        registry.owners.lock().unwrap().remove(&1);
        let second = registry.reserve(1, binding()).unwrap();
        registry.remove(&first.owner);
        assert!(Arc::ptr_eq(
            &registry.owners.lock().unwrap()[&1],
            &second.owner
        ));
    }

    #[test]
    fn poisoned_registry_rejects_admission_but_retains_cleanup_owner() {
        let registry = registry();
        let permit = registry.reserve(1, binding()).unwrap();
        let poisoned = registry.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoned.owners.lock().unwrap();
            panic!("poison fixture");
        })
        .join();
        assert!(registry.reserve(2, binding()).is_err());
        assert_eq!(
            permit
                .finish::<()>(Err("ordinary failure".into()))
                .unwrap_err(),
            "ordinary failure"
        );
        assert!(registry
            .owners
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_empty());
    }

    #[test]
    fn full_retiring_budget_can_make_progress_before_new_admission() {
        let registry = registry();
        let mut captured = Vec::new();
        for id in 1..=256 {
            let mut key = binding();
            key.host = format!("fixture-{id}");
            let permit = registry.reserve(id, key).unwrap();
            let mut child = process();
            child.kill_fails = true;
            *permit.owner.child.lock().unwrap() = Some(child);
            captured.push(permit.owner.clone());
            assert_eq!(
                permit
                    .finish::<()>(Err("startup failure".into()))
                    .unwrap_err(),
                CLEANUP_PENDING
            );
        }
        assert_eq!(registry.owners.lock().unwrap().len(), 256);
        for owner in captured {
            owner.child.lock().unwrap().as_mut().unwrap().terminal = true;
        }
        let admitted = registry.reserve(257, binding()).unwrap();
        assert_eq!(registry.owners.lock().unwrap().len(), 1);
        assert!(!admitted.owner.retired.load(Ordering::Acquire));
    }

    #[test]
    fn worker_creation_failure_retains_partial_child_and_prior_reader() {
        for failed_stream in [0, 3, 4] {
            let registry = registry();
            let permit = registry.reserve(1, binding()).unwrap();
            let owner = permit.owner.clone();
            let mut child = process();
            child.kill_fails = true;
            *owner.child.lock().unwrap() = Some(child);
            let (sender, receiver) = std::sync::mpsc::channel();
            owner
                .spawn_worker("held-reader-fixture", 1, move || {
                    receiver.recv().unwrap();
                    Ok(Vec::new())
                })
                .unwrap();
            let error = owner
                .retain_worker(Err(std::io::Error::other("private detail")), failed_stream)
                .unwrap_err();
            assert_eq!(
                permit.finish::<()>(Err(error)).unwrap_err(),
                CLEANUP_PENDING
            );
            assert!(Arc::ptr_eq(&registry.owners.lock().unwrap()[&1], &owner));
            assert_eq!(owner.workers.lock().unwrap().len(), 1);
            owner.child.lock().unwrap().as_mut().unwrap().kill_fails = false;
            sender.send(()).unwrap();
            owner
                .cleanup(Instant::now() + Duration::from_secs(1))
                .unwrap();
            registry.remove(&owner);
            assert!(registry.owners.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn handshake_and_metadata_rejections_retain_unknown_rollback() {
        for phase in [
            "handshake transport",
            "handshake rejected",
            "malformed metadata",
            "reader unavailable",
        ] {
            let registry = registry();
            let permit = registry.reserve(1, binding()).unwrap();
            let owner = permit.owner.clone();
            let mut child = process();
            child.kill_fails = true;
            *owner.child.lock().unwrap() = Some(child);
            assert_eq!(
                permit.finish::<()>(Err(phase.into())).unwrap_err(),
                CLEANUP_PENDING
            );
            let next = registry.reserve(2, binding()).unwrap();
            assert!(next.prepare().is_err());
            owner.child.lock().unwrap().as_mut().unwrap().terminal = true;
            next.prepare().unwrap();
        }
    }

    #[test]
    fn ready_sibling_is_never_swept_by_matching_retired_retry() {
        let registry = registry();
        let ready = registry.reserve(1, binding()).unwrap();
        let ready_owner = ready.owner.clone();
        *ready_owner.child.lock().unwrap() = Some(process());
        ready_owner.published.store(true, Ordering::Release);
        ready.finish(Ok(())).unwrap();
        let failed = registry.reserve(2, binding()).unwrap();
        let captured = failed.owner.clone();
        let mut child = process();
        child.kill_fails = true;
        *captured.child.lock().unwrap() = Some(child);
        assert!(failed.finish::<()>(Err("failed installer".into())).is_err());
        captured.child.lock().unwrap().as_mut().unwrap().terminal = true;
        registry.retry_binding(&binding(), Instant::now()).unwrap();
        assert!(Arc::ptr_eq(
            &registry.owners.lock().unwrap()[&1],
            &ready_owner
        ));
        assert!(!ready_owner.retired.load(Ordering::Acquire));
        assert!(!ready_owner.child.lock().unwrap().as_ref().unwrap().terminal);
    }

    #[test]
    fn held_askpass_worker_keeps_terminal_child_and_quota_until_bridge_ack() {
        let registry = registry();
        let permit = registry.reserve(1, binding()).unwrap();
        let owner = permit.owner.clone();
        let mut child = process();
        child.terminal = true;
        *owner.child.lock().unwrap() = Some(child);
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            receiver.recv().unwrap();
        });
        let bridge = Arc::new(super::super::Askpass::with_worker_for_test(worker));
        *owner.askpass.lock().unwrap() = Some(bridge.clone());
        owner.retire();
        owner.running.store(false, Ordering::Release);
        assert!(owner
            .cleanup(Instant::now() + Duration::from_millis(20))
            .is_err());
        assert!(owner.child.lock().unwrap().is_some());
        assert!(owner.askpass.lock().unwrap().is_some());
        assert_eq!(registry.owners.lock().unwrap().len(), 1);
        sender.send(()).unwrap();
        owner
            .cleanup(Instant::now() + Duration::from_secs(1))
            .unwrap();
        registry.remove(&owner);
        assert!(registry.owners.lock().unwrap().is_empty());
        assert_eq!(bridge.close_with_timeout(Duration::ZERO), Ok(()));
    }

    #[test]
    fn completed_worker_errors_do_not_prevent_stage_resource_ack() {
        for panic_worker in [false, true] {
            let registry = registry();
            let permit = registry.reserve(1, binding()).unwrap();
            let mut child = process();
            child.terminal = true;
            *permit.owner.child.lock().unwrap() = Some(child);
            permit
                .owner
                .spawn_worker("finished-error-fixture", 1, move || {
                    if panic_worker {
                        panic!("fixture worker failure");
                    }
                    Err("output delivery failed".to_string())
                })
                .unwrap();
            permit
                .owner
                .rollback_stage(Instant::now() + Duration::from_secs(1))
                .unwrap();
            assert!(permit.owner.child.lock().unwrap().is_none());
            assert_eq!(
                permit
                    .finish::<()>(Err("original operation error".into()))
                    .unwrap_err(),
                "original operation error"
            );
            assert!(registry.owners.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn cleanup_rechecks_assets_installed_before_operation_settlement() {
        let registry = registry();
        let permit = registry.reserve(1, binding()).unwrap();
        let owner = permit.owner.clone();
        owner.retire();
        owner
            .spawn_worker("settlement-marker", 1, || Ok(Vec::new()))
            .unwrap();
        let (io_sender, io_receiver) = std::sync::mpsc::channel();
        owner
            .spawn_worker("held-owned-io", 2, move || {
                io_receiver.recv().unwrap();
                Ok(Vec::new())
            })
            .unwrap();
        let closer_owner = owner.clone();
        let closer_registry = registry.clone();
        let closer = std::thread::spawn(move || {
            let result = closer_owner.cleanup(Instant::now() + Duration::from_secs(2));
            if result.is_ok() {
                closer_registry.remove(&closer_owner);
            }
            result
        });
        let checkpoint = Instant::now() + Duration::from_secs(1);
        while owner.workers.lock().unwrap().len() != 1 {
            assert!(
                Instant::now() < checkpoint,
                "cleanup must reach its owned I/O phase"
            );
            std::thread::yield_now();
        }
        let mut child = process();
        child.kill_fails = true;
        *owner.child.lock().unwrap() = Some(child);
        let (bridge_sender, bridge_receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            bridge_receiver.recv().unwrap();
        });
        let bridge = Arc::new(super::super::Askpass::with_worker_for_test(worker));
        *owner.askpass.lock().unwrap() = Some(bridge.clone());
        owner.running.store(false, Ordering::Release);
        io_sender.send(()).unwrap();
        let result = closer.join().unwrap();
        let bridge_stopped = bridge.is_stopped_for_test();
        let retained_child = owner.child.lock().unwrap().is_some();
        let retained_bridge = owner.askpass.lock().unwrap().is_some();
        let retained_slot = registry.owners.lock().unwrap().contains_key(&1);
        bridge_sender.send(()).unwrap();
        bridge.close_with_timeout(Duration::from_secs(1)).unwrap();
        if let Some(child) = owner.child.lock().unwrap().as_mut() {
            child.terminal = true;
        }
        owner
            .cleanup(Instant::now() + Duration::from_secs(1))
            .unwrap();
        registry.remove(&owner);
        drop(permit);
        assert!(
            result.is_err(),
            "cleanup must not acknowledge newly installed resources using stale snapshots"
        );
        assert!(retained_child && retained_bridge && retained_slot);
        assert!(
            bridge_stopped,
            "bridge stop must precede a fallible child stop"
        );
    }

    #[test]
    fn buffered_input_disposal_does_not_flush_a_blocked_writer() {
        use std::io::Write;
        struct BlockedWriter {
            writes: Arc<AtomicBool>,
            release: std::sync::mpsc::Receiver<()>,
        }
        impl Write for BlockedWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.writes.store(true, Ordering::Release);
                self.release.recv().unwrap();
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let writes = Arc::new(AtomicBool::new(false));
        let observed = writes.clone();
        let (release, receiver) = std::sync::mpsc::channel();
        let (done, finished) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let mut writer = std::io::BufWriter::with_capacity(
                32,
                BlockedWriter {
                    writes,
                    release: receiver,
                },
            );
            writer.write_all(b"buffered input").unwrap();
            discard_buffered_input(writer);
            done.send(()).unwrap();
        });
        let completed = finished.recv_timeout(Duration::from_millis(100));
        let _ = release.send(());
        worker.join().unwrap();
        assert!(completed.is_ok());
        assert!(!observed.load(Ordering::Acquire));
    }

    #[test]
    fn auth_binding_normalizes_host_case_but_not_credentials_or_zone_case() {
        let base = super::super::tests::connection();
        let key = AuthBinding::new(&base).unwrap();
        let mut changed = base.clone();
        changed.host = changed.host.to_ascii_uppercase();
        assert!(key == AuthBinding::new(&changed).unwrap());
        let mut padded = base.clone();
        padded.host = format!(" {} ", padded.host);
        assert!(AuthBinding::new(&padded).is_err());
        padded.host = padded.host.trim().to_string();
        assert!(key == AuthBinding::new(&padded).unwrap());
        for changed in [
            {
                let mut value = base.clone();
                value.port = Some(2223);
                value
            },
            {
                let mut value = base.clone();
                value.user = Some("other-user".into());
                value
            },
            {
                let mut value = base.clone();
                value.identity_file = Some("other-key".into());
                value
            },
            {
                let mut value = base.clone();
                value.extra_args = Some("-o ServerAliveInterval=30".into());
                value
            },
        ] {
            assert!(key != AuthBinding::new(&changed).unwrap());
        }
        let mut upper_user = base.clone();
        upper_user.user = Some("CaseUser".into());
        let mut lower_user = upper_user.clone();
        lower_user.user = Some("caseuser".into());
        assert!(AuthBinding::new(&upper_user).unwrap() != AuthBinding::new(&lower_user).unwrap());
        let mut upper_zone = base.clone();
        upper_zone.host = "FE80::1%Eth0".into();
        let mut lower_zone = upper_zone.clone();
        lower_zone.host = "fe80::1%eth0".into();
        assert!(AuthBinding::new(&upper_zone).unwrap() != AuthBinding::new(&lower_zone).unwrap());
        lower_zone.host = "fe80::1%Eth0".into();
        assert!(AuthBinding::new(&upper_zone).unwrap() == AuthBinding::new(&lower_zone).unwrap());
    }

    #[test]
    fn auth_binding_ignores_roots_initial_directory_and_multiplexers() {
        let connection = RemoteSshConnection {
            host: "server.example".into(),
            user: None,
            port: None,
            identity_file: Some("  key  ".into()),
            extra_args: Some("  -o   ConnectTimeout=5  ".into()),
            initial_directory: Some("/project".into()),
            multiplexer_mode: None,
            tmux_session_name: None,
            active_multiplexer_session: None,
            multiplexer_action: None,
        };
        let mut other = connection.clone();
        other.port = Some(22);
        other.user = Some(String::new());
        other.identity_file = Some("key".into());
        other.extra_args = Some("-o ConnectTimeout=5".into());
        other.initial_directory = Some(".".into());
        other.multiplexer_mode = Some("tmux".into());
        assert!(AuthBinding::new(&connection).unwrap() == AuthBinding::new(&other).unwrap());
        other.host = "other.example".into();
        assert!(AuthBinding::new(&connection).unwrap() != AuthBinding::new(&other).unwrap());
    }
}
