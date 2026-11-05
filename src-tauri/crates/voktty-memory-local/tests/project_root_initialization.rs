#![cfg(any(target_os = "linux", windows))]

use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use voktty_memory_local::{
    DiscoveryControl, MemoryReadAccess, MemoryWorkers, MemoryWriteAccess,
    OwnedProjectInitializationPreview, ProjectInitializationRequest, PublicationError, ReadError,
    PROJECT_INITIALIZATION_RECORD,
};
use voktty_workspace_kit::{render_template, RootLinks};

static SERIAL: Mutex<()> = Mutex::new(());

struct Access {
    requested: PathBuf,
    root: PathBuf,
    ancestors: bool,
    live: AtomicBool,
    reads: Mutex<Vec<PathBuf>>,
    enumerations: Mutex<Vec<PathBuf>>,
    interrupt: AtomicBool,
}
impl Access {
    fn inside(&self, path: &Path) -> bool {
        path.starts_with(&self.requested) || path.starts_with(&self.root)
    }
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.live.load(Ordering::Acquire)
            && (self.inside(path)
                || self.ancestors
                    && [&self.requested, &self.root].into_iter().any(|root| {
                        root.ancestors().any(|ancestor| {
                            path == ancestor || path.starts_with(ancestor.join(".voktty"))
                        })
                    }))
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.live.load(Ordering::Acquire) && self.inside(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().push(path.to_owned());
        self.allows_metadata(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.enumerations.lock().unwrap().push(path.to_owned());
        self.allows_metadata(path)
            && (self.ancestors
                || [&self.requested, &self.root]
                    .into_iter()
                    .any(|root| path == root || path == root.join(".voktty")))
    }
}
impl MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
            && !(self.interrupt.load(Ordering::Acquire)
                && path.ends_with("RULES.md")
                && self.root.join(PROJECT_INITIALIZATION_RECORD).exists()
                && self.root.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        self.allows_create(path)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
}
fn access(root: &Path, ancestors: bool) -> Arc<Access> {
    Arc::new(Access {
        requested: root.to_owned(),
        root: fs::canonicalize(root).unwrap(),
        ancestors,
        live: AtomicBool::new(true),
        reads: Mutex::new(Vec::new()),
        enumerations: Mutex::new(Vec::new()),
        interrupt: AtomicBool::new(false),
    })
}
fn request(authority: &Arc<Access>) -> ProjectInitializationRequest {
    ProjectInitializationRequest {
        origin: authority.requested.clone(),
        origin_access: authority.clone(),
        destination: authority.requested.clone(),
        destination_access: authority.clone(),
        inputs: json!({"project_name":"Explicit project root","created_at":"2026-11-03"})
            .as_object()
            .unwrap()
            .clone(),
        links: RootLinks::default(),
    }
}
fn publish(authority: &Arc<Access>) {
    let review = OwnedProjectInitializationPreview::prepare_at_project_root(
        request(authority),
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
}

#[test]
fn explicit_creation_requires_only_the_selected_root_and_never_enumerates_dependencies() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir_all(project.path().join("node_modules/dependency/deep")).unwrap();
    fs::create_dir_all(project.path().join(".git/objects")).unwrap();
    fs::write(
        project.path().join("node_modules/dependency/deep/data"),
        "dependency bytes",
    )
    .unwrap();
    let authority = access(project.path(), false);
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(
            request(&authority),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Scope)
    ));
    authority.reads.lock().unwrap().clear();
    authority.enumerations.lock().unwrap().clear();
    publish(&authority);
    assert!(project.path().join(".voktty/kit.json").exists());
    assert_eq!(
        fs::read_to_string(project.path().join("node_modules/dependency/deep/data")).unwrap(),
        "dependency bytes"
    );
    assert!(authority
        .enumerations
        .lock()
        .unwrap()
        .iter()
        .all(|path| path == &authority.root || path == &authority.root.join(".voktty")));
    assert!(authority
        .reads
        .lock()
        .unwrap()
        .iter()
        .all(|path| authority.inside(path)
            && !path.starts_with(authority.root.join("node_modules"))
            && !path.starts_with(authority.root.join(".git"))));
}

#[cfg(unix)]
#[test]
fn pnpm_style_dependency_links_are_not_followed_or_modified_during_creation() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("owner.txt"), "outside content").unwrap();
    fs::create_dir(project.path().join("node_modules")).unwrap();
    std::os::unix::fs::symlink(outside.path(), project.path().join("node_modules/package"))
        .unwrap();
    let authority = access(project.path(), true);
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(
            request(&authority),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Scope)
    ));
    assert!(authority
        .enumerations
        .lock()
        .unwrap()
        .iter()
        .any(|path| path.ends_with("node_modules")));
    authority.enumerations.lock().unwrap().clear();
    publish(&authority);
    assert!(
        fs::symlink_metadata(project.path().join("node_modules/package"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(
        fs::read_to_string(outside.path().join("owner.txt")).unwrap(),
        "outside content"
    );
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    assert!(authority
        .enumerations
        .lock()
        .unwrap()
        .iter()
        .all(|path| path == &authority.root || path == &authority.root.join(".voktty")));
}

#[test]
fn a_large_dependency_tree_does_not_consume_the_creation_scan_budget() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let dependency = project.path().join("node_modules/package");
    fs::create_dir_all(&dependency).unwrap();
    for index in 0..20001 {
        fs::write(dependency.join(index.to_string()), "").unwrap();
    }
    let authority = access(project.path(), true);
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare(
            request(&authority),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Scope)
    ));
    authority.enumerations.lock().unwrap().clear();
    publish(&authority);
    assert!(project.path().join(".voktty/kit.json").exists());
    assert_eq!(fs::read_dir(dependency).unwrap().count(), 20001);
    assert!(authority
        .enumerations
        .lock()
        .unwrap()
        .iter()
        .all(|path| path == &authority.root || path == &authority.root.join(".voktty")));
}

#[test]
fn explicit_placement_neither_reads_parent_memory_nor_modifies_a_child_memory() {
    let _serial = SERIAL.lock().unwrap();
    let parent = tempfile::tempdir().unwrap();
    fs::create_dir(parent.path().join(".voktty")).unwrap();
    fs::write(
        parent.path().join(".voktty/kit.json"),
        "parent content outside the grant",
    )
    .unwrap();
    let project = parent.path().join("project");
    fs::create_dir_all(project.join("nested/.voktty")).unwrap();
    fs::write(
        project.join("nested/.voktty/kit.json"),
        "child content outside creation inventory",
    )
    .unwrap();
    let authority = access(&project, false);
    publish(&authority);
    assert_eq!(
        fs::read_to_string(parent.path().join(".voktty/kit.json")).unwrap(),
        "parent content outside the grant"
    );
    assert_eq!(
        fs::read_to_string(project.join("nested/.voktty/kit.json")).unwrap(),
        "child content outside creation inventory"
    );
    assert!(authority
        .reads
        .lock()
        .unwrap()
        .iter()
        .all(|path| authority.inside(path) && !path.starts_with(authority.root.join("nested"))));
}

#[test]
fn matching_existing_template_files_and_sessions_are_preserved_without_inheriting_a_scope() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir_all(project.path().join(".voktty/sessions")).unwrap();
    let authority = access(project.path(), false);
    let init = render_template(&request(&authority).inputs)
        .unwrap()
        .into_iter()
        .find(|file| file.path == ".voktty/INIT.md")
        .unwrap();
    fs::write(project.path().join(&init.path), &init.text).unwrap();
    fs::write(
        project.path().join(".voktty/sessions/owner.json"),
        "session",
    )
    .unwrap();
    fs::write(project.path().join(".voktty/custom.md"), "custom bytes").unwrap();
    publish(&authority);
    assert_eq!(
        fs::read_to_string(project.path().join(&init.path)).unwrap(),
        init.text
    );
    assert_eq!(
        fs::read_to_string(project.path().join(".voktty/sessions/owner.json")).unwrap(),
        "session"
    );
    assert_eq!(
        fs::read_to_string(project.path().join(".voktty/custom.md")).unwrap(),
        "custom bytes"
    );
}

#[test]
fn repair_preserves_project_content_and_rechecks_it_before_publication() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path(), false);
    publish(&authority);
    let content = render_template(&request(&authority).inputs)
        .unwrap()
        .into_iter()
        .filter(|file| file.kind == voktty_workspace_kit::FileKind::Content)
        .map(|file| {
            let text = format!("Project-owned content for {}\n", file.path);
            fs::write(project.path().join(&file.path), &text).unwrap();
            (file.path, text)
        })
        .collect::<Vec<_>>();
    fs::remove_file(project.path().join(".voktty/RULES.md")).unwrap();
    let review = OwnedProjectInitializationPreview::prepare_at_project_root(
        request(&authority),
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    fs::write(
        project.path().join(".voktty/CONTEXT.md"),
        "Concurrent update\n",
    )
    .unwrap();
    assert_eq!(
        review
            .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::StalePreview
    );
    assert!(!project.path().join(".voktty/RULES.md").exists());
    assert!(!project.path().join(PROJECT_INITIALIZATION_RECORD).exists());
    publish(&authority);
    assert!(project.path().join(".voktty/RULES.md").exists());
    for (path, text) in content {
        let expected = if path == ".voktty/CONTEXT.md" {
            "Concurrent update\n"
        } else {
            &text
        };
        assert_eq!(
            fs::read_to_string(project.path().join(path)).unwrap(),
            expected
        );
    }
}

#[test]
fn repair_uses_persisted_values_after_the_folder_and_date_defaults_change() {
    let _serial = SERIAL.lock().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let original = parent.path().join("original");
    fs::create_dir(&original).unwrap();
    let authority = access(&original, false);
    publish(&authority);
    let config = fs::read(original.join(".voktty/kit.json")).unwrap();
    let readme = fs::read(original.join(".voktty/README.md")).unwrap();
    let renamed = parent.path().join("renamed");
    fs::rename(&original, &renamed).unwrap();
    fs::remove_file(renamed.join(".voktty/README.md")).unwrap();
    let authority = access(&renamed, false);
    let mut next = request(&authority);
    next.inputs.insert("project_name".into(), "renamed".into());
    next.inputs.insert("created_at".into(), "2027-01-01".into());
    let review = OwnedProjectInitializationPreview::prepare_at_project_root(
        next,
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    let report = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(report
        .created
        .iter()
        .any(|path| path == ".voktty/README.md"));
    assert_eq!(fs::read(renamed.join(".voktty/README.md")).unwrap(), readme);
    assert_eq!(fs::read(renamed.join(".voktty/kit.json")).unwrap(), config);
}

#[test]
fn interrupted_repair_records_render_values_without_copying_preserved_content() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path(), false);
    publish(&authority);
    let config_path = project.path().join(".voktty/kit.json");
    let mut config: serde_json::Value =
        serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    config["kitVersion"] = "0.1.0".into();
    config["values"]["kit_version"] = "0.1.0".into();
    fs::write(&config_path, config.to_string()).unwrap();
    fs::write(
        project.path().join(".voktty/CONTEXT.md"),
        "private project context",
    )
    .unwrap();
    fs::write(project.path().join("AGENTS.md"), "existing owner rules").unwrap();
    fs::remove_file(project.path().join(".voktty/RULES.md")).unwrap();
    let mut next = request(&authority);
    next.inputs
        .insert("project_name".into(), "New folder default".into());
    next.inputs.insert("created_at".into(), "2027-01-01".into());
    next.links = RootLinks {
        agents: true,
        claude: true,
    };
    let review = OwnedProjectInitializationPreview::prepare_at_project_root(
        next,
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    authority.interrupt.store(true, Ordering::Release);
    assert!(review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .is_err());
    let text = fs::read_to_string(project.path().join(PROJECT_INITIALIZATION_RECORD)).unwrap();
    let record: serde_json::Value = serde_json::from_str(&text).unwrap();
    let values = &record["template"]["values"];
    assert_eq!(values["project_name"], "Explicit project root");
    assert_eq!(values["created_at"], "2026-11-03");
    let manifest: serde_json::Value =
        serde_json::from_str(voktty_workspace_kit::resource("manifest.json").unwrap()).unwrap();
    assert_eq!(values["kit_version"], manifest["version"]);
    assert_eq!(record["template"]["version"], manifest["version"]);
    assert_eq!(
        record["template"]["links"],
        json!({"agents":true,"claude":true})
    );
    assert!(!text.contains("private project context"));
    assert!(!text.contains("existing owner rules"));
    assert_eq!(fs::read_to_string(config_path).unwrap(), config.to_string());
    assert!(record["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["path"] == ".voktty/CONTEXT.md" && entry["action"] == "skip"));
}

#[test]
fn explicit_and_resolved_reviews_have_distinct_acceptance_digests() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path(), true);
    let scoped = OwnedProjectInitializationPreview::prepare(
        request(&authority),
        &DiscoveryControl::default(),
    )
    .unwrap();
    let explicit = OwnedProjectInitializationPreview::prepare_at_project_root(
        request(&authority),
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = scoped.acceptance_digest();
    assert_ne!(digest, explicit.acceptance_digest());
    assert_eq!(
        explicit
            .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::StalePreview
    );
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn explicit_placement_still_rejects_pending_recovery_and_reserved_roots() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let protected = project.path().join(".voktty/sessions");
    fs::create_dir_all(&protected).unwrap();
    let authority = access(&protected, false);
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare_at_project_root(
            request(&authority),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Read(ReadError::Denied))
    ));
    assert_eq!(fs::read_dir(protected).unwrap().count(), 0);
    fs::write(
        project.path().join(PROJECT_INITIALIZATION_RECORD),
        "unfinished operation",
    )
    .unwrap();
    let authority = access(project.path(), false);
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare_at_project_root(
            request(&authority),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::RecoveryRequired(_))
    ));
    assert_eq!(
        fs::read_to_string(project.path().join(PROJECT_INITIALIZATION_RECORD)).unwrap(),
        "unfinished operation"
    );
}

#[test]
fn explicit_creation_record_preserves_its_scope_without_document_text() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path(), false);
    let review = OwnedProjectInitializationPreview::prepare_at_project_root(
        request(&authority),
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    authority.interrupt.store(true, Ordering::Release);
    let failure = review
        .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert!(!failure.created.is_empty());
    let record: serde_json::Value = serde_json::from_slice(
        &fs::read(project.path().join(PROJECT_INITIALIZATION_RECORD)).unwrap(),
    )
    .unwrap();
    assert_eq!(record["schema"], 2);
    assert_eq!(record["scope"], "explicit-project-root");
    assert_eq!(record["reviewDigest"], digest);
    assert!(!project.path().join(".voktty/kit.json").exists());
}

#[test]
fn secret_roots_and_changed_authority_remain_denied_in_explicit_mode() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let secret = project.path().join(".ssh");
    fs::create_dir(&secret).unwrap();
    let denied = access(&secret, false);
    assert!(matches!(
        OwnedProjectInitializationPreview::prepare_at_project_root(
            request(&denied),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Read(ReadError::Denied))
    ));
    let authority = access(project.path(), false);
    let review = OwnedProjectInitializationPreview::prepare_at_project_root(
        request(&authority),
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    authority.live.store(false, Ordering::Release);
    assert_eq!(
        review
            .publish(&digest, authority.as_ref(), &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::Read(ReadError::Denied)
    );
    assert!(!project.path().join(".voktty").exists());
}

#[cfg(unix)]
#[test]
fn a_symlink_at_the_kit_destination_never_redirects_explicit_creation() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), project.path().join(".voktty")).unwrap();
    let authority = access(project.path(), false);
    assert!(OwnedProjectInitializationPreview::prepare_at_project_root(
        request(&authority),
        &DiscoveryControl::default()
    )
    .is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    assert!(fs::symlink_metadata(project.path().join(".voktty"))
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn workers_prepare_and_publish_explicitly_selected_projects_without_ancestor_grants() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path(), false);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let workers = MemoryWorkers::default();
        let review = workers
            .preview_project_at_root(request(&authority), DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        let digest = review.acceptance_digest();
        workers
            .publish_project(review, digest, authority, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
    });
    assert!(project.path().join(".voktty/kit.json").exists());
    assert!(!project.path().join(PROJECT_INITIALIZATION_RECORD).exists());
}
