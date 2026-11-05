#![cfg(any(target_os = "linux", windows))]

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use voktty_memory_local::{
    DiscoveryControl, MemoryReadAccess, MemoryWriteAccess, OwnedProjectInitializationPreview,
    OwnedProjectRecoveryPreview, ProjectInitializationRequest, ProjectRecoveryRequest,
    PublicationError, ReadError, PROJECT_INITIALIZATION_RECORD,
};
use voktty_workspace_kit::{DeploymentAction, PreparedDeployment, RootLinks};

static SERIAL: Mutex<()> = Mutex::new(());

struct Access {
    root: PathBuf,
    live: AtomicBool,
    fail_at: Mutex<Option<String>>,
    fail_after: Mutex<Option<String>>,
    cleanup: AtomicBool,
    probe: AtomicBool,
    saw_busy: AtomicBool,
}
impl MemoryReadAccess for Access {
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.live.load(Ordering::Acquire) && path.starts_with(&self.root)
    }
    fn allows_metadata(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
}
impl MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        if self.root.join(PROJECT_INITIALIZATION_RECORD).exists() {
            if path.ends_with("RULES.md") && self.probe.swap(false, Ordering::AcqRel) {
                let authority = access(&self.root);
                self.saw_busy.store(
                    matches!(
                        recover(&authority),
                        Err(PublicationError::Read(ReadError::Busy))
                    ),
                    Ordering::Release,
                );
            }
            if self
                .fail_at
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|relative| path == self.root.join(relative))
                && self
                    .fail_after
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_none_or(|relative| self.root.join(relative).exists())
            {
                return false;
            }
        }
        self.allows_workspace_root(path)
    }
    fn allows_replace(&self, path: &Path) -> bool {
        self.allows_create(path)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
            && (self.cleanup.load(Ordering::Acquire)
                || path != self.root.join(PROJECT_INITIALIZATION_RECORD)
                || !self.root.join(".voktty/kit.json").exists())
    }
}
fn access(root: &Path) -> Arc<Access> {
    Arc::new(Access {
        root: fs::canonicalize(root).unwrap(),
        live: AtomicBool::new(true),
        fail_at: Mutex::new(None),
        fail_after: Mutex::new(None),
        cleanup: AtomicBool::new(true),
        probe: AtomicBool::new(false),
        saw_busy: AtomicBool::new(false),
    })
}
fn initialize(authority: &Arc<Access>) -> OwnedProjectInitializationPreview {
    OwnedProjectInitializationPreview::prepare_at_project_root(
        ProjectInitializationRequest {
            origin: authority.root.clone(),
            origin_access: authority.clone(),
            destination: authority.root.clone(),
            destination_access: authority.clone(),
            inputs: json!({"project_name":"Recovery project","created_at":"2026-11-05"})
                .as_object()
                .unwrap()
                .clone(),
            links: RootLinks {
                agents: true,
                claude: true,
            },
        },
        &DiscoveryControl::default(),
    )
    .unwrap()
}
fn recover(authority: &Arc<Access>) -> Result<OwnedProjectRecoveryPreview, PublicationError> {
    OwnedProjectRecoveryPreview::prepare(
        ProjectRecoveryRequest {
            origin: authority.root.clone(),
            origin_access: authority.clone(),
            destination: authority.root.clone(),
            destination_access: authority.clone(),
        },
        &DiscoveryControl::default(),
    )
}
fn interrupt(authority: &Arc<Access>, path: &str) -> PreparedDeployment {
    let review = initialize(authority);
    let plan = review.deployment().clone();
    let digest = review.acceptance_digest();
    *authority.fail_at.lock().unwrap() = Some(path.into());
    assert!(review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .is_err());
    *authority.fail_at.lock().unwrap() = None;
    assert!(authority.root.join(PROJECT_INITIALIZATION_RECORD).is_file());
    plan
}
fn finish(authority: &Arc<Access>) {
    let review = recover(authority).unwrap();
    let digest = review.acceptance_digest();
    review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(!authority.root.join(PROJECT_INITIALIZATION_RECORD).exists());
}
fn record(authority: &Access) -> Value {
    serde_json::from_slice(&fs::read(authority.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap())
        .unwrap()
}
fn backup(authority: &Access, path: &str) -> PathBuf {
    let record = record(authority);
    authority.root.join(
        record["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["path"] == path)
            .unwrap()["backup"]
            .as_str()
            .unwrap(),
    )
}

#[test]
fn interrupted_creation_is_reviewed_and_completed_without_private_storage() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let expected = interrupt(&authority, ".voktty/RULES.md");
    let before = fs::read(authority.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap();
    let review = recover(&authority).unwrap();
    assert_eq!(
        before,
        fs::read(authority.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap()
    );
    assert!(!authority.root.join(".voktty/kit.json").exists());
    assert!(!review
        .deployment()
        .plan
        .entries
        .iter()
        .all(|entry| entry.action == DeploymentAction::Skip));
    assert!(review.restorations().is_empty());
    let digest = review.acceptance_digest();
    review.revalidate(&DiscoveryControl::default()).unwrap();
    let report = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(report
        .cleaned
        .contains(&PROJECT_INITIALIZATION_RECORD.to_owned()));
    for entry in expected.plan.entries {
        assert_eq!(
            fs::read_to_string(authority.root.join(entry.path)).unwrap(),
            entry.proposed
        );
    }
    assert!(initialize(&authority)
        .deployment()
        .plan
        .entries
        .iter()
        .all(|entry| entry.action == DeploymentAction::Skip));
}

#[test]
fn completed_publication_requires_review_before_only_its_record_is_cleaned() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let review = initialize(&authority);
    let digest = review.acceptance_digest();
    authority.cleanup.store(false, Ordering::Release);
    assert!(review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .is_err());
    authority.cleanup.store(true, Ordering::Release);
    let review = recover(&authority).unwrap();
    assert!(review
        .deployment()
        .plan
        .entries
        .iter()
        .all(|entry| entry.action == DeploymentAction::Skip));
    let digest = review.acceptance_digest();
    let report = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(report.created.is_empty() && report.migrated.is_empty());
    assert_eq!(report.cleaned, [PROJECT_INITIALIZATION_RECORD]);
}

#[test]
fn changed_content_and_reserved_sessions_survive_recovery() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    interrupt(&authority, ".voktty/RULES.md");
    fs::write(
        authority.root.join(".voktty/CONTEXT.md"),
        "New user context after interruption",
    )
    .unwrap();
    fs::create_dir_all(authority.root.join(".voktty/sessions")).unwrap();
    fs::write(
        authority.root.join(".voktty/sessions/current.json"),
        "session",
    )
    .unwrap();
    finish(&authority);
    assert_eq!(
        fs::read_to_string(authority.root.join(".voktty/CONTEXT.md")).unwrap(),
        "New user context after interruption"
    );
    assert_eq!(
        fs::read_to_string(authority.root.join(".voktty/sessions/current.json")).unwrap(),
        "session"
    );
}

fn original_rules(authority: &Access) {
    fs::create_dir_all(authority.root.join(".voktty/sessions")).unwrap();
    fs::write(authority.root.join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(authority.root.join("AGENTS.md"), "Owner agent rules\n").unwrap();
    fs::write(authority.root.join("CLAUDE.md"), "Owner Claude rules\n").unwrap();
}

#[test]
fn completed_and_pending_rule_migrations_retain_original_rules() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    original_rules(&authority);
    let expected = interrupt(&authority, "CLAUDE.md");
    assert_eq!(
        fs::read_to_string(backup(&authority, "AGENTS.md")).unwrap(),
        "Owner agent rules\n"
    );
    finish(&authority);
    for entry in expected.plan.entries {
        assert_eq!(
            fs::read_to_string(authority.root.join(entry.path)).unwrap(),
            entry.proposed
        );
    }
    assert!(fs::read_dir(authority.root.join(".voktty"))
        .unwrap()
        .all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".voktty-migration-")));
}

#[test]
fn missing_rule_target_is_restored_before_migration_and_keeps_its_metadata() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    original_rules(&authority);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            authority.root.join("AGENTS.md"),
            fs::Permissions::from_mode(0o640),
        )
        .unwrap();
    }
    let expected = interrupt(&authority, "CLAUDE.md");
    fs::remove_file(authority.root.join("AGENTS.md")).unwrap();
    let review = recover(&authority).unwrap();
    assert_eq!(review.restorations().len(), 1);
    assert_eq!(review.restorations()[0].text, "Owner agent rules\n");
    let digest = review.acceptance_digest();
    review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert_eq!(
        fs::read_to_string(authority.root.join("AGENTS.md")).unwrap(),
        expected
            .plan
            .entries
            .iter()
            .find(|entry| entry.path == "AGENTS.md")
            .unwrap()
            .proposed
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(authority.root.join("AGENTS.md"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
    }
}

#[test]
fn recognized_pre_exchange_proposal_can_be_removed_without_losing_the_original() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    original_rules(&authority);
    let expected = interrupt(&authority, "AGENTS.md");
    let proposal = &expected
        .plan
        .entries
        .iter()
        .find(|entry| entry.path == "AGENTS.md")
        .unwrap()
        .proposed;
    fs::write(backup(&authority, "AGENTS.md"), proposal).unwrap();
    finish(&authority);
    assert_eq!(
        fs::read_to_string(authority.root.join("AGENTS.md")).unwrap(),
        *proposal
    );
}

#[test]
fn live_publication_cannot_be_recovered_reentrantly() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    authority.probe.store(true, Ordering::Release);
    let review = initialize(&authority);
    let digest = review.acceptance_digest();
    review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(authority.saw_busy.load(Ordering::Acquire));
}

#[test]
fn stale_snapshot_wrong_digest_denied_writes_and_cancellation_never_remove_the_record() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    interrupt(&authority, ".voktty/RULES.md");
    let before = fs::read(authority.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap();
    let review = recover(&authority).unwrap();
    assert_eq!(
        review
            .publish("wrong", authority.as_ref(), &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::StalePreview
    );
    let review = recover(&authority).unwrap();
    let digest = review.acceptance_digest();
    fs::write(
        authority.root.join(".voktty/CONTEXT.md"),
        "concurrent content",
    )
    .unwrap();
    assert_eq!(
        review
            .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::StalePreview
    );
    let review = recover(&authority).unwrap();
    let digest = review.acceptance_digest();
    let control = DiscoveryControl::default();
    control.cancel();
    assert_eq!(
        review
            .publish(&digest, authority.as_ref(), &control)
            .unwrap_err()
            .error,
        PublicationError::Read(ReadError::Cancelled)
    );
    let review = recover(&authority).unwrap();
    let digest = review.acceptance_digest();
    authority.live.store(false, Ordering::Release);
    assert_eq!(
        review
            .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::Read(ReadError::Denied)
    );
    authority.live.store(true, Ordering::Release);
    struct NoWrites;
    impl MemoryWriteAccess for NoWrites {
        fn allows_create(&self, _: &Path) -> bool {
            false
        }
    }
    let review = recover(&authority).unwrap();
    let digest = review.acceptance_digest();
    assert_eq!(
        review
            .publish(&digest, &NoWrites, &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::Read(ReadError::Denied)
    );
    assert_eq!(
        before,
        fs::read(authority.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap()
    );
    assert!(!authority.root.join(".voktty/kit.json").exists());
}

#[test]
fn changed_rules_unknown_artifacts_and_unknown_backup_bytes_are_preserved() {
    let _serial = SERIAL.lock().unwrap();
    for kind in ["rule", "artifact", "backup"] {
        let project = tempfile::tempdir().unwrap();
        let authority = access(project.path());
        original_rules(&authority);
        interrupt(&authority, "CLAUDE.md");
        let path = match kind {
            "rule" => authority.root.join("AGENTS.md"),
            "backup" => backup(&authority, "AGENTS.md"),
            _ => authority.root.join(".voktty/.voktty-stage-unknown"),
        };
        fs::write(&path, "foreign bytes").unwrap();
        assert!(recover(&authority).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "foreign bytes");
        assert!(authority.root.join(PROJECT_INITIALIZATION_RECORD).exists());
    }
}

#[test]
fn malformed_legacy_foreign_and_forged_records_grant_no_recovery() {
    let _serial = SERIAL.lock().unwrap();
    for kind in [
        "legacy",
        "activity",
        "schema",
        "scope",
        "uuid",
        "path",
        "duplicate",
        "hash",
        "backup",
        "version",
        "extra",
        "binding",
    ] {
        let project = tempfile::tempdir().unwrap();
        let authority = access(project.path());
        interrupt(&authority, ".voktty/RULES.md");
        let mut value = record(&authority);
        match kind {
            "legacy" => {
                value.as_object_mut().unwrap().remove("template");
            }
            "activity" => value["activityLock"] = "none".into(),
            "schema" => value["schema"] = 3.into(),
            "scope" => value["scope"] = "anything".into(),
            "uuid" => value["transaction"] = "not-uuid".into(),
            "path" => value["files"][0]["path"] = "../outside".into(),
            "duplicate" => value["files"][1] = value["files"][0].clone(),
            "hash" => value["files"][0]["proposed"] = "0".repeat(64).into(),
            "backup" => value["files"][0]["backup"] = "../outside".into(),
            "version" => value["template"]["version"] = "0.0.0".into(),
            "extra" => value["unknown"] = true.into(),
            _ => value["destinationBinding"] = "0".repeat(64).into(),
        }
        let text = value.to_string();
        fs::write(authority.root.join(PROJECT_INITIALIZATION_RECORD), &text).unwrap();
        assert!(recover(&authority).is_err(), "accepted {kind}");
        assert_eq!(
            fs::read_to_string(authority.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap(),
            text
        );
        assert!(!authority.root.join(".voktty/kit.json").exists());
    }
}

#[cfg(unix)]
#[test]
fn replacing_the_project_or_using_symlinked_artifacts_cannot_redirect_recovery() {
    let _serial = SERIAL.lock().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("project");
    fs::create_dir(&root).unwrap();
    let authority = access(&root);
    interrupt(&authority, ".voktty/RULES.md");
    let review = recover(&authority).unwrap();
    let digest = review.acceptance_digest();
    let retained = parent.path().join("retained");
    fs::rename(&root, &retained).unwrap();
    fs::create_dir(&root).unwrap();
    assert!(review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .is_err());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    assert!(retained.join(PROJECT_INITIALIZATION_RECORD).exists());
    fs::remove_dir(&root).unwrap();
    std::os::unix::fs::symlink(&retained, &root).unwrap();
    assert!(recover(&authority).is_err());
}

#[test]
fn child_holds_project_record() {
    let Some(path) = std::env::var_os("VOKTTY_RECOVERY_LOCK_TEST") else {
        return;
    };
    let file = std::fs::File::open(path).unwrap();
    file.try_lock().unwrap();
    use std::io::{Read, Write};
    println!("project-record-locked");
    std::io::stdout().flush().unwrap();
    let mut byte = [0u8];
    assert_eq!(std::io::stdin().read(&mut byte).unwrap(), 0);
    drop(file);
}

#[test]
fn a_separate_process_lock_blocks_recovery_until_the_process_exits() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    interrupt(&authority, ".voktty/RULES.md");
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    struct Child(std::process::Child);
    impl Drop for Child {
        fn drop(&mut self) {
            drop(self.0.stdin.take());
            let _ = self.0.wait();
        }
    }
    let mut child = Child(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "child_holds_project_record", "--nocapture"])
            .env(
                "VOKTTY_RECOVERY_LOCK_TEST",
                authority.root.join(PROJECT_INITIALIZATION_RECORD),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let mut output = BufReader::new(child.0.stdout.take().unwrap());
    let mut line = String::new();
    loop {
        assert_ne!(output.read_line(&mut line).unwrap(), 0);
        if line.contains("project-record-locked") {
            break;
        }
        line.clear();
    }
    assert!(matches!(
        recover(&authority),
        Err(PublicationError::Read(ReadError::Busy))
    ));
    drop(child.0.stdin.take());
    assert!(child.0.wait().unwrap().success());
    finish(&authority);
}

#[test]
fn resolved_recovery_preserves_scope_checks_and_refuses_a_late_nested_operation() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    struct Ancestors(Arc<Access>);
    impl MemoryReadAccess for Ancestors {
        fn allows_metadata(&self, path: &Path) -> bool {
            path.starts_with(&self.0.root)
                || self
                    .0
                    .root
                    .ancestors()
                    .any(|ancestor| path == ancestor || path.starts_with(ancestor.join(".voktty")))
        }
        fn allows_workspace_root(&self, path: &Path) -> bool {
            self.0.allows_workspace_root(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            self.allows_metadata(path)
        }
        fn allows_enumeration(&self, path: &Path) -> bool {
            self.allows_metadata(path)
        }
    }
    let reads = Arc::new(Ancestors(authority.clone()));
    let review = OwnedProjectInitializationPreview::prepare(
        ProjectInitializationRequest {
            origin: authority.root.clone(),
            origin_access: reads.clone(),
            destination: authority.root.clone(),
            destination_access: reads.clone(),
            inputs: json!({"project_name":"Scoped recovery","created_at":"2026-11-05"})
                .as_object()
                .unwrap()
                .clone(),
            links: RootLinks {
                agents: true,
                claude: true,
            },
        },
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    *authority.fail_at.lock().unwrap() = Some(".voktty/RULES.md".into());
    assert!(review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .is_err());
    *authority.fail_at.lock().unwrap() = None;
    let prepare = || {
        OwnedProjectRecoveryPreview::prepare(
            ProjectRecoveryRequest {
                origin: authority.root.clone(),
                origin_access: reads.clone(),
                destination: authority.root.clone(),
                destination_access: reads.clone(),
            },
            &DiscoveryControl::default(),
        )
    };
    let review = prepare().unwrap();
    let digest = review.acceptance_digest();
    fs::create_dir_all(authority.root.join("nested/.voktty")).unwrap();
    fs::write(
        authority.root.join("nested/.voktty/.initialization.json"),
        "foreign operation",
    )
    .unwrap();
    assert_eq!(
        review
            .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::Scope
    );
    assert!(!authority.root.join(".voktty/kit.json").exists());
    fs::remove_dir_all(authority.root.join("nested")).unwrap();
    let review = prepare().unwrap();
    let digest = review.acceptance_digest();
    review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(!authority.root.join(PROJECT_INITIALIZATION_RECORD).exists());
}

#[test]
fn a_second_interruption_keeps_a_recoverable_record_and_a_second_review_cannot_replay() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    interrupt(&authority, ".voktty/RULES.md");
    let review = recover(&authority).unwrap();
    let digest = review.acceptance_digest();
    *authority.fail_at.lock().unwrap() = Some(".voktty/PROJECT.md".into());
    *authority.fail_after.lock().unwrap() = Some(".voktty/RULES.md".into());
    let failure = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert!(failure.created.contains(&".voktty/RULES.md".to_owned()));
    *authority.fail_at.lock().unwrap() = None;
    *authority.fail_after.lock().unwrap() = None;
    assert!(authority.root.join(PROJECT_INITIALIZATION_RECORD).exists());
    let stale = recover(&authority).unwrap();
    let digest = stale.acceptance_digest();
    finish(&authority);
    let context = fs::read(authority.root.join(".voktty/CONTEXT.md")).unwrap();
    assert!(stale
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .is_err());
    assert_eq!(
        context,
        fs::read(authority.root.join(".voktty/CONTEXT.md")).unwrap()
    );
}

#[cfg(unix)]
#[test]
fn linked_or_oversized_records_are_never_read_as_recovery_authority() {
    let _serial = SERIAL.lock().unwrap();
    for kind in ["symlink", "hardlink", "oversized"] {
        let project = tempfile::tempdir().unwrap();
        let authority = access(project.path());
        interrupt(&authority, ".voktty/RULES.md");
        let path = authority.root.join(PROJECT_INITIALIZATION_RECORD);
        match kind {
            "symlink" => {
                fs::remove_file(&path).unwrap();
                let secret = authority.root.join(".env");
                fs::write(&secret, "private sentinel").unwrap();
                std::os::unix::fs::symlink(secret, &path).unwrap();
            }
            "hardlink" => fs::hard_link(&path, authority.root.join("retained-record")).unwrap(),
            _ => fs::write(&path, "x".repeat(256 * 1024 + 1)).unwrap(),
        }
        assert!(recover(&authority).is_err());
        assert!(fs::symlink_metadata(path).is_ok());
        assert!(!authority.root.join(".voktty/kit.json").exists());
    }
}
