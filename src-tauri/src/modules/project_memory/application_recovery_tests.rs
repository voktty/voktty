use super::*;

struct InterruptedMigration(PathBuf);
impl MemoryWriteAccess for InterruptedMigration {
    fn allows_create(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
            && !(path.ends_with("RULES.md") && self.0.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
}

async fn interrupted(f: &Fixture) -> String {
    fs::create_dir(f.root.join(".voktty")).unwrap();
    fs::write(f.root.join(".voktty/.gitignore"), "*\r\n").unwrap();
    let source =
        NativeMemorySource::capture(&f.registry, f.root.clone(), &WorkspaceEnv::Local).unwrap();
    let input = values();
    let preview = MemoryWorkers::default()
        .preview_project_at_root(
            voktty_memory_local::ProjectInitializationRequest {
                origin: f.root.clone(),
                origin_access: source.access.clone(),
                destination: f.root.clone(),
                destination_access: source.access.clone(),
                inputs: input.inputs,
                links: input.links,
            },
            DiscoveryControl::default(),
        )
        .unwrap()
        .finish()
        .await
        .unwrap();
    let digest = preview.acceptance_digest();
    let failure = preview
        .publish(
            &digest,
            &InterruptedMigration(f.root.clone()),
            &DiscoveryControl::default(),
        )
        .unwrap_err();
    let backup = failure
        .possible_recovery_files
        .iter()
        .find(|path| path.contains(".voktty-migration-"))
        .unwrap()
        .clone();
    assert_eq!(fs::read(f.root.join(&backup)).unwrap(), b"*\r\n");
    fs::remove_file(f.root.join(".voktty/.gitignore")).unwrap();
    backup
}

fn recovery_target(f: &Fixture) -> NativeMemoryRecoveryTarget {
    NativeMemoryRecoveryTarget {
        destination: f.root.clone(),
        environment: WorkspaceEnv::Local,
        control: DiscoveryControl::default(),
    }
}
fn reserve_recovery(f: &Fixture) -> NativeMemoryRecoveryReceipt {
    f.app
        .reserve_recovery(
            &f.window,
            &f.presentation,
            &f.selected,
            &f.registry,
            recovery_target(f),
        )
        .unwrap()
}
async fn recovery_read(f: &Fixture) -> NativeMemoryRecoveryRead {
    let reserved = reserve_recovery(f);
    f.app
        .start_recovery(&f.window, &f.presentation, &f.selected, &reserved)
        .unwrap()
}
async fn ready_recovery(f: &Fixture) -> NativeMemoryRecoveryReceipt {
    let prepared = recovery_read(f).await.finish().await.unwrap();
    f.app
        .accept_recovery(&f.window, &f.presentation, &f.selected, prepared)
        .unwrap()
}
fn snapshot(f: &Fixture, receipt: &NativeMemoryRecoveryReceipt) -> NativeMemoryRecoverySnapshot {
    f.app
        .recovery_snapshot(&f.window, &f.presentation, &f.selected, receipt)
        .unwrap()
}
fn confirm(
    f: &Fixture,
    receipt: &NativeMemoryRecoveryReceipt,
    digest: String,
) -> Result<NativeMemoryRestoration, MemoryDeploymentWorkError> {
    f.app.confirm_recovery(
        &f.window,
        &f.presentation,
        &f.selected,
        receipt,
        &f.registry,
        NativeMemoryRecoveryConfirmation {
            digest,
            control: DiscoveryControl::default(),
        },
    )
}

#[test]
fn recovery_confirmation_completes_project_without_changing_global_settings() {
    let f = fixture();
    runtime().block_on(async {
        let backup = interrupted(&f).await;
        let before = f.store.load().unwrap();
        let receipt = ready_recovery(&f).await;
        let mut display = snapshot(&f, &receipt);
        assert_eq!(display.root, f.root);
        assert_eq!(display.entries[0].backup, backup);
        display.entries[0].text = "forged display".into();
        let job = confirm(&f, &receipt, display.digest).unwrap();
        assert!(cancelled(&confirm(&f, &receipt, invalid_digest())));
        let report = job.finish().await.unwrap();
        assert!(report
            .created
            .iter()
            .any(|path| path == ".voktty/.gitignore"));
        assert!(report.cleaned.contains(&backup));
        assert!(report
            .migrated
            .iter()
            .any(|path| path == ".voktty/.gitignore"));
        assert!(!fs::read_to_string(f.root.join(".voktty/.gitignore"))
            .unwrap()
            .contains("forged display"));
        assert_eq!(f.store.load().unwrap(), before);
        assert!(!f
            .parent
            .path()
            .join("project-memory/memory-deployment.json")
            .exists());
        assert!(f.root.join(".voktty/kit.json").exists());
        assert!(!f.root.join(".voktty/.initialization.json").exists());
        assert!(cancelled(&f.app.recovery_snapshot(
            &f.window,
            &f.presentation,
            &f.selected,
            &receipt
        )));
    });
}
fn invalid_digest() -> String {
    "0".repeat(64)
}

#[test]
fn failed_destination_capture_and_expired_start_retire_the_previous_recovery() {
    let f = fixture();
    runtime().block_on(async {
        interrupted(&f).await;
        let old = ready_recovery(&f).await;
        let mut target = recovery_target(&f);
        target.environment = WorkspaceEnv::Wsl {
            distro: "unavailable".into(),
        };
        assert!(f
            .app
            .reserve_recovery(&f.window, &f.presentation, &f.selected, &f.registry, target)
            .is_err());
        assert!(!f
            .app
            .is_recovery_current(&f.window, &f.presentation, &f.selected, &old));
        let mut target = recovery_target(&f);
        target.control = DiscoveryControl::new(Duration::ZERO);
        let receipt = f
            .app
            .reserve_recovery(&f.window, &f.presentation, &f.selected, &f.registry, target)
            .unwrap();
        assert!(matches!(
            f.app
                .start_recovery(&f.window, &f.presentation, &f.selected, &receipt),
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Timeout
            )))
        ));
        assert!(!f
            .app
            .is_recovery_current(&f.window, &f.presentation, &f.selected, &receipt));
    });
}

#[test]
fn changed_target_failure_preserves_foreign_bytes_and_requires_fresh_acceptance() {
    let f = fixture();
    runtime().block_on(async {
        let backup = interrupted(&f).await;
        let receipt = ready_recovery(&f).await;
        let digest = snapshot(&f, &receipt).digest;
        fs::write(f.root.join(".voktty/.gitignore"), "foreign bytes").unwrap();
        let error = confirm(&f, &receipt, digest)
            .unwrap()
            .finish()
            .await
            .unwrap_err();
        let MemoryDeploymentWorkError::Publication(failure) = error else {
            panic!("restoration report required")
        };
        assert!(failure.created.is_empty());
        assert!(failure.cleaned.is_empty());
        assert_eq!(
            fs::read(f.root.join(".voktty/.gitignore")).unwrap(),
            b"foreign bytes"
        );
        assert_eq!(fs::read(f.root.join(backup)).unwrap(), b"*\r\n");
        assert!(cancelled(&confirm(&f, &receipt, invalid_digest())));
    });
}

#[test]
fn recovery_reservation_starts_once_and_late_prepared_results_cannot_replace_successors() {
    let f = fixture();
    runtime().block_on(async {
        interrupted(&f).await;
        let read = recovery_read(&f).await;
        let old = read.receipt();
        assert!(cancelled(&f.app.start_recovery(
            &f.window,
            &f.presentation,
            &f.selected,
            &old
        )));
        assert!(cancelled(&confirm(&f, &old, invalid_digest())));
        let prepared = read.finish().await.unwrap();
        let current = ready_recovery(&f).await;
        assert!(cancelled(&f.app.accept_recovery(
            &f.window,
            &f.presentation,
            &f.selected,
            prepared
        )));
        assert!(!f
            .app
            .cancel_recovery(&f.window, &f.presentation, &f.selected, &old)
            .unwrap());
        assert!(f
            .app
            .is_recovery_current(&f.window, &f.presentation, &f.selected, &current));
        let publication = reserve(&f);
        assert!(!f
            .app
            .is_recovery_current(&f.window, &f.presentation, &f.selected, &current));
        reserve_recovery(&f);
        assert!(!f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &publication));
    });
}

#[test]
fn recovery_cannot_borrow_foreign_windows_presentations_or_same_path_selections() {
    let f = fixture();
    runtime().block_on(async {
        interrupted(&f).await;
        let receipt = ready_recovery(&f).await;
        let (foreign, foreign_window) = NativeMemoryApplication::test_origin();
        assert!(cancelled(&foreign.recovery_snapshot(
            &f.window,
            &f.presentation,
            &f.selected,
            &receipt
        )));
        assert!(cancelled(&f.app.recovery_snapshot(
            &foreign_window,
            &f.presentation,
            &f.selected,
            &receipt
        )));
        let other = f.app.open_presentation(&f.window).unwrap();
        let selected = f
            .app
            .select(
                &f.window,
                &other,
                &f.registry,
                f.root.clone(),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        assert!(cancelled(
            &f.app
                .recovery_snapshot(&f.window, &other, &selected, &receipt)
        ));
        assert!(!f
            .app
            .cancel_recovery(&f.window, &other, &selected, &receipt)
            .unwrap());
        assert!(f
            .app
            .is_recovery_current(&f.window, &f.presentation, &f.selected, &receipt));
    });
}

#[test]
fn invalid_confirmation_and_failed_admission_consume_recovery_without_moving_original() {
    for invalid in [false, true] {
        let f = fixture();
        let (backup, receipt, digest) = runtime().block_on(async {
            let backup = interrupted(&f).await;
            let receipt = ready_recovery(&f).await;
            let digest = snapshot(&f, &receipt).digest;
            (backup, receipt, digest)
        });
        if invalid {
            runtime().block_on(async {
                assert!(matches!(
                    confirm(&f, &receipt, "wrong".into()),
                    Err(MemoryDeploymentWorkError::Preview(
                        PublicationError::StalePreview
                    ))
                ));
            });
        } else {
            assert!(matches!(
                confirm(&f, &receipt, digest),
                Err(MemoryDeploymentWorkError::Worker(
                    MemoryWorkError::RuntimeUnavailable
                ))
            ));
        }
        assert!(!f
            .app
            .is_recovery_current(&f.window, &f.presentation, &f.selected, &receipt));
        assert_eq!(fs::read(f.root.join(backup)).unwrap(), b"*\r\n");
        assert!(!f.root.join(".voktty/.gitignore").exists());
    }
}

#[test]
fn native_retirement_rejects_recovery_results_even_after_the_read_finished() {
    for mode in 0..5 {
        let f = fixture();
        runtime().block_on(async {
            let backup = interrupted(&f).await;
            let prepared = recovery_read(&f).await.finish().await.unwrap();
            match mode {
                0 => {
                    f.app
                        .select(
                            &f.window,
                            &f.presentation,
                            &f.registry,
                            f.root.clone(),
                            &WorkspaceEnv::Local,
                        )
                        .unwrap();
                }
                1 => {
                    f.app
                        .close_presentation(&f.window, &f.presentation)
                        .unwrap();
                }
                2 => {
                    let _replacement = f.app.register_window("main").unwrap();
                }
                3 => {
                    f.window.retire();
                }
                _ => f.app.shutdown(),
            }
            assert!(cancelled(&f.app.accept_recovery(
                &f.window,
                &f.presentation,
                &f.selected,
                prepared
            )));
            assert_eq!(fs::read(f.root.join(backup)).unwrap(), b"*\r\n");
            assert!(!f.root.join(".voktty/.gitignore").exists());
        });
    }
}

#[test]
fn closing_presentation_retires_queued_restoration_without_moving_original() {
    let f = fixture();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let backup = interrupted(&f).await;
        let receipt = ready_recovery(&f).await;
        let digest = snapshot(&f, &receipt).digest;
        let gate = Arc::new(Gate::new());
        let release = Release(gate.clone());
        let (started, observed) = mpsc::channel();
        let occupied = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            gate.wait();
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let job = confirm(&f, &receipt, digest).unwrap();
        f.app
            .close_presentation(&f.window, &f.presentation)
            .unwrap();
        assert!(cancelled(&job.finish().await));
        drop(release);
        occupied.await.unwrap();
        assert_eq!(fs::read(f.root.join(backup)).unwrap(), b"*\r\n");
        assert!(!f.root.join(".voktty/.gitignore").exists());
    });
}
