use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime, store};
use std::fs;

fn inspecting(registry: &WorkspaceRegistry, root: &Path) -> NativeMemorySource {
    NativeMemorySource::capture_with_inspection(
        registry,
        root.into(),
        &WorkspaceEnv::Local,
        Some(native_spelling(root).unwrap()),
    )
    .unwrap()
}

#[test]
fn inspection_grants_only_exact_ancestor_metadata_marker_reads_and_kit_entry_names() {
    let dir = project();
    let root = dir.path().join("project");
    fs::create_dir(&root).unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(root).unwrap();
    let source = inspecting(&registry, &root);
    let parent = root.parent().unwrap();
    let access = source.access.clone();
    for ancestor in root.ancestors().skip(1) {
        assert!(access.allows_metadata(ancestor));
        assert!(access.allows_metadata(&ancestor.join(".voktty")));
        assert!(access.allows_metadata(&ancestor.join(".voktty/sessions")));
        assert!(access.allows_metadata(&ancestor.join(".voktty/.env")));
        assert!(access.allows_read(&ancestor.join(".voktty/kit.json")));
        assert!(access.allows_enumeration(&ancestor.join(".voktty")));
        assert!(!access.allows_workspace_root(ancestor));
        assert!(!access.allows_read(ancestor));
        assert!(!access.allows_enumeration(ancestor));
        for path in [
            "README.md",
            ".env",
            ".voktty/INIT.md",
            ".voktty/state/preferences.json",
            ".voktty/sessions/one.json",
        ] {
            assert!(!access.allows_read(&ancestor.join(path)));
        }
        assert!(!access.allows_metadata(&ancestor.join(".voktty/state/preferences.json")));
        assert!(!access.allows_metadata(&ancestor.join("sibling")));
        assert!(!access.allows_enumeration(&ancestor.join(".voktty/sessions")));
    }
    assert!(!registry.is_authorized(parent));
    assert!(!registry.is_authorized(&parent.join("sibling")));
    assert!(access.allows_workspace_root(&root));
    assert!(access.allows_read(&root.join(".voktty/PROJECT.md")));
    drop(source);
    assert!(!access.allows_metadata(parent));
    assert!(!access.allows_read(&parent.join(".voktty/kit.json")));
    assert!(!access.allows_enumeration(&parent.join(".voktty")));
}

#[cfg(target_os = "linux")]
#[test]
fn explicit_inspection_completes_ancestry_without_registering_parents_or_changing_private_state() {
    let dir = project();
    let root = dir.path().join("project");
    fs::create_dir(&root).unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(root).unwrap();
    let (state, store) = store();
    let preferences = fs::read(state.path().join("memory-local.json")).unwrap();
    runtime().block_on(async {
        let ordinary =
            NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local).unwrap();
        let before = ordinary
            .scope(
                store.clone(),
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(!before.scope.ancestry_complete);
        let source = inspecting(&registry, &root);
        let observed = source
            .scope(
                store.clone(),
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(observed.scope.ancestry_complete);
        assert_eq!(observed.scope.initialization, "clear");
        let retained = ordinary
            .scope(
                store,
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(!retained.scope.ancestry_complete);
    });
    assert!(!registry.is_authorized(root.parent().unwrap()));
    assert!(!root.join(".voktty").exists());
    assert_eq!(
        fs::read(state.path().join("memory-local.json")).unwrap(),
        preferences
    );
}

#[cfg(target_os = "linux")]
#[test]
fn parent_memory_and_reserved_or_partial_folders_remain_distinct_without_reading_instructions() {
    let dir = project();
    let root = dir.path().join("project");
    fs::create_dir(&root).unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(root).unwrap();
    let (_state, store) = store();
    runtime().block_on(async {
        fs::create_dir_all(dir.path().join(".voktty/sessions")).unwrap();
        fs::write(dir.path().join(".voktty/.gitignore"), "*\n").unwrap();
        let source = inspecting(&registry, &root);
        let reserved = source
            .scope(
                store.clone(),
                DiscoveryPurpose::Discover,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(reserved.scope.ancestry_complete);
        assert!(reserved
            .directories
            .iter()
            .any(|d| d.path == dir.path() && d.state == "reserved"));
        fs::write(
            dir.path().join(".voktty/PROJECT.md"),
            "private instruction text",
        )
        .unwrap();
        let partial = source
            .scope(
                store.clone(),
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(partial.scope.initialization, "blocked");
        assert!(partial
            .directories
            .iter()
            .any(|d| d.path == dir.path() && d.state == "partial"));
        populate(dir.path());
        let found = source
            .scope(
                store,
                DiscoveryPurpose::Discover,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(found.scope.state, "ready");
        assert_eq!(found.scope.ancestor_kits.len(), 1);
        assert!(!source.access.allows_workspace_root(dir.path()));
        assert!(!source
            .access
            .allows_read(&dir.path().join(".voktty/INIT.md")));
    });
}

#[cfg(unix)]
#[test]
fn parent_marker_links_never_borrow_the_narrow_read_grant() {
    let dir = project();
    let outside = project();
    let root = dir.path().join("project");
    fs::create_dir(&root).unwrap();
    fs::create_dir(dir.path().join(".voktty")).unwrap();
    populate(outside.path());
    std::os::unix::fs::symlink(
        outside.path().join(".voktty/kit.json"),
        dir.path().join(".voktty/kit.json"),
    )
    .unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(root).unwrap();
    let (_state, store) = store();
    runtime().block_on(async {
        let source = inspecting(&registry, &root);
        let observed = source
            .scope(
                store,
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(observed.scope.initialization, "blocked");
        assert!(!observed.scope.ancestry_complete);
    });
    assert!(!registry.is_authorized(outside.path()));
}

#[test]
fn inspection_never_admits_an_unregistered_or_nonlocal_selected_root() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    assert!(matches!(
        NativeMemorySource::capture_with_inspection(
            &registry,
            dir.path().into(),
            &WorkspaceEnv::Local,
            Some(dir.path().into())
        ),
        Err(MemoryWorkError::Read(ReadError::Denied))
    ));
    let root = registry.authorize(dir.path()).unwrap();
    assert!(matches!(
        NativeMemorySource::capture_with_inspection(
            &registry,
            root.clone(),
            &WorkspaceEnv::Wsl {
                distro: "unavailable".into()
            },
            Some(root)
        ),
        Err(MemoryWorkError::Read(ReadError::Unsupported))
    ));
}

#[cfg(target_os = "linux")]
#[test]
fn selecting_again_without_consent_retires_pending_inspection_and_cannot_revive_it() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let (_state, store) = store();
    let mut owner = NativeMemorySelection::default();
    let selected = owner
        .select_with_inspection(&registry, root.clone(), &WorkspaceEnv::Local, true)
        .unwrap();
    runtime().block_on(async {
        let pending = owner
            .scope(
                &selected,
                store.clone(),
                DiscoveryPurpose::Discover,
                DiscoveryControl::default(),
            )
            .unwrap();
        let ordinary = owner.select(&registry, root, &WorkspaceEnv::Local).unwrap();
        assert!(!owner.is_current(&selected));
        assert!(matches!(
            pending.finish().await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
        let observed = owner
            .scope(
                &ordinary,
                store,
                DiscoveryPurpose::Discover,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(!observed.scope.ancestry_complete);
    });
}
