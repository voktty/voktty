#![cfg(any(target_os = "linux", windows))]

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use voktty_memory_local::{
    DiscoveryControl, MemoryReadAccess, MemoryWorkers, MemoryWriteAccess,
    OwnedProjectInitializationPreview, ProjectInitializationRequest, PublicationError, ReadError,
    PROJECT_INITIALIZATION_RECORD,
};
use voktty_workspace_kit::{DeploymentAction, RootLinks};

static SERIAL: Mutex<()> = Mutex::new(());

struct Access {
    requested: PathBuf,
    root: PathBuf,
    live: AtomicBool,
    cleanup: AtomicBool,
    interrupt: AtomicBool,
    stop_after_agents: AtomicBool,
    late_cleanup_denial: AtomicBool,
    introduce_child: AtomicBool,
    reentrant: Mutex<Option<(OwnedProjectInitializationPreview, Arc<Access>)>>,
    saw_busy: AtomicBool,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.live.load(Ordering::Acquire)
            && [&self.requested, &self.root].into_iter().any(|root| {
                path.starts_with(root)
                    || root.ancestors().any(|ancestor| {
                        path == ancestor || path.starts_with(ancestor.join(".voktty"))
                    })
            })
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.live.load(Ordering::Acquire)
            && (path.starts_with(&self.requested) || path.starts_with(&self.root))
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.allows_metadata(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_metadata(path)
    }
}

impl MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        if path.ends_with("RULES.md") && self.root.join(PROJECT_INITIALIZATION_RECORD).exists() {
            let pending = self.reentrant.lock().unwrap().take();
            if let Some((review, access)) = pending {
                let digest = review.acceptance_digest();
                let result = review.publish(&digest, access.as_ref(), &DiscoveryControl::default());
                self.saw_busy.store(matches!(result, Err(error) if error.error == PublicationError::Read(ReadError::Busy)), Ordering::Release);
            }
        }
        if self.introduce_child.load(Ordering::Acquire)
            && path.ends_with("RULES.md")
            && self.root.join(PROJECT_INITIALIZATION_RECORD).exists()
            && self.introduce_child.swap(false, Ordering::AcqRel)
        {
            let nested = self.root.join("nested/.voktty");
            fs::create_dir_all(&nested).unwrap();
            fs::write(nested.join(".initialization.json"), "another operation").unwrap();
        }
        self.allows_workspace_root(path)
            && !(self.interrupt.load(Ordering::Acquire)
                && path.ends_with("RULES.md")
                && self.root.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        self.allows_create(path)
            && !(self.stop_after_agents.load(Ordering::Acquire)
                && path.ends_with("CLAUDE.md")
                && fs::read_to_string(self.root.join("AGENTS.md"))
                    .is_ok_and(|text| text.contains("voktty-workspace-kit:start")))
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
            && self.cleanup.load(Ordering::Acquire)
            && !(self.late_cleanup_denial.load(Ordering::Acquire)
                && path.ends_with(".initialization.json")
                && self.root.join(".voktty/kit.json").exists())
    }
}

fn access(root: &Path) -> Arc<Access> {
    Arc::new(Access {
        requested: root.to_owned(),
        root: fs::canonicalize(root).unwrap(),
        live: AtomicBool::new(true),
        cleanup: AtomicBool::new(true),
        interrupt: AtomicBool::new(false),
        stop_after_agents: AtomicBool::new(false),
        late_cleanup_denial: AtomicBool::new(false),
        introduce_child: AtomicBool::new(false),
        reentrant: Mutex::new(None),
        saw_busy: AtomicBool::new(false),
    })
}

fn prepare(authority: &Arc<Access>, links: RootLinks) -> OwnedProjectInitializationPreview {
    OwnedProjectInitializationPreview::prepare(
        ProjectInitializationRequest {
            origin: authority.requested.clone(),
            origin_access: authority.clone(),
            destination: authority.requested.clone(),
            destination_access: authority.clone(),
            inputs: json!({"project_name":"Native publication","created_at":"2026-11-03"})
                .as_object()
                .unwrap()
                .clone(),
            links,
        },
        &DiscoveryControl::default(),
    )
    .unwrap()
}

#[test]
fn actual_publication_creates_the_exact_kit_and_cleans_its_record_without_private_state() {
    struct Marker<'a> {
        access: &'a Access,
        plan: &'a voktty_workspace_kit::PreparedDeployment,
        observed: AtomicBool,
    }
    impl MemoryWriteAccess for Marker<'_> {
        fn allows_create(&self, path: &Path) -> bool {
            if path == self.access.root.join(".voktty/kit.json")
                && self
                    .access
                    .root
                    .join(PROJECT_INITIALIZATION_RECORD)
                    .exists()
            {
                let ready = self
                    .plan
                    .plan
                    .entries
                    .iter()
                    .filter(|entry| entry.path != ".voktty/kit.json")
                    .all(|entry| {
                        fs::read_to_string(self.access.root.join(&entry.path))
                            .is_ok_and(|text| text == entry.proposed)
                    });
                self.observed.store(ready, Ordering::Release);
                if !ready {
                    return false;
                }
            }
            self.access.allows_create(path)
        }
        fn allows_replace(&self, path: &Path) -> bool {
            self.access.allows_replace(path)
        }
        fn allows_remove_staging(&self, path: &Path) -> bool {
            self.access.allows_remove_staging(path)
        }
    }
    let _serial = SERIAL.lock().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let project = parent.path().join("project");
    fs::create_dir(&project).unwrap();
    let authority = access(&project);
    let review = prepare(&authority, RootLinks::default());
    let plan = review.deployment().clone();
    let digest = review.acceptance_digest();
    let requirements = review.write_requirements();
    assert!(requirements
        .create
        .iter()
        .any(|path| path == PROJECT_INITIALIZATION_RECORD));
    assert!(requirements
        .recovery
        .iter()
        .any(|path| path == PROJECT_INITIALIZATION_RECORD));
    let marker = Marker {
        access: authority.as_ref(),
        plan: &plan,
        observed: AtomicBool::new(false),
    };
    let report = review
        .publish(&digest, &marker, &DiscoveryControl::default())
        .unwrap();
    assert!(marker.observed.load(Ordering::Acquire));
    for entry in plan.plan.entries {
        assert_eq!(
            fs::read_to_string(project.join(&entry.path)).unwrap(),
            entry.proposed
        );
        assert!(report.created.contains(&entry.path));
    }
    assert!(report
        .cleaned
        .iter()
        .any(|path| path == PROJECT_INITIALIZATION_RECORD));
    assert!(!project.join(PROJECT_INITIALIZATION_RECORD).exists());
    assert_eq!(fs::read_dir(parent.path()).unwrap().count(), 1);
    assert!(prepare(&authority, RootLinks::default())
        .deployment()
        .plan
        .entries
        .iter()
        .all(|entry| entry.action == DeploymentAction::Skip));
}

#[test]
fn legacy_ignore_and_rules_migrate_without_touching_sessions_or_retaining_backups_on_success() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir_all(project.path().join(".voktty/sessions")).unwrap();
    fs::write(project.path().join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(
        project.path().join(".voktty/sessions/owner.json"),
        "session bytes",
    )
    .unwrap();
    fs::write(project.path().join("AGENTS.md"), "owner agent rules\n").unwrap();
    fs::write(project.path().join("CLAUDE.md"), "owner claude rules\n").unwrap();
    let authority = access(project.path());
    let review = prepare(
        &authority,
        RootLinks {
            agents: true,
            claude: true,
        },
    );
    let plan = review.deployment().clone();
    let recovery = review.write_requirements().recovery;
    let digest = review.acceptance_digest();
    let report = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.migrated.len(), 3);
    for entry in plan.plan.entries {
        assert_eq!(
            fs::read_to_string(project.path().join(entry.path)).unwrap(),
            entry.proposed
        );
    }
    for path in recovery {
        assert!(!project.path().join(path).exists());
    }
    assert_eq!(
        fs::read_to_string(project.path().join(".voktty/sessions/owner.json")).unwrap(),
        "session bytes"
    );
}

#[test]
fn wrong_digest_and_missing_cleanup_authority_fail_before_creating_anything() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let error = prepare(&authority, RootLinks::default())
        .publish(
            "foreign digest",
            authority.as_ref(),
            &DiscoveryControl::default(),
        )
        .unwrap_err();
    assert_eq!(error.error, PublicationError::StalePreview);
    assert!(error.created.is_empty());
    let review = prepare(&authority, RootLinks::default());
    let digest = review.acceptance_digest();
    authority.cleanup.store(false, Ordering::Release);
    let error = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(error.error, PublicationError::Read(ReadError::Denied));
    assert!(error.created.is_empty());
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn an_identical_kit_needs_no_write_permissions_or_operation_record() {
    struct NoWrites;
    impl MemoryWriteAccess for NoWrites {
        fn allows_create(&self, _: &Path) -> bool {
            false
        }
    }
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let first = prepare(&authority, RootLinks::default());
    let digest = first.acceptance_digest();
    first
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    let review = prepare(&authority, RootLinks::default());
    let requirements = review.write_requirements();
    assert!(
        requirements.create.is_empty()
            && requirements.replace.is_empty()
            && requirements.recovery.is_empty()
    );
    let digest = review.acceptance_digest();
    let report = review
        .publish(&digest, &NoWrites, &DiscoveryControl::default())
        .unwrap();
    assert!(!report.skipped.is_empty());
    assert!(report.created.is_empty() && report.migrated.is_empty() && report.cleaned.is_empty());
    assert!(!project.path().join(PROJECT_INITIALIZATION_RECORD).exists());
}

#[test]
fn a_racing_record_or_changed_rules_are_never_overwritten_by_an_accepted_review() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let review = prepare(&authority, RootLinks::default());
    let digest = review.acceptance_digest();
    fs::create_dir(project.path().join(".voktty")).unwrap();
    fs::write(
        project.path().join(PROJECT_INITIALIZATION_RECORD),
        "foreign operation",
    )
    .unwrap();
    let error = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert!(matches!(error.error, PublicationError::RecoveryRequired(_)));
    assert!(error.created.is_empty());
    assert_eq!(
        fs::read_to_string(project.path().join(PROJECT_INITIALIZATION_RECORD)).unwrap(),
        "foreign operation"
    );
    let other = tempfile::tempdir().unwrap();
    fs::write(other.path().join("AGENTS.md"), "original rules").unwrap();
    let authority = access(other.path());
    let review = prepare(
        &authority,
        RootLinks {
            agents: true,
            claude: false,
        },
    );
    let digest = review.acceptance_digest();
    fs::write(other.path().join("AGENTS.md"), "new owner rules").unwrap();
    let error = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(error.error, PublicationError::StalePreview);
    assert!(error.created.is_empty());
    assert_eq!(
        fs::read_to_string(other.path().join("AGENTS.md")).unwrap(),
        "new owner rules"
    );
    assert!(!other.path().join(".voktty").exists());
}

#[test]
fn reentrant_publication_is_rejected_until_the_original_physical_work_finishes() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let other_authority = access(other.path());
    let second = prepare(&other_authority, RootLinks::default());
    let first = prepare(&authority, RootLinks::default());
    *authority.reentrant.lock().unwrap() = Some((second, other_authority.clone()));
    let digest = first.acceptance_digest();
    first
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(authority.saw_busy.load(Ordering::Acquire));
    assert_eq!(fs::read_dir(other.path()).unwrap().count(), 0);
    let second = prepare(&other_authority, RootLinks::default());
    let digest = second.acceptance_digest();
    second
        .publish(
            &digest,
            other_authority.as_ref(),
            &DiscoveryControl::default(),
        )
        .unwrap();
    assert!(other.path().join(".voktty/kit.json").exists());
}

#[test]
fn interrupted_copy_retains_a_metadata_only_record_and_never_publishes_the_marker() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let review = prepare(&authority, RootLinks::default());
    let digest = review.acceptance_digest();
    authority.interrupt.store(true, Ordering::Release);
    let error = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert!(!error.created.is_empty());
    assert!(error
        .possible_recovery_files
        .iter()
        .any(|path| path == PROJECT_INITIALIZATION_RECORD));
    assert!(project.path().join(".voktty/INIT.md").exists());
    assert!(!project.path().join(".voktty/kit.json").exists());
    let record: Value = serde_json::from_slice(
        &fs::read(project.path().join(PROJECT_INITIALIZATION_RECORD)).unwrap(),
    )
    .unwrap();
    assert_eq!(record.as_object().unwrap().len(), 7);
    assert_eq!(record["schema"], 1);
    assert_eq!(record["operation"], "initialize-project");
    assert_eq!(record["destinationBinding"].as_str().unwrap().len(), 64);
    assert_eq!(record["reviewDigest"], digest);
    assert!(record["files"]
        .as_array()
        .unwrap()
        .iter()
        .all(|file| file["proposed"]
            .as_str()
            .is_some_and(|hash| hash.len() == 64)));
}

#[test]
fn a_late_migration_failure_keeps_exact_originals_and_the_record_for_recovery() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir(project.path().join(".voktty")).unwrap();
    fs::write(project.path().join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(
        project.path().join("AGENTS.md"),
        "owner-original-agent-secret\n",
    )
    .unwrap();
    fs::write(project.path().join("CLAUDE.md"), "owner-original-claude\n").unwrap();
    let authority = access(project.path());
    let review = prepare(
        &authority,
        RootLinks {
            agents: true,
            claude: true,
        },
    );
    let requirements = review.write_requirements();
    let digest = review.acceptance_digest();
    authority.stop_after_agents.store(true, Ordering::Release);
    let error = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert!(error.migrated.iter().any(|path| path == "AGENTS.md"));
    let originals = requirements
        .recovery
        .iter()
        .filter(|path| path.as_str() != PROJECT_INITIALIZATION_RECORD)
        .filter_map(|path| fs::read_to_string(project.path().join(path)).ok())
        .collect::<Vec<_>>();
    assert!(originals
        .iter()
        .any(|text| text == "owner-original-agent-secret\n"));
    assert!(originals.iter().any(|text| text == "*\n"));
    assert_eq!(
        fs::read_to_string(project.path().join("CLAUDE.md")).unwrap(),
        "owner-original-claude\n"
    );
    let record = fs::read_to_string(project.path().join(PROJECT_INITIALIZATION_RECORD)).unwrap();
    assert!(!record.contains("owner-original-agent-secret"));
    assert!(!project.path().join(".voktty/kit.json").exists());
}

#[test]
fn a_completed_kit_with_failed_record_cleanup_still_requires_explicit_recovery() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let review = prepare(&authority, RootLinks::default());
    let digest = review.acceptance_digest();
    authority.late_cleanup_denial.store(true, Ordering::Release);
    let error = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(error.error, PublicationError::Read(ReadError::Denied));
    assert!(project.path().join(".voktty/kit.json").exists());
    assert!(project.path().join(PROJECT_INITIALIZATION_RECORD).exists());
    let result = OwnedProjectInitializationPreview::prepare(
        ProjectInitializationRequest {
            origin: project.path().to_owned(),
            origin_access: authority.clone(),
            destination: project.path().to_owned(),
            destination_access: authority.clone(),
            inputs: json!({"project_name":"Native publication","created_at":"2026-11-03"})
                .as_object()
                .unwrap()
                .clone(),
            links: RootLinks::default(),
        },
        &DiscoveryControl::default(),
    );
    assert!(
        matches!(result, Err(PublicationError::RecoveryRequired(paths)) if paths.iter().any(|path| path == PROJECT_INITIALIZATION_RECORD))
    );
}

#[test]
fn a_concurrent_nested_claim_prevents_the_parent_marker_from_publishing() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let review = prepare(&authority, RootLinks::default());
    let digest = review.acceptance_digest();
    authority.introduce_child.store(true, Ordering::Release);
    let error = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(error.error, PublicationError::Scope);
    assert!(!project.path().join(".voktty/kit.json").exists());
    assert!(!project.path().join("nested/.voktty/kit.json").exists());
    assert!(project.path().join(PROJECT_INITIALIZATION_RECORD).exists());
    assert_eq!(
        fs::read_to_string(
            project
                .path()
                .join("nested")
                .join(PROJECT_INITIALIZATION_RECORD)
        )
        .unwrap(),
        "another operation"
    );
}

#[test]
fn worker_publishes_the_original_review_without_opening_a_private_store() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let review = prepare(&authority, RootLinks::default());
    let digest = review.acceptance_digest();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let report = runtime.block_on(async {
        MemoryWorkers::default()
            .publish_project(review, digest, authority, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap()
    });
    assert!(report.created.iter().any(|path| path == ".voktty/kit.json"));
    assert!(!project.path().join(PROJECT_INITIALIZATION_RECORD).exists());
}
