use super::*;
use crate::modules::project_memory::tests::{project, runtime, store};
use serde_json::json;
use std::fs;
use voktty_memory_local::MemoryDeploymentWorkError;
use voktty_workspace_kit::RootLinks;

struct Fixture {
    _project: tempfile::TempDir,
    _state: tempfile::TempDir,
    root: PathBuf,
    registry: WorkspaceRegistry,
    store: Arc<LocalMemoryStore>,
}
fn fixture() -> Fixture {
    let project = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(project.path()).unwrap();
    registry.authorize("/dev").unwrap();
    let (state, store) = store();
    Fixture {
        _project: project,
        _state: state,
        root,
        registry,
        store,
    }
}
fn select(f: &Fixture) -> (NativeMemorySelection, NativeMemorySelectionReceipt) {
    let mut owner = NativeMemorySelection::default();
    let selected = owner
        .select(&f.registry, f.root.clone(), &WorkspaceEnv::Local)
        .unwrap();
    (owner, selected)
}
fn request(f: &Fixture, links: RootLinks) -> NativeMemoryPreviewRequest {
    NativeMemoryPreviewRequest {
        destination: f.root.clone(),
        environment: WorkspaceEnv::Local,
        store: f.store.clone(),
        inputs: json!({"project_name":"Purpose-bound writes", "created_at":"2026-10-29"})
            .as_object()
            .unwrap()
            .clone(),
        links,
        control: DiscoveryControl::default(),
    }
}
async fn prepare(
    f: &Fixture,
    owner: &mut NativeMemorySelection,
    selected: &NativeMemorySelectionReceipt,
    links: RootLinks,
) -> NativeMemoryPreviewReceipt {
    let prepared = owner
        .prepare_preview(selected, &f.registry, request(f, links))
        .unwrap()
        .finish()
        .await
        .unwrap();
    owner.accept_preview(selected, prepared).unwrap()
}
fn access(root: &Path) -> Arc<Access> {
    Arc::new(Access {
        roots: vec![root.to_owned()],
        live: AtomicBool::new(true),
    })
}
fn capture(
    f: &Fixture,
    preview: &OwnedInitializationPreview,
    live: &Arc<AtomicBool>,
) -> NativeMemoryWriteAuthority {
    NativeMemoryWriteAuthority::capture(
        &f.registry,
        preview,
        access(&f.root),
        access(&f.root),
        live,
    )
    .unwrap()
}
fn cancelled<T>(result: &Result<T, MemoryDeploymentWorkError>) -> bool {
    matches!(
        result,
        Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
            ReadError::Cancelled
        )))
    )
}

#[test]
fn authority_grants_only_reviewed_creations_their_parents_and_native_staging() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&f, &mut owner, &selected, RootLinks::default()).await;
        let live = Arc::new(AtomicBool::new(true));
        let authority = capture(&f, owner.preview(&selected, &receipt).unwrap(), &live);
        assert!(authority.allows_create(&f.root.join(".voktty/INIT.md")));
        assert!(authority.allows_create(&f.root.join(".voktty/team/roles")));
        let stage = format!(".voktty-stage-{}", uuid::Uuid::new_v4());
        assert!(authority.allows_create(&f.root.join(".voktty").join(&stage)));
        for relative in ["", "AGENTS.md", "CLAUDE.md", "unreviewed.txt", ".voktty/sessions/private", ".voktty/tasks.json", ".voktty/tools.json", ".voktty/INIT.md/foreign", ".voktty/unknown", ".voktty/../unreviewed", ".voktty/.voktty-stage-invalid"] {
            let path = f.root.join(relative);
            assert!(!authority.allows_create(&path), "unexpected create grant: {relative}");
            assert!(!authority.allows_replace(&path));
            assert!(!authority.allows_remove_staging(&path));
        }
        assert!(!authority.allows_create(&f.root.join(&stage)));
        assert!(!authority.allows_create(&f.root.join(".voktty/unreviewed").join(&stage)));
        assert!(!authority.allows_create(&f.root.with_file_name("foreign").join(".voktty/INIT.md")));
        assert!(!f.registry.is_authorized(Path::new("/")));
    });
}

#[test]
fn migration_authority_names_only_exact_transaction_backups_and_selected_rules() {
    let f = fixture();
    fs::create_dir(f.root.join(".voktty")).unwrap();
    fs::write(f.root.join(".voktty/.gitignore"), "*\r\n").unwrap();
    fs::write(f.root.join("AGENTS.md"), "owner rules\r\n").unwrap();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(
            &f,
            &mut owner,
            &selected,
            RootLinks {
                agents: true,
                claude: false,
            },
        )
        .await;
        let preview = owner.preview(&selected, &receipt).unwrap();
        let requirements = preview.write_requirements();
        assert_eq!(requirements.root, f.root);
        assert_eq!(requirements.recovery.len(), 2);
        let live = Arc::new(AtomicBool::new(true));
        let authority = capture(&f, preview, &live);
        assert!(authority.allows_replace(&f.root.join("AGENTS.md")));
        assert!(authority.allows_replace(&f.root.join(".voktty/.gitignore")));
        assert!(!authority.allows_replace(&f.root.join("CLAUDE.md")));
        assert!(!authority.allows_replace(&f.root.join(".voktty/INIT.md")));
        for backup in requirements.recovery {
            assert!(authority.allows_create(&f.root.join(&backup)));
            assert!(authority.allows_remove_staging(&f.root.join(backup)));
        }
        let foreign = f
            .root
            .join(format!(".voktty-migration-{}-0", uuid::Uuid::new_v4()));
        assert!(!authority.allows_create(&foreign));
        assert!(!authority.allows_remove_staging(&foreign));
    });
}

#[test]
fn captured_write_authority_retires_with_either_source_or_the_original_review() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&f, &mut owner, &selected, RootLinks::default()).await;
        for retired in 0..3 {
            let origin = access(&f.root);
            let destination = access(&f.root);
            let live = Arc::new(AtomicBool::new(true));
            let authority = NativeMemoryWriteAuthority::capture(
                &f.registry,
                owner.preview(&selected, &receipt).unwrap(),
                origin.clone(),
                destination.clone(),
                &live,
            )
            .unwrap();
            assert!(authority.allows_create(&f.root.join(".voktty/INIT.md")));
            match retired {
                0 => origin.live.store(false, Ordering::Release),
                1 => destination.live.store(false, Ordering::Release),
                _ => live.store(false, Ordering::Release),
            }
            assert!(!authority.allows_create(&f.root.join(".voktty/INIT.md")));
            let replacement = Arc::new(AtomicBool::new(true));
            assert!(!authority.allows_create(&f.root.join(".voktty/INIT.md")));
            drop(replacement);
        }
        let live = Arc::new(AtomicBool::new(true));
        let authority = capture(&f, owner.preview(&selected, &receipt).unwrap(), &live);
        drop(live);
        assert!(!authority.allows_create(&f.root.join(".voktty/INIT.md")));
    });
}

#[test]
fn confirmation_requires_new_write_registry_grants_and_consumes_denied_acceptance() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&f, &mut owner, &selected, RootLinks::default()).await;
        let ungranted = WorkspaceRegistry::default();
        assert!(matches!(
            owner.confirm_preview(&selected, &receipt, &ungranted, DiscoveryControl::default()),
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Denied
            )))
        ));
        assert!(!owner.is_preview_current(&selected, &receipt));
        assert!(cancelled(&owner.confirm_preview(
            &selected,
            &receipt,
            &f.registry,
            DiscoveryControl::default()
        )));
        assert!(!f.root.join(".voktty").exists());
        assert!(!ungranted.is_authorized(&f.root));
    });
}

#[test]
fn confirmation_uses_original_canonical_destination_even_when_the_requested_root_is_an_alias() {
    let f = fixture();
    let actual = f.root.join("actual");
    fs::create_dir(&actual).unwrap();
    std::os::unix::fs::symlink(&actual, f.root.join("picked")).unwrap();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let mut input = request(&f, RootLinks::default());
        input.destination = f.root.join("picked");
        let prepared = owner
            .prepare_preview(&selected, &f.registry, input)
            .unwrap()
            .finish()
            .await
            .unwrap();
        let receipt = owner.accept_preview(&selected, prepared).unwrap();
        assert_eq!(
            owner
                .preview(&selected, &receipt)
                .unwrap()
                .write_requirements()
                .root,
            actual
        );
        owner
            .confirm_preview(
                &selected,
                &receipt,
                &f.registry,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(actual.join(".voktty/kit.json").exists());
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn production_confirmation_migrates_opted_in_rules_and_preserves_reserved_content() {
    let f = fixture();
    fs::create_dir_all(f.root.join(".voktty/sessions")).unwrap();
    fs::write(f.root.join(".voktty/.gitignore"), "*\r\n").unwrap();
    fs::write(f.root.join(".voktty/sessions/private"), b"reserved\xff\0").unwrap();
    fs::write(f.root.join(".voktty/tasks.json"), b"private task bytes").unwrap();
    fs::write(f.root.join("AGENTS.md"), "owner rules\r\n").unwrap();
    fs::write(f.root.join("CLAUDE.md"), "owner Claude rules\r\n").unwrap();
    let before = f.store.load().unwrap();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(
            &f,
            &mut owner,
            &selected,
            RootLinks {
                agents: true,
                claude: true,
            },
        )
        .await;
        let report = owner
            .confirm_preview(
                &selected,
                &receipt,
                &f.registry,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(report.migrated.len(), 3);
        assert_eq!(report.cleaned.len(), 3);
        assert!(f.root.join(".voktty/kit.json").exists());
        assert!(fs::read_to_string(f.root.join("AGENTS.md"))
            .unwrap()
            .starts_with("owner rules\r\n"));
        let receipt = prepare(
            &f,
            &mut owner,
            &selected,
            RootLinks {
                agents: true,
                claude: true,
            },
        )
        .await;
        let live = Arc::new(AtomicBool::new(true));
        let authority = capture(&f, owner.preview(&selected, &receipt).unwrap(), &live);
        assert!(!authority.allows_create(&f.root.join(".voktty/INIT.md")));
        assert!(!authority.allows_replace(&f.root.join("AGENTS.md")));
        let report = owner
            .confirm_preview(
                &selected,
                &receipt,
                &f.registry,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(report.created.is_empty());
        assert!(report.migrated.is_empty());
        assert!(!report.skipped.is_empty());
    });
    assert_eq!(
        fs::read(f.root.join(".voktty/sessions/private")).unwrap(),
        b"reserved\xff\0"
    );
    assert_eq!(
        fs::read(f.root.join(".voktty/tasks.json")).unwrap(),
        b"private task bytes"
    );
    assert_eq!(f.store.load().unwrap(), before);
}

struct Interrupt {
    root: PathBuf,
}
impl MemoryWriteAccess for Interrupt {
    fn allows_create(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
            && !(path.ends_with("RULES.md") && self.root.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
}

#[test]
fn recovery_confirmation_cleans_only_recorded_original_backups_without_replacing_skipped_targets() {
    let f = fixture();
    fs::create_dir(f.root.join(".voktty")).unwrap();
    fs::write(f.root.join(".voktty/.gitignore"), "*\n").unwrap();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&f, &mut owner, &selected, RootLinks::default()).await;
        let failure = owner
            .publish_preview(
                &selected,
                &receipt,
                Arc::new(Interrupt {
                    root: f.root.clone(),
                }),
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap_err();
        let MemoryDeploymentWorkError::Publication(failure) = failure else {
            panic!("partial migration expected")
        };
        assert_eq!(failure.migrated, vec![".voktty/.gitignore"]);
        let receipt = prepare(&f, &mut owner, &selected, RootLinks::default()).await;
        let preview = owner.preview(&selected, &receipt).unwrap();
        assert!(preview.is_resuming());
        let backup = preview.recovery_files()[0].path.clone();
        let live = Arc::new(AtomicBool::new(true));
        let authority = capture(&f, preview, &live);
        assert!(authority.allows_remove_staging(&f.root.join(&backup)));
        assert!(!authority.allows_create(&f.root.join(&backup)));
        assert!(!authority.allows_replace(&f.root.join(".voktty/.gitignore")));
        let report = owner
            .confirm_preview(
                &selected,
                &receipt,
                &f.registry,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(report.cleaned, vec![backup.clone()]);
        assert!(!f.root.join(backup).exists());
        assert!(f.root.join(".voktty/kit.json").exists());
    });
}

#[test]
fn write_registry_snapshot_limits_fail_closed_without_reusing_read_grants() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&f, &mut owner, &selected, RootLinks::default()).await;
        for index in 0..256 {
            let path = f.root.join(format!("root{index}"));
            fs::create_dir(&path).unwrap();
            f.registry.authorize(&path).unwrap();
        }
        assert!(matches!(
            owner.confirm_preview(
                &selected,
                &receipt,
                &f.registry,
                DiscoveryControl::default()
            ),
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Limit
            )))
        ));
        assert!(!owner.is_preview_current(&selected, &receipt));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn window_confirmation_rejects_foreign_owners_and_never_reaccepts_a_consumed_review() {
    let f = fixture();
    let (app, window) = NativeMemoryApplication::test_origin(NativeMemoryStorage::test_origin(
        f._state.path().to_owned(),
    ));
    let (foreign, foreign_window) = NativeMemoryApplication::test_origin(
        NativeMemoryStorage::test_origin(f._state.path().to_owned()),
    );
    let presentation = app.open_presentation(&window).unwrap();
    let selected = app
        .select(
            &window,
            &presentation,
            &f.registry,
            f.root.clone(),
            &WorkspaceEnv::Local,
        )
        .unwrap();
    runtime().block_on(async {
        let prepared = app
            .prepare_preview(
                &window,
                &presentation,
                &selected,
                &f.registry,
                request(&f, RootLinks::default()),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let receipt = app
            .accept_preview(&window, &presentation, &selected, prepared)
            .unwrap();
        assert!(cancelled(&app.confirm_preview(
            &foreign_window,
            &presentation,
            &selected,
            &receipt,
            &f.registry,
            DiscoveryControl::default()
        )));
        assert!(cancelled(&foreign.confirm_preview(
            &window,
            &presentation,
            &selected,
            &receipt,
            &f.registry,
            DiscoveryControl::default()
        )));
        assert!(app.is_preview_current(&window, &presentation, &selected, &receipt));
        let job = app
            .confirm_preview(
                &window,
                &presentation,
                &selected,
                &receipt,
                &f.registry,
                DiscoveryControl::default(),
            )
            .unwrap();
        assert!(cancelled(&app.confirm_preview(
            &window,
            &presentation,
            &selected,
            &receipt,
            &f.registry,
            DiscoveryControl::default()
        )));
        job.finish().await.unwrap();
    });
}

#[test]
fn scope_construction_rejects_secret_paths_system_roots_and_unbounded_purposes() {
    let make = |root: &str, create: Vec<String>| PublicationWriteRequirements {
        root: root.into(),
        create,
        replace: vec![],
        recovery: vec![],
    };
    for root in [
        "/system/project",
        "/usr/bin/project",
        "/etc/project",
        "/project/.ssh",
    ] {
        assert!(matches!(
            WriteScope::build(make(root, vec![".voktty/INIT.md".into()])),
            Err(ReadError::Denied)
        ));
    }
    for path in [
        ".env",
        ".ssh/config",
        ".git/config",
        "credentials",
        "../outside",
        "/outside",
    ] {
        assert!(WriteScope::build(make("/work/project", vec![path.into()])).is_err());
    }
    assert!(matches!(
        WriteScope::build(make("/work/project", vec!["file".into(); 129])),
        Err(ReadError::Limit)
    ));
    let deeply_nested = (0..8)
        .map(|index| format!("root{index}/{}file", "a/".repeat(100)))
        .collect();
    assert!(matches!(
        WriteScope::build(make("/work/project", deeply_nested)),
        Err(ReadError::Limit)
    ));
}
