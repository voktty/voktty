use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime};
use std::fs;

#[test]
fn documents_display_shared_files_without_private_state_or_trust() {
    let (state, app, resource) = super::super::tests::fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    for path in [
        "plans/custom.md",
        "continuity/handoffs/current.md",
        "team/roles/custom.md",
        "archive/old.md",
    ] {
        let path = root.join(".voktty").join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "display café\r\n<script>literal</script>").unwrap();
    }
    for path in [
        "state/private.md",
        "sessions/private.md",
        "tasks/private.md",
        "mailbox/private.md",
        "locks/private.md",
    ] {
        let path = root.join(".voktty").join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "reserved").unwrap();
    }
    let execution = root.join("src");
    fs::create_dir(&execution).unwrap();
    let token = resource
        .select_with_inspection(&app, &registry, execution, &WorkspaceEnv::Local, 1, true)
        .unwrap();
    runtime().block_on(async {
        let reply = read(&app, &resource, &token, root.to_str().unwrap().into())
            .await
            .unwrap();
        assert!(reply.complete);
        assert_eq!(reply.blocked_count, 0);
        let value = serde_json::to_value(reply).unwrap();
        let files = value["files"].as_array().unwrap();
        for path in [
            "plans/custom.md",
            "continuity/handoffs/current.md",
            "team/roles/custom.md",
            "archive/old.md",
        ] {
            let file = files
                .iter()
                .find(|f| f["path"] == format!(".voktty/{path}"))
                .unwrap();
            assert_eq!(
                file["fact"]["text"],
                "display café\r\n<script>literal</script>"
            );
        }
        assert!(files
            .iter()
            .all(|f| !f["path"].as_str().unwrap().ends_with("private.md")));
        assert_eq!(
            files.iter().find(|f| f["path"] == "AGENTS.md").unwrap()["fact"]["kind"],
            "absent"
        );
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        assert_eq!(
            fs::read_to_string(root.join(".voktty/state/private.md")).unwrap(),
            "reserved"
        );
    });
}

#[test]
fn documents_block_links_binary_and_oversized_files_without_reading_reserved_content() {
    let (_state, app, resource) = super::super::tests::fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    let plans = root.join(".voktty/plans");
    fs::create_dir_all(&plans).unwrap();
    fs::write(plans.join("large.md"), vec![b'x'; 256 * 1024 + 1]).unwrap();
    fs::write(plans.join("binary.md"), [255u8, 254]).unwrap();
    fs::write(root.join(".env"), "blocked-document-sentinel-7e5bf6").unwrap();
    std::os::unix::fs::symlink(root.join(".env"), plans.join("linked.md")).unwrap();
    fs::create_dir_all(root.join(".voktty/sessions")).unwrap();
    std::os::unix::fs::symlink(root.join(".env"), root.join(".voktty/sessions/ignored.md"))
        .unwrap();
    let token = resource
        .select_with_inspection(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1, true)
        .unwrap();
    runtime().block_on(async {
        let reply = read(&app, &resource, &token, root.to_str().unwrap().into())
            .await
            .unwrap();
        assert!(!reply.complete);
        assert!(reply.blocked_count >= 3);
        let value = serde_json::to_value(reply).unwrap();
        for path in ["large.md", "binary.md", "linked.md"] {
            let file = value["files"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["path"] == format!(".voktty/plans/{path}"))
                .unwrap();
            assert_eq!(file["fact"]["kind"], "blocked");
        }
        assert!(!value
            .to_string()
            .contains("blocked-document-sentinel-7e5bf6"));
    });
}

#[test]
fn documents_reject_foreign_roots_incomplete_scopes_limits_and_expired_deadlines() {
    let (_state, app, resource) = super::super::tests::fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    let expected = root.to_str().unwrap().to_owned();
    let token = resource
        .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        assert_eq!(
            read(&app, &resource, &token, expected.clone())
                .await
                .unwrap_err()
                .code,
            "unavailable"
        );
        let token = resource
            .select_with_inspection(&app, &registry, root.clone(), &WorkspaceEnv::Local, 2, true)
            .unwrap();
        assert_eq!(
            read(
                &app,
                &resource,
                &token,
                root.join("other").to_str().unwrap().into()
            )
            .await
            .unwrap_err()
            .code,
            "stale"
        );
        let selected = resource.check(&app, &token).unwrap();
        assert!(matches!(
            app.documents(
                &resource.window,
                &resource.receipt,
                &selected,
                expected.clone(),
                DiscoveryControl::new(std::time::Duration::ZERO)
            ),
            Err(MemoryWorkError::Read(ReadError::Timeout))
        ));
        let plans = root.join(".voktty/plans");
        fs::create_dir_all(&plans).unwrap();
        for i in 0..129 {
            fs::write(plans.join(format!("{i}.md")), "document").unwrap();
        }
        assert_eq!(
            read(&app, &resource, &token, expected)
                .await
                .unwrap_err()
                .code,
            "limit"
        );
    });
}

#[test]
fn documents_share_worker_capacity_and_retire_with_every_owner() {
    for retirement in ["selection", "presentation", "window", "shutdown"] {
        let (state, app, resource) = super::super::tests::fixture();
        let dir = project();
        let registry = WorkspaceRegistry::default();
        let root = registry.authorize(dir.path()).unwrap();
        populate(&root);
        let expected = root.to_str().unwrap().to_owned();
        let token = resource
            .select_with_inspection(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1, true)
            .unwrap();
        runtime().block_on(async {
            let selected = resource.check(&app, &token).unwrap();
            let mut jobs = Vec::new();
            for _ in 0..4 {
                jobs.push(
                    app.documents(
                        &resource.window,
                        &resource.receipt,
                        &selected,
                        expected.clone(),
                        DiscoveryControl::default(),
                    )
                    .unwrap(),
                );
            }
            assert!(matches!(
                app.inspect_scope(
                    &resource.window,
                    &resource.receipt,
                    &selected,
                    DiscoveryControl::default()
                ),
                Err(MemoryWorkError::Read(ReadError::Busy))
            ));
            match retirement {
                "selection" => {
                    resource
                        .select(&app, &registry, root, &WorkspaceEnv::Local, 2)
                        .unwrap();
                }
                "presentation" => resource.retire(),
                "window" => resource.window.retire(),
                "shutdown" => app.shutdown(),
                _ => unreachable!(),
            }
            for job in jobs {
                assert!(matches!(
                    job.finish().await,
                    Err(MemoryWorkError::Read(ReadError::Cancelled))
                ));
            }
            assert_eq!(
                read(&app, &resource, &token, expected)
                    .await
                    .unwrap_err()
                    .code,
                "cancelled"
            );
            assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        });
    }
}
