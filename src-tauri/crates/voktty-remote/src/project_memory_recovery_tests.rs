use super::*;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use voktty_memory_local::MemoryWriteAccess;
use voktty_remote_protocol::{METHOD_MEMORY_MANAGE, PROTOCOL_VERSION};

struct InterruptedWriter(PathBuf);
impl MemoryWriteAccess for InterruptedWriter {
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

struct Fixture {
    project: tempfile::TempDir,
    private: tempfile::TempDir,
    server: MemoryServer,
    handle: Value,
    selection: Value,
    backup: String,
}

impl Fixture {
    fn new(missing: bool) -> Self {
        let project = tempfile::tempdir_in("/dev/shm").unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let mut server = MemoryServer {
            data_directory: Some(private.path().to_owned()),
            ..Default::default()
        };
        let root = project.path();
        fs::create_dir_all(root.join(".voktty/sessions")).unwrap();
        fs::write(root.join(".voktty/sessions/kept.json"), "reserved fixture").unwrap();
        fs::write(root.join(".voktty/.gitignore"), b"*\r\n").unwrap();
        let store = server.store(true, &ReadControl::default()).unwrap();
        let source = Arc::new(Access::new(root.to_owned(), root.to_owned(), true));
        let workspace =
            LocalMemoryWorkspace::open(&store, root, source.as_ref(), &ReadControl::default())
                .unwrap();
        let preview = InitializationPreview::prepare(
            &workspace,
            &workspace,
            json!({"project_name":"Recovery helper","created_at":"2026-11-03"})
                .as_object()
                .unwrap(),
            RootLinks::default(),
            &DiscoveryControl::default(),
        )
        .unwrap()
        .into_owned(store.clone(), source.clone(), source.clone())
        .unwrap();
        let failure = preview
            .publish(
                &InterruptedWriter(root.to_owned()),
                &DiscoveryControl::default(),
            )
            .unwrap_err();
        assert_eq!(failure.possible_recovery_files.len(), 1);
        let backup = failure.possible_recovery_files[0].clone();
        assert_eq!(fs::read(root.join(&backup)).unwrap(), b"*\r\n");
        if missing {
            fs::remove_file(root.join(".voktty/.gitignore")).unwrap();
        }
        let handle = success(&mut server, root, json!({"operation":"open"}));
        let selection = success(
            &mut server,
            root,
            json!({"operation":"select","handle":handle,
            "path":root,"revision":1,"inspectAncestors":true}),
        );
        Self {
            project,
            private,
            server,
            handle,
            selection,
            backup,
        }
    }

    fn call(&mut self, operation: &str, extra: Value) -> Value {
        let mut params =
            json!({"operation":operation,"handle":self.handle,"selection":self.selection});
        if matches!(operation, "select" | "close") {
            params.as_object_mut().unwrap().remove("selection");
        }
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        response(&mut self.server, self.project.path(), params)
    }

    fn review(&mut self, revision: u64) -> Value {
        let reply = self.call("reviewRecovery", json!({"revision":revision}));
        assert_eq!(reply["ok"], true, "{reply}");
        reply["result"].clone()
    }

    fn confirm(&mut self, review: &Value) -> Value {
        self.call(
            "confirmRecovery",
            json!({"review":review["review"],"digest":review["digest"]}),
        )
    }

    fn state(&self, name: &str) -> Vec<u8> {
        fs::read(
            self.private
                .path()
                .join("app.voktty.voktty/project-memory")
                .join(name),
        )
        .unwrap()
    }
}

fn response(server: &mut MemoryServer, root: &Path, params: Value) -> Value {
    let response = server.handle(
        Some(root),
        RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "recovery-fixture".into(),
            method: METHOD_MEMORY_MANAGE.into(),
            params,
        },
    );
    assert!(response.ok, "{:?}", response.error);
    response.result.unwrap()
}

fn success(server: &mut MemoryServer, root: &Path, params: Value) -> Value {
    let reply = response(server, root, params);
    assert_eq!(reply["ok"], true, "{reply}");
    reply["result"].clone()
}

fn fails(reply: Value, code: &str) {
    assert_eq!(reply["ok"], false, "{reply}");
    assert_eq!(reply["error"]["code"], code, "{reply}");
}

#[test]
fn exact_restore_preserves_original_object_state_and_journal_without_publishing() {
    let mut f = Fixture::new(true);
    let intent = f.state("memory-deployment.json");
    let preferences = f.state("memory-local.json");
    let metadata = fs::metadata(f.project.path().join(&f.backup)).unwrap();
    let review = f.review(1);
    assert_eq!(review["root"], json!(f.project.path()));
    assert_eq!(
        review["entries"],
        json!([{"target":".voktty/.gitignore","backup":f.backup,"text":"*\r\n"}])
    );
    assert_eq!(review["digest"].as_str().unwrap().len(), 64);
    fails(
        f.call("confirm", json!({"review":review["review"]})),
        "cancelled",
    );
    let report = f.confirm(&review);
    assert_eq!(report["ok"], true, "{report}");
    assert_eq!(
        report["result"],
        json!({"schema":1,"created":[".voktty/.gitignore"],
        "skipped":[],"migrated":[],"cleaned":[f.backup]})
    );
    let target = f.project.path().join(".voktty/.gitignore");
    let restored = fs::metadata(&target).unwrap();
    assert_eq!(fs::read(target).unwrap(), b"*\r\n");
    assert_eq!(
        (
            restored.ino(),
            restored.mode(),
            restored.uid(),
            restored.gid()
        ),
        (
            metadata.ino(),
            metadata.mode(),
            metadata.uid(),
            metadata.gid()
        )
    );
    assert!(!f.project.path().join(&f.backup).exists());
    assert!(!f.project.path().join(".voktty/kit.json").exists());
    assert_eq!(f.state("memory-deployment.json"), intent);
    assert_eq!(f.state("memory-local.json"), preferences);
    assert_eq!(
        fs::read(f.project.path().join(".voktty/sessions/kept.json")).unwrap(),
        b"reserved fixture"
    );
    fails(f.confirm(&review), "cancelled");
}

#[test]
fn failed_newer_preview_retires_recovery_and_failed_recovery_retires_preview() {
    let mut f = Fixture::new(true);
    let old = f.review(1);
    let preview = json!({"revision":2,"inputs":{"project_name":"Recovery helper","created_at":"2026-11-03"},
        "links":{"agents":false,"claude":false}});
    fails(f.call("preview", preview.clone()), "recoveryRequired");
    fails(f.confirm(&old), "cancelled");
    let fresh = f.review(3);
    fails(f.confirm(&old), "cancelled");
    assert_eq!(f.confirm(&fresh)["ok"], true);

    let mut f = Fixture::new(false);
    let preview = f.call("preview", preview);
    assert_eq!(preview["ok"], true, "{preview}");
    fails(f.call("reviewRecovery", json!({"revision":3})), "conflict");
    fails(
        f.call("confirm", json!({"review":preview["result"]["review"]})),
        "cancelled",
    );
}

#[test]
fn cancellation_fences_earlier_arrivals_without_retiring_a_newer_review() {
    let mut f = Fixture::new(true);
    assert_eq!(
        f.call("cancelRecovery", json!({"revision":3}))["result"],
        false
    );
    fails(f.call("reviewRecovery", json!({"revision":2})), "cancelled");
    let review = f.review(4);
    assert_eq!(
        f.call("cancelRecovery", json!({"revision":3}))["result"],
        false
    );
    fails(
        f.call(
            "confirmRecovery",
            json!({"review":uuid::Uuid::new_v4().to_string(),"digest":review["digest"]}),
        ),
        "cancelled",
    );
    assert_eq!(
        f.call("cancelRecovery", json!({"revision":4}))["result"],
        true
    );
    fails(f.confirm(&review), "cancelled");
    let fresh = f.review(5);
    assert_eq!(f.confirm(&fresh)["ok"], true);
}

#[test]
fn wrong_digest_and_changed_preferences_consume_only_the_original_review() {
    for change_preferences in [false, true] {
        let mut f = Fixture::new(true);
        let review = f.review(1);
        let before = fs::read(f.project.path().join(&f.backup)).unwrap();
        let confirmation = if change_preferences {
            let store = f.server.store(false, &ReadControl::default()).unwrap();
            store
                .set_policy(
                    store.load().unwrap().revision(),
                    &"a".repeat(64),
                    voktty_memory_local::MemoryPolicy::Never,
                )
                .unwrap();
            review.clone()
        } else {
            let mut wrong = review.clone();
            wrong["digest"] = json!("0".repeat(64));
            wrong
        };
        fails(f.confirm(&confirmation), "stale");
        fails(f.confirm(&review), "cancelled");
        assert_eq!(fs::read(f.project.path().join(&f.backup)).unwrap(), before);
        assert!(!f.project.path().join(".voktty/.gitignore").exists());
        let fresh = f.review(2);
        assert_eq!(f.confirm(&fresh)["ok"], true);
    }
}

#[test]
fn retired_selections_presentations_and_helper_generations_cannot_restore() {
    for retirement in ["select", "close", "reset"] {
        let mut f = Fixture::new(true);
        let review = f.review(1);
        match retirement {
            "select" => {
                let root = f.project.path().to_owned();
                assert_eq!(
                    f.call(
                        "select",
                        json!({"path":root,"revision":2,"inspectAncestors":true})
                    )["ok"],
                    true
                );
            }
            "close" => {
                assert_eq!(f.call("close", json!({}))["ok"], true);
            }
            _ => f.server.reset(),
        }
        fails(f.confirm(&review), "cancelled");
        assert_eq!(
            fs::read(f.project.path().join(&f.backup)).unwrap(),
            b"*\r\n"
        );
        assert!(!f.project.path().join(".voktty/.gitignore").exists());
    }
}

#[test]
fn restoration_writes_authorize_only_exact_missing_targets_and_original_backups() {
    let mut f = Fixture::new(true);
    f.review(1);
    let selected = f
        .server
        .presentations
        .values()
        .next()
        .unwrap()
        .selected
        .as_ref()
        .unwrap();
    let Some((_, DeploymentReview::Recovery(review))) = &selected.deployment.current else {
        panic!("missing recovery review");
    };
    let source = selected.source.clone();
    let access = AcceptedRestoration(AcceptedWrites {
        source: source.as_ref(),
        requirements: review.write_requirements(),
    });
    let root = f.project.path();
    let target = root.join(".voktty/.gitignore");
    assert!(access.allows_create(&target));
    assert!(access.allows_remove_staging(&root.join(&f.backup)));
    assert!(!access.allows_replace(&target));
    for path in [
        root.to_owned(),
        root.join(".voktty"),
        root.join("AGENTS.md"),
        root.join(".env"),
        root.join(".voktty/kit.json"),
        root.join(".voktty/.voktty-stage-00000000-0000-4000-8000-000000000004"),
        root.join(".voktty/.voktty-migration-00000000-0000-4000-8000-000000000004-127"),
    ] {
        assert!(!access.allows_create(&path));
        assert!(!access.allows_replace(&path));
        assert!(!access.allows_remove_staging(&path));
    }
    f.server.reset();
    assert!(!access.allows_create(&target));
    assert!(!access.allows_remove_staging(&root.join(&f.backup)));
}
