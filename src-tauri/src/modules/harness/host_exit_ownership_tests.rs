use super::*;

fn inert_child(pid: u32) -> Arc<LiveChild> {
    assert!(pid <= 1);
    Arc::new(LiveChild {
        stdin: Mutex::new(None),
        pid,
        account: None,
        _askpass: None,
        remote: None,
        local_wait: None,
    })
}

fn install(host: &HarnessHost, id: &str, pid: u32) -> (u64, Arc<LiveChild>) {
    let (epoch, generation, _) = host.begin_spawn(id);
    let live = inert_child(pid);
    assert!(host
        .install_spawn(id.into(), epoch, generation, Arc::clone(&live))
        .is_none());
    (epoch, live)
}

fn proxy(host: &HarnessHost, id: &str, epoch: u64) {
    let generation = host.kill_all_gen.load(Ordering::SeqCst);
    let proxy = net_proxy::start(Vec::new()).expect("start proxy");
    assert!(host.install_proxy(id, epoch, generation, proxy).is_none());
}

fn complete(host: &HarnessHost, id: &str, epoch: u64, pid: u32) -> Option<Arc<LiveChild>> {
    host.remove_if_spawn(id, epoch, pid)
}

#[test]
fn old_same_pid_completion_preserves_replacement_child_epoch_and_proxy() {
    let host = HarnessHost::new();
    let (old_epoch, _) = install(&host, "actor", 0);
    let (new_epoch, replacement) = install(&host, "actor", 0);
    proxy(&host, "actor", new_epoch);
    assert!(complete(&host, "actor", old_epoch, 0).is_none());
    assert!(Arc::ptr_eq(&host.get("actor").unwrap(), &replacement));
    assert_eq!(host.lock_inner().epochs.get("actor"), Some(&new_epoch));
    assert!(host.has_proxy("actor"));
}

#[test]
fn retired_epoch_cannot_remove_recreated_same_pid() {
    let host = HarnessHost::new();
    let (old_epoch, _) = install(&host, "actor", 0);
    host.kill_session("actor");
    let (new_epoch, replacement) = install(&host, "actor", 0);
    assert_ne!(old_epoch, new_epoch);
    assert!(complete(&host, "actor", old_epoch, 0).is_none());
    assert!(Arc::ptr_eq(&host.get("actor").unwrap(), &replacement));
}

#[test]
fn global_retirement_cannot_remove_post_generation_same_pid_spawn() {
    let host = HarnessHost::new();
    let (old_epoch, _) = install(&host, "actor", 0);
    host.kill_all();
    let (new_epoch, replacement) = install(&host, "actor", 0);
    assert!(complete(&host, "actor", old_epoch, 0).is_none());
    assert!(Arc::ptr_eq(&host.get("actor").unwrap(), &replacement));
    assert_eq!(host.lock_inner().epochs.get("actor"), Some(&new_epoch));
}

#[test]
fn owning_epoch_still_requires_the_original_pid() {
    let host = HarnessHost::new();
    let (epoch, live) = install(&host, "actor", 0);
    proxy(&host, "actor", epoch);
    assert!(complete(&host, "actor", epoch, 1).is_none());
    assert!(Arc::ptr_eq(&host.get("actor").unwrap(), &live));
    assert!(host.has_proxy("actor"));
}

#[test]
fn current_completion_returns_exact_child_and_reclaims_epoch_and_proxy() {
    let host = HarnessHost::new();
    let (epoch, live) = install(&host, "actor", 0);
    proxy(&host, "actor", epoch);
    let removed = complete(&host, "actor", epoch, 0).unwrap();
    assert!(Arc::ptr_eq(&removed, &live));
    assert!(host.get("actor").is_none());
    assert!(host.lock_inner().epochs.is_empty());
    assert!(!host.has_proxy("actor"));
    assert!(complete(&host, "actor", epoch, 0).is_none());
}

#[test]
fn epochs_are_not_interchangeable_between_same_pid_siblings() {
    let host = HarnessHost::new();
    let (epoch, _) = install(&host, "actor", 0);
    let (sibling_epoch, sibling) = install(&host, "sibling", 0);
    proxy(&host, "sibling", sibling_epoch);
    assert!(complete(&host, "sibling", epoch, 0).is_none());
    assert!(Arc::ptr_eq(&host.get("sibling").unwrap(), &sibling));
    assert!(complete(&host, "actor", epoch, 0).is_some());
    assert!(host.has_proxy("sibling"));
    assert_eq!(
        host.lock_inner().epochs.get("sibling"),
        Some(&sibling_epoch)
    );
}

#[test]
fn missing_epoch_is_not_completion_authority() {
    let host = HarnessHost::new();
    let (epoch, live) = install(&host, "actor", 0);
    host.lock_inner().epochs.remove("actor");
    assert!(complete(&host, "actor", epoch, 0).is_none());
    assert!(Arc::ptr_eq(&host.get("actor").unwrap(), &live));
}

#[test]
fn current_completion_does_not_accumulate_epoch_history() {
    let host = HarnessHost::new();
    for i in 0..1024 {
        let id = format!("actor-{i}");
        let (epoch, live) = install(&host, &id, 0);
        assert!(Arc::ptr_eq(&complete(&host, &id, epoch, 0).unwrap(), &live));
        assert!(host.lock_inner().epochs.is_empty());
    }
}

#[test]
fn blocked_old_waiter_cannot_retire_an_installed_same_pid_replacement() {
    let host = Arc::new(HarnessHost::new());
    let (old_epoch, _) = install(&host, "actor", 0);
    let (release, blocked) = mpsc::channel();
    let waiter_host = Arc::clone(&host);
    let waiter = thread::spawn(move || {
        blocked.recv().unwrap();
        complete(&waiter_host, "actor", old_epoch, 0)
    });
    let (new_epoch, replacement) = install(&host, "actor", 0);
    release.send(()).unwrap();
    assert!(waiter.join().unwrap().is_none());
    assert!(Arc::ptr_eq(&host.get("actor").unwrap(), &replacement));
    assert_eq!(host.lock_inner().epochs.get("actor"), Some(&new_epoch));
}
