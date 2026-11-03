#![cfg(any(unix, windows))]

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use voktty_memory_local::{
    DiscoveryControl, MemoryReadAccess, MemoryWorkers, OwnedProjectInitializationPreview,
    ProjectInitializationRequest, PublicationError, ReadError,
};
use voktty_workspace_kit::{
    prepare_deployment, render_template, resource, DeploymentAction, PathFact, RootLinks,
};

static SERIAL: Mutex<()> = Mutex::new(());

struct Access {
    requested: PathBuf,
    root: PathBuf,
    live: AtomicBool,
    enumeration: AtomicBool,
    reads: Mutex<Vec<PathBuf>>,
    caller: std::thread::ThreadId,
    off_thread: AtomicBool,
    mutation: Mutex<Option<(PathBuf, PathBuf, String)>>,
    retirement: Mutex<Option<(PathBuf, Arc<Access>)>>,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        if std::thread::current().id() != self.caller {
            self.off_thread.store(true, Ordering::Release);
        }
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
        self.reads.lock().unwrap().push(path.to_owned());
        self.allows_metadata(path)
            && [&self.requested, &self.root].into_iter().any(|root| {
                path.starts_with(root)
                    || root
                        .ancestors()
                        .any(|ancestor| path == ancestor.join(".voktty/kit.json"))
            })
    }

    fn allows_enumeration(&self, path: &Path) -> bool {
        if !self.enumeration.load(Ordering::Acquire) || !self.allows_metadata(path) {
            return false;
        }
        let mut mutation = self.mutation.lock().unwrap();
        if mutation
            .as_ref()
            .is_some_and(|(trigger, _, _)| trigger == path)
        {
            let (_, target, text) = mutation.take().unwrap();
            fs::write(target, text).unwrap();
        }
        let mut retirement = self.retirement.lock().unwrap();
        if retirement
            .as_ref()
            .is_some_and(|(trigger, _)| trigger == path)
        {
            let (_, source) = retirement.take().unwrap();
            source.live.store(false, Ordering::Release);
        }
        true
    }
}

fn access(path: &Path) -> Arc<Access> {
    Arc::new(Access {
        requested: path.to_owned(),
        root: fs::canonicalize(path).unwrap(),
        live: AtomicBool::new(true),
        enumeration: AtomicBool::new(true),
        reads: Mutex::new(Vec::new()),
        caller: std::thread::current().id(),
        off_thread: AtomicBool::new(false),
        mutation: Mutex::new(None),
        retirement: Mutex::new(None),
    })
}

fn inputs() -> Map<String, Value> {
    json!({"project_name":"Independent project","created_at":"2026-11-03"})
        .as_object()
        .unwrap()
        .clone()
}

fn request(authority: &Arc<Access>) -> ProjectInitializationRequest {
    ProjectInitializationRequest {
        origin: authority.requested.clone(),
        origin_access: authority.clone(),
        destination: authority.requested.clone(),
        destination_access: authority.clone(),
        inputs: inputs(),
        links: RootLinks::default(),
    }
}

fn prepare(authority: &Arc<Access>) -> OwnedProjectInitializationPreview {
    OwnedProjectInitializationPreview::prepare(request(authority), &DiscoveryControl::default())
        .unwrap()
}

fn populate(root: &Path) {
    let files = render_template(&inputs()).unwrap();
    let mut facts = files
        .iter()
        .map(|file| (file.path.clone(), PathFact::Absent))
        .collect::<std::collections::BTreeMap<_, _>>();
    facts.insert(".voktty/kit.lock.json".into(), PathFact::Absent);
    let manifest: Value = serde_json::from_str(resource("manifest.json").unwrap()).unwrap();
    let deployment = prepare_deployment(
        manifest["version"].as_str().unwrap(),
        &files,
        &facts,
        RootLinks::default(),
    )
    .unwrap();
    for entry in deployment.plan.entries {
        let path = root.join(entry.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, entry.proposed).unwrap();
    }
}

#[test]
fn native_preview_renders_exact_template_without_creating_private_or_project_state() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let review = prepare(&authority);
    fn send_static<T: Send + 'static>(_: &T) {}
    send_static(&review);
    assert_eq!(review.root(), authority.root);
    assert!(review.deployment().plan.can_publish);
    assert!(review
        .deployment()
        .plan
        .entries
        .iter()
        .all(|entry| entry.action == DeploymentAction::Create));
    assert_eq!(
        review.deployment().plan.entries.last().unwrap().path,
        ".voktty/kit.json"
    );
    for file in render_template(&inputs())
        .unwrap()
        .into_iter()
        .filter(|file| file.path.starts_with(".voktty/"))
    {
        assert!(review
            .deployment()
            .plan
            .entries
            .iter()
            .any(|entry| entry.path == file.path && entry.proposed == file.text));
    }
    review.revalidate(&DiscoveryControl::default()).unwrap();
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn reserved_sessions_and_legacy_ignore_get_a_review_without_modification() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir_all(project.path().join(".voktty/sessions")).unwrap();
    fs::write(
        project.path().join(".voktty/sessions/owner.json"),
        "owner session",
    )
    .unwrap();
    fs::write(project.path().join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(project.path().join("AGENTS.md"), "owner rules\n").unwrap();
    let authority = access(project.path());
    let mut input = request(&authority);
    input.links.agents = true;
    let review =
        OwnedProjectInitializationPreview::prepare(input, &DiscoveryControl::default()).unwrap();
    for path in [".voktty/.gitignore", "AGENTS.md"] {
        assert!(review
            .deployment()
            .plan
            .entries
            .iter()
            .any(|entry| entry.path == path && entry.action == DeploymentAction::Migrate));
    }
    review.revalidate(&DiscoveryControl::default()).unwrap();
    assert_eq!(
        fs::read_to_string(project.path().join(".voktty/.gitignore")).unwrap(),
        "*\n"
    );
    assert_eq!(
        fs::read_to_string(project.path().join("AGENTS.md")).unwrap(),
        "owner rules\n"
    );
    assert_eq!(
        fs::read_to_string(project.path().join(".voktty/sessions/owner.json")).unwrap(),
        "owner session"
    );
    assert!(!project.path().join(".voktty/kit.json").exists());
    assert!(authority
        .reads
        .lock()
        .unwrap()
        .iter()
        .all(|path| !path.ends_with("owner.json")));
}

#[test]
fn an_identical_existing_kit_has_only_skip_entries() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    populate(project.path());
    let review = prepare(&access(project.path()));
    assert!(review
        .deployment()
        .plan
        .entries
        .iter()
        .all(|entry| entry.action == DeploymentAction::Skip));
    review.revalidate(&DiscoveryControl::default()).unwrap();
}

#[test]
fn a_valid_target_can_review_missing_template_files_without_changing_existing_bytes() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    populate(project.path());
    fs::remove_file(project.path().join(".voktty/kit.lock.json")).unwrap();
    let before = fs::read(project.path().join(".voktty/kit.json")).unwrap();
    let review = prepare(&access(project.path()));
    assert!(review
        .deployment()
        .plan
        .entries
        .iter()
        .any(|entry| entry.path == ".voktty/kit.lock.json"
            && entry.action == DeploymentAction::Create));
    assert_eq!(
        review
            .deployment()
            .plan
            .entries
            .iter()
            .filter(|entry| entry.action != DeploymentAction::Skip)
            .count(),
        1
    );
    assert_eq!(
        fs::read(project.path().join(".voktty/kit.json")).unwrap(),
        before
    );
    assert!(!project.path().join(".voktty/kit.lock.json").exists());
}

#[test]
fn custom_template_bytes_are_preserved_as_conflicts() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir(project.path().join(".voktty")).unwrap();
    let path = project.path().join(".voktty/PROJECT.md");
    fs::write(&path, "owner content").unwrap();
    let result = OwnedProjectInitializationPreview::prepare(
        request(&access(project.path())),
        &DiscoveryControl::default(),
    );
    assert!(matches!(result, Err(PublicationError::Conflict)));
    assert_eq!(fs::read_to_string(path).unwrap(), "owner content");
}

#[test]
fn old_migration_artifacts_require_recovery_before_missing_rules_can_be_recreated() {
    let _serial = SERIAL.lock().unwrap();
    for relative in [
        ".voktty-migration-11111111-1111-4111-8111-111111111111-0",
        ".voktty/.voktty-migration-11111111-1111-4111-8111-111111111111-0",
    ] {
        let project = tempfile::tempdir().unwrap();
        fs::create_dir(project.path().join(".voktty")).unwrap();
        let path = project.path().join(relative);
        fs::write(&path, "original owner rules").unwrap();
        let authority = access(project.path());
        let mut input = request(&authority);
        input.links.agents = true;
        assert!(
            matches!(OwnedProjectInitializationPreview::prepare(input, &DiscoveryControl::default()), Err(PublicationError::RecoveryRequired(paths)) if paths == [relative])
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "original owner rules");
        assert!(!project.path().join("AGENTS.md").exists());
    }
}

#[test]
fn native_review_is_bound_to_actual_roots_inputs_and_read_authority() {
    let _serial = SERIAL.lock().unwrap();
    let first = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let authority = access(first.path());
    let review = prepare(&authority);
    assert_ne!(
        review.acceptance_digest(),
        prepare(&access(other.path())).acceptance_digest()
    );
    let mut changed = request(&authority);
    changed
        .inputs
        .insert("project_name".into(), json!("Other project"));
    let other_inputs =
        OwnedProjectInitializationPreview::prepare(changed, &DiscoveryControl::default()).unwrap();
    assert_ne!(review.acceptance_digest(), other_inputs.acceptance_digest());
    authority.live.store(false, Ordering::Release);
    assert!(matches!(
        review.revalidate(&DiscoveryControl::default()),
        Err(PublicationError::Read(ReadError::Denied))
    ));
}

#[test]
fn changed_documents_and_new_nested_kits_invalidate_the_original_review() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let mut input = request(&authority);
    input.links.agents = true;
    let review =
        OwnedProjectInitializationPreview::prepare(input, &DiscoveryControl::default()).unwrap();
    fs::write(project.path().join("AGENTS.md"), "new owner rules").unwrap();
    assert!(matches!(
        review.revalidate(&DiscoveryControl::default()),
        Err(PublicationError::StalePreview)
    ));
    fs::remove_file(project.path().join("AGENTS.md")).unwrap();
    let nested = project.path().join("nested");
    fs::create_dir(&nested).unwrap();
    populate(&nested);
    assert!(matches!(
        review.revalidate(&DiscoveryControl::default()),
        Err(PublicationError::Scope)
    ));
}

#[test]
fn a_document_changed_during_descendant_discovery_cannot_pass_revalidation() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let nested = project.path().join("nested");
    fs::create_dir(&nested).unwrap();
    let rules = project.path().join("AGENTS.md");
    fs::write(&rules, "reviewed owner rules\n").unwrap();
    let authority = access(project.path());
    let mut input = request(&authority);
    input.links.agents = true;
    let review =
        OwnedProjectInitializationPreview::prepare(input, &DiscoveryControl::default()).unwrap();
    *authority.mutation.lock().unwrap() = Some((
        fs::canonicalize(nested).unwrap(),
        rules.clone(),
        "changed during scan\n".into(),
    ));
    assert!(matches!(
        review.revalidate(&DiscoveryControl::default()),
        Err(PublicationError::StalePreview)
    ));
    assert_eq!(fs::read_to_string(rules).unwrap(), "changed during scan\n");
}

#[test]
fn an_origin_retired_during_destination_discovery_cannot_publish_a_late_review() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let nested = project.path().join("nested");
    fs::create_dir(&nested).unwrap();
    let origin = access(project.path());
    let destination = access(project.path());
    let mut input = request(&destination);
    input.origin_access = origin.clone();
    let review =
        OwnedProjectInitializationPreview::prepare(input, &DiscoveryControl::default()).unwrap();
    *destination.retirement.lock().unwrap() = Some((fs::canonicalize(nested).unwrap(), origin));
    assert!(matches!(
        review.revalidate(&DiscoveryControl::default()),
        Err(PublicationError::Read(ReadError::Denied))
    ));
    assert!(destination.live.load(Ordering::Acquire));
    assert!(!project.path().join(".voktty").exists());
}

#[cfg(unix)]
#[test]
fn replacing_a_selected_root_invalidates_its_retained_review() {
    let _serial = SERIAL.lock().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let project = parent.path().join("project");
    fs::create_dir(&project).unwrap();
    let review = prepare(&access(&project));
    fs::rename(&project, parent.path().join("original")).unwrap();
    fs::create_dir(&project).unwrap();
    assert!(matches!(
        review.revalidate(&DiscoveryControl::default()),
        Err(PublicationError::Read(ReadError::StaleRoot))
    ));
    assert_eq!(fs::read_dir(project).unwrap().count(), 0);
    assert_eq!(
        fs::read_dir(parent.path().join("original"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn a_parent_kit_or_partial_target_cannot_be_treated_as_an_absent_project() {
    let _serial = SERIAL.lock().unwrap();
    let parent = tempfile::tempdir().unwrap();
    populate(parent.path());
    let nested = parent.path().join("nested");
    fs::create_dir(&nested).unwrap();
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(
            request(&access(&nested)),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Scope)
    ));
    let project = tempfile::tempdir().unwrap();
    let init = render_template(&inputs())
        .unwrap()
        .into_iter()
        .find(|file| file.path == ".voktty/INIT.md")
        .unwrap();
    fs::create_dir(project.path().join(".voktty")).unwrap();
    fs::write(project.path().join(&init.path), &init.text).unwrap();
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(
            request(&access(project.path())),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Scope)
    ));
    assert_eq!(
        fs::read_to_string(project.path().join(&init.path)).unwrap(),
        init.text
    );
}

#[test]
fn invalid_inputs_and_foreign_roots_fail_without_project_reads() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let foreign = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let mut invalid = request(&authority);
    invalid
        .inputs
        .insert("project_name".into(), json!("x".repeat(16 * 1024 + 1)));
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(invalid, &DiscoveryControl::default()),
        Err(PublicationError::Read(ReadError::Limit))
    ));
    let mut invalid = request(&authority);
    invalid.destination = foreign.path().to_owned();
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(invalid, &DiscoveryControl::default()),
        Err(PublicationError::Read(ReadError::Denied))
    ));
    assert!(authority.reads.lock().unwrap().is_empty());
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(foreign.path()).unwrap().count(), 0);
}

#[test]
fn cancellation_and_missing_enumeration_cannot_prepare_or_revalidate_a_review() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let cancelled = DiscoveryControl::default();
    cancelled.cancel();
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(request(&authority), &cancelled),
        Err(PublicationError::Read(ReadError::Cancelled))
    ));
    assert!(authority.reads.lock().unwrap().is_empty());
    let review = prepare(&authority);
    assert!(matches!(
        review.revalidate(&DiscoveryControl::new(Duration::ZERO)),
        Err(PublicationError::Read(ReadError::Timeout))
    ));
    authority.enumeration.store(false, Ordering::Release);
    assert!(review.revalidate(&DiscoveryControl::default()).is_err());
    assert!(OwnedProjectInitializationPreview::prepare(
        request(&authority),
        &DiscoveryControl::default()
    )
    .is_err());
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn worker_prepares_the_owned_review_off_the_async_thread_without_a_private_store() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let review = runtime.block_on(async {
        MemoryWorkers::default()
            .preview_project(request(&authority), DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap()
    });
    assert!(authority.off_thread.load(Ordering::Acquire));
    assert!(review.deployment().plan.can_publish);
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}
