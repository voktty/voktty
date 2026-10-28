use super::*;

#[test]
fn window_replacement_never_revives_receipts_or_accepts_stale_cleanup() {
    let mut owners = NativeMemoryOwners::default();
    let first = owners.register_window("main").unwrap();
    let old = owners.open_presentation(&first).unwrap();
    let second = owners.register_window("main").unwrap();
    let current = owners.open_presentation(&second).unwrap();
    assert!(!owners.retire_window(&first));
    assert!(!owners.close_presentation(&first, &old));
    assert!(owners.selection(&second, &old).is_err());
    assert!(owners.selection(&second, &current).is_ok());
    assert!(owners.open_presentation(&first).is_err());
    assert!(owners.retire_window(&second));
    assert!(!owners.retire_window(&second));
}

#[test]
fn presentations_cannot_cross_windows_or_registries() {
    let mut owners = NativeMemoryOwners::default();
    let a = owners.register_window("a").unwrap();
    let b = owners.register_window("b").unwrap();
    let presentation = owners.open_presentation(&a).unwrap();
    assert!(owners.selection(&b, &presentation).is_err());
    assert!(!owners.close_presentation(&b, &presentation));
    let mut foreign = NativeMemoryOwners::default();
    let same_label = foreign.register_window("a").unwrap();
    assert!(foreign.selection(&same_label, &presentation).is_err());
    assert!(foreign.open_presentation(&a).is_err());
    assert!(!owners.retire_window(&same_label));
    assert!(owners.selection(&a, &presentation).is_ok());
    assert!(owners.close_presentation(&a, &presentation));
    let replacement = owners.open_presentation(&a).unwrap();
    assert!(!owners.close_presentation(&a, &presentation));
    assert!(owners.selection(&a, &replacement).is_ok());
}

#[test]
fn registry_limits_reject_without_evicting_and_release_exact_capacity() {
    let mut owners = NativeMemoryOwners::default();
    let mut windows = Vec::new();
    for index in 0..64 {
        windows.push(owners.register_window(&format!("window-{index}")).unwrap());
    }
    assert!(matches!(
        owners.register_window("overflow"),
        Err(MemoryWorkError::Read(ReadError::Limit))
    ));
    for label in ["", "bad label", "bad\nlabel", &"a".repeat(129)] {
        assert!(matches!(
            owners.register_window(label),
            Err(MemoryWorkError::Read(ReadError::InvalidInput))
        ));
    }
    let mut presentations = Vec::new();
    for index in 0..256 {
        presentations.push(owners.open_presentation(&windows[index % 64]).unwrap());
    }
    assert!(matches!(
        owners.open_presentation(&windows[0]),
        Err(MemoryWorkError::Read(ReadError::Limit))
    ));
    assert!(owners.close_presentation(&windows[0], &presentations[0]));
    assert!(owners.open_presentation(&windows[1]).is_ok());
    let replacement = owners.register_window("window-0").unwrap();
    assert!(!owners.retire_window(&windows[0]));
    for _ in 0..3 {
        owners.open_presentation(&replacement).unwrap();
    }
    assert!(matches!(
        owners.open_presentation(&replacement),
        Err(MemoryWorkError::Read(ReadError::Limit))
    ));
    assert!(owners.retire_window(&windows[63]));
    assert!(owners.register_window("overflow").is_ok());
}

#[test]
fn owner_retirement_suppresses_admitted_results_without_affecting_other_windows() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    let (_state, store) = store();
    runtime().block_on(async {
        for retirement in 0..4 {
            let mut owners = NativeMemoryOwners::default();
            let window = owners.register_window("main").unwrap();
            let presentation = owners.open_presentation(&window).unwrap();
            let selected = owners
                .select(
                    &window,
                    &presentation,
                    &registry,
                    root.clone(),
                    &WorkspaceEnv::Local,
                )
                .unwrap();
            let other = owners.register_window("other").unwrap();
            let other_presentation = owners.open_presentation(&other).unwrap();
            let other_selected = owners
                .select(
                    &other,
                    &other_presentation,
                    &registry,
                    root.clone(),
                    &WorkspaceEnv::Local,
                )
                .unwrap();
            let read = owners
                .selection(&window, &presentation)
                .unwrap()
                .context(&selected, store.clone(), None, ReadControl::default())
                .unwrap();
            match retirement {
                0 => {
                    assert!(owners.close_presentation(&window, &presentation));
                }
                1 => {
                    assert!(owners.retire_window(&window));
                }
                2 => {
                    owners.register_window("main").unwrap();
                }
                _ => {
                    assert!(owners
                        .select(
                            &window,
                            &presentation,
                            &registry,
                            root.clone(),
                            &WorkspaceEnv::Wsl {
                                distro: "unavailable".into()
                            }
                        )
                        .is_err());
                }
            }
            assert!(matches!(
                read.finish().await,
                Err(MemoryWorkError::Read(ReadError::Cancelled))
            ));
            let current = owners.selection(&other, &other_presentation).unwrap();
            assert!(current.is_current(&other_selected));
            let observation = current
                .context(&other_selected, store.clone(), None, ReadControl::default())
                .unwrap()
                .finish()
                .await
                .unwrap();
            assert!(
                matches!(observation.project, PathFact::File { text } if text == "native project")
            );
            let read = current
                .scope(
                    &other_selected,
                    store.clone(),
                    DiscoveryPurpose::Discover,
                    DiscoveryControl::default(),
                )
                .unwrap();
            drop(owners);
            assert!(matches!(
                read.finish().await,
                Err(MemoryWorkError::Read(ReadError::Cancelled))
            ));
        }
    });
}
