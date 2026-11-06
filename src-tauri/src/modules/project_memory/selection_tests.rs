use super::*;

#[test]
fn selection_receipts_never_revive_on_a_project_round_trip() {
    let a = project();
    let b = project();
    let registry = WorkspaceRegistry::default();
    let a = registry.authorize(a.path()).unwrap();
    let b = registry.authorize(b.path()).unwrap();
    let mut owner = NativeMemorySelection::default();
    let first = owner
        .select(&registry, a.clone(), &WorkspaceEnv::Local)
        .unwrap();
    let second = owner.select(&registry, b, &WorkspaceEnv::Local).unwrap();
    let third = owner.select(&registry, a, &WorkspaceEnv::Local).unwrap();
    assert!(!owner.is_current(&first));
    assert!(!owner.is_current(&second));
    assert!(owner.is_current(&third));
    assert!(!owner.clear(&first));
    assert!(!owner.clear(&second));
    assert!(owner.is_current(&third));
    assert!(owner.clear(&third));
    assert!(!owner.clear(&third));
    assert!(!owner.is_current(&third));
}

#[test]
fn same_path_in_another_owner_cannot_borrow_or_clear_a_selection() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let mut first = NativeMemorySelection::default();
    let mut second = NativeMemorySelection::default();
    let first_receipt = first
        .select(&registry, root.clone(), &WorkspaceEnv::Local)
        .unwrap();
    let second_receipt = second
        .select(&registry, root, &WorkspaceEnv::Local)
        .unwrap();
    assert!(!first.is_current(&second_receipt));
    assert!(!second.clear(&first_receipt));
    drop(first);
    assert!(second.is_current(&second_receipt));
}

#[test]
fn failed_selection_retires_the_old_destination_without_authorizing_the_new_one() {
    let dir = project();
    let outside = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let mut owner = NativeMemorySelection::default();
    for (path, environment, error) in [
        (
            outside.path().to_path_buf(),
            WorkspaceEnv::Local,
            ReadError::Denied,
        ),
        (
            root.clone(),
            WorkspaceEnv::Wsl {
                distro: "unavailable".into(),
            },
            ReadError::Unsupported,
        ),
        (
            PathBuf::from(format!("{}{}..", root.display(), std::path::MAIN_SEPARATOR)),
            WorkspaceEnv::Local,
            ReadError::InvalidInput,
        ),
    ] {
        let old = owner
            .select(&registry, root.clone(), &WorkspaceEnv::Local)
            .unwrap();
        assert!(
            matches!(owner.select(&registry, path, &environment), Err(MemoryWorkError::Read(actual)) if actual == error)
        );
        assert!(!owner.is_current(&old));
    }
    assert!(!registry.is_authorized(outside.path()));
    assert!(!dir.path().join(".voktty").exists());
    assert!(!outside.path().join(".voktty").exists());
}

#[test]
fn stale_receipts_cannot_admit_scope_or_documents_work() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let mut owner = NativeMemorySelection::default();
    let stale = owner
        .select(&registry, root.clone(), &WorkspaceEnv::Local)
        .unwrap();
    let current = owner
        .select(&registry, root.clone(), &WorkspaceEnv::Local)
        .unwrap();
    // Rejection must precede worker admission.
    assert!(matches!(
        owner.inspect_scope(&stale, DiscoveryControl::default()),
        Err(MemoryWorkError::Read(ReadError::Cancelled))
    ));
    assert!(matches!(
        owner.documents(
            &stale,
            root.to_str().unwrap().into(),
            DiscoveryControl::default()
        ),
        Err(MemoryWorkError::Read(ReadError::Cancelled))
    ));
    assert!(owner.is_current(&current));
}

#[test]
fn selection_change_retires_admitted_inspection_and_preserves_the_new_reader() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    runtime().block_on(async {
        let mut owner = NativeMemorySelection::default();
        let old = owner
            .select(&registry, root.clone(), &WorkspaceEnv::Local)
            .unwrap();
        let read = owner
            .inspect_scope(&old, DiscoveryControl::default())
            .unwrap();
        let current = owner.select(&registry, root, &WorkspaceEnv::Local).unwrap();
        assert!(matches!(
            read.finish().await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
        let observation = owner
            .inspect_scope(&current, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(observation.scope.state, "incomplete");
        assert!(owner.is_current(&current));
        drop(owner);
    });
}

#[test]
fn dropping_selection_retires_its_admitted_scope_even_if_receipts_survive() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    runtime().block_on(async {
        let mut owner = NativeMemorySelection::default();
        let receipt = owner.select(&registry, root, &WorkspaceEnv::Local).unwrap();
        let read = owner
            .inspect_scope(&receipt, DiscoveryControl::default())
            .unwrap();
        drop(owner);
        assert!(matches!(
            read.finish().await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
    });
}
