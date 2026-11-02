use super::*;
use serde_json::json;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use voktty_memory_local::MemoryReadAccess;
use voktty_remote_protocol::{METHOD_HANDSHAKE, METHOD_MEMORY_MANAGE, PROTOCOL_VERSION};

fn request(params: Value) -> RemoteRequest {
    RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: "memory-test".into(),
        method: METHOD_MEMORY_MANAGE.into(),
        params,
    }
}

fn call(server: &mut MemoryServer, root: &Path, params: Value) -> Value {
    let reply = server.handle(Some(root), request(params));
    assert!(reply.ok, "{:?}", reply.error);
    reply.result.unwrap()
}

fn ok(server: &mut MemoryServer, root: &Path, params: Value) -> Value {
    let reply = call(server, root, params);
    assert_eq!(reply["ok"], true, "{reply}");
    reply["result"].clone()
}

fn error(server: &mut MemoryServer, root: &Path, params: Value, code: &str) {
    let reply = call(server, root, params);
    assert_eq!(reply["ok"], false, "{reply}");
    assert_eq!(reply["error"]["code"], code, "{reply}");
}

fn fixture() -> (tempfile::TempDir, tempfile::TempDir, MemoryServer) {
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let private = tempfile::tempdir().unwrap();
    fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let server = MemoryServer {
        parent: Some(private.path().join("application")),
        ..Default::default()
    };
    (project, private, server)
}

fn select(server: &mut MemoryServer, root: &Path, handle: &Value, revision: u64) -> Value {
    ok(
        server,
        root,
        json!({"operation":"select","handle":handle,"path":root,"revision":revision,"inspectAncestors":true}),
    )
}

fn preview(
    server: &mut MemoryServer,
    root: &Path,
    handle: &Value,
    selection: &Value,
    revision: u64,
) -> Value {
    ok(
        server,
        root,
        json!({"operation":"preview","handle":handle,"selection":selection,"revision":revision,
        "inputs":{"project_name":"Remote integration","project_summary":"Host memory test","owner_title":"Owner","primary_branch":"main",
        "verify_commands":"cargo test","language":"English","created_at":"2026-11-02","default_runtime":"codex","default_model":"default"},
        "links":{"agents":false,"claude":false}}),
    )
}

fn initialize(server: &mut MemoryServer, root: &Path, handle: &Value, selection: &Value) {
    ok(
        server,
        root,
        json!({"operation":"initialize","handle":handle,"selection":selection}),
    );
    let review = preview(server, root, handle, selection, 1);
    assert_eq!(review["deployment"]["canPublish"], true);
    ok(
        server,
        root,
        json!({"operation":"confirm","handle":handle,"selection":selection,"review":review["review"]}),
    );
}

#[test]
fn real_native_flow_preserves_reserved_data_and_binds_context_after_exact_reviews() {
    let (project, private, mut server) = fixture();
    let root = project.path();
    fs::create_dir_all(root.join(".voktty/sessions")).unwrap();
    fs::write(
        root.join(".voktty/sessions/existing.json"),
        "existing session",
    )
    .unwrap();
    fs::write(root.join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(root.join("AGENTS.md"), "Existing rules\n").unwrap();
    let handle = ok(&mut server, root, json!({"operation":"open"}));
    let selection = select(&mut server, root, &handle, 1);
    let inspected = ok(
        &mut server,
        root,
        json!({"operation":"inspect","handle":handle,"selection":selection}),
    );
    assert_eq!(inspected["scope"]["state"], "reserved");
    error(
        &mut server,
        root,
        json!({"operation":"discover","handle":handle,"selection":selection}),
        "unavailable",
    );
    assert_eq!(fs::read_dir(private.path()).unwrap().count(), 0);
    initialize(&mut server, root, &handle, &selection);
    let inspected = ok(
        &mut server,
        root,
        json!({"operation":"inspect","handle":handle,"selection":selection}),
    );
    assert_eq!(inspected["scope"]["state"], "ready");
    assert_eq!(
        ok(
            &mut server,
            root,
            json!({"operation":"discover","handle":handle,"selection":selection})
        )["scope"]["state"],
        "ready"
    );
    let review = ok(
        &mut server,
        root,
        json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":1,"role":null}),
    );
    assert!(review["instructions"]["files"].as_array().unwrap().len() > 1);
    let accepted = ok(
        &mut server,
        root,
        json!({"operation":"confirmTrust","handle":handle,"selection":selection,"review":review["review"]}),
    );
    assert_eq!(accepted["preference"]["policy"], "manual");
    let review = ok(
        &mut server,
        root,
        json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":2,"role":null}),
    );
    let context = ok(&mut server, root, json!({"operation":"contextOpen"}));
    ok(
        &mut server,
        root,
        json!({"operation":"contextBind","handle":handle,"selection":selection,"review":review["review"],"context":context,"mode":"enabled"}),
    );
    ok(
        &mut server,
        root,
        json!({"operation":"close","handle":handle}),
    );
    let packet = ok(
        &mut server,
        root,
        json!({"operation":"contextRead","context":context}),
    );
    assert_eq!(packet["decision"]["contextAllowed"], true);
    assert_eq!(packet["decision"]["captureAllowed"], false);
    assert!(packet["packet"]["text"]
        .as_str()
        .unwrap()
        .contains("Remote integration"));
    assert!(packet["packet"]["bytes"].as_u64().unwrap() <= 24 * 1024);
    ok(
        &mut server,
        root,
        json!({"operation":"contextClose","context":context}),
    );
    error(
        &mut server,
        root,
        json!({"operation":"contextRead","context":context}),
        "cancelled",
    );
    assert_eq!(
        fs::read_to_string(root.join(".voktty/sessions/existing.json")).unwrap(),
        "existing session"
    );
    assert_eq!(
        fs::read_to_string(root.join("AGENTS.md")).unwrap(),
        "Existing rules\n"
    );
}

#[test]
fn invalid_reselection_and_reset_retire_old_reviews_and_never_publish_to_a_new_owner() {
    let (project, _private, mut server) = fixture();
    let root = project.path();
    let handle = ok(&mut server, root, json!({"operation":"open"}));
    let selection = select(&mut server, root, &handle, 1);
    ok(
        &mut server,
        root,
        json!({"operation":"initialize","handle":handle,"selection":selection}),
    );
    let review = preview(&mut server, root, &handle, &selection, 1);
    error(
        &mut server,
        root,
        json!({"operation":"select","handle":handle,"path":"/outside","revision":2}),
        "denied",
    );
    error(
        &mut server,
        root,
        json!({"operation":"confirm","handle":handle,"selection":selection,"review":review["review"]}),
        "cancelled",
    );
    assert!(!root.join(".voktty").exists());
    let selection = select(&mut server, root, &handle, 3);
    let review = preview(&mut server, root, &handle, &selection, 1);
    server.reset();
    error(
        &mut server,
        root,
        json!({"operation":"confirm","handle":handle,"selection":selection,"review":review["review"]}),
        "cancelled",
    );
    let replacement = ok(&mut server, root, json!({"operation":"open"}));
    assert_ne!(replacement, handle);
    assert!(!root.join(".voktty").exists());
}

#[test]
fn review_rechecks_changed_bytes_and_consumes_failed_publication() {
    let (project, _private, mut server) = fixture();
    let root = project.path();
    let handle = ok(&mut server, root, json!({"operation":"open"}));
    let selection = select(&mut server, root, &handle, 1);
    ok(
        &mut server,
        root,
        json!({"operation":"initialize","handle":handle,"selection":selection}),
    );
    let review = preview(&mut server, root, &handle, &selection, 1);
    fs::create_dir(root.join(".voktty")).unwrap();
    fs::write(root.join(".voktty/PROJECT.md"), "External replacement").unwrap();
    let result = call(
        &mut server,
        root,
        json!({"operation":"confirm","handle":handle,"selection":selection,"review":review["review"]}),
    );
    assert_eq!(result["ok"], false);
    assert!(result["error"]["changes"].is_object());
    assert_eq!(
        fs::read_to_string(root.join(".voktty/PROJECT.md")).unwrap(),
        "External replacement"
    );
    error(
        &mut server,
        root,
        json!({"operation":"confirm","handle":handle,"selection":selection,"review":review["review"]}),
        "cancelled",
    );
}

#[test]
fn metadata_consent_does_not_grant_parent_instruction_reads_or_writes() {
    use voktty_memory_local::MemoryWriteAccess;
    let parent = tempfile::tempdir_in("/dev/shm").unwrap();
    let root = parent.path().join("project");
    fs::create_dir(&root).unwrap();
    let access = Access::new(root.clone(), root.clone(), true);
    assert!(access.allows_read(&parent.path().join(".voktty/kit.json")));
    assert!(!access.allows_read(&parent.path().join(".voktty/INIT.md")));
    assert!(!access.allows_workspace_root(parent.path()));
    let writes = AcceptedWrites {
        source: &access,
        requirements: voktty_memory_local::PublicationWriteRequirements {
            root: parent.path().into(),
            create: vec![".voktty/PROJECT.md".into()],
            replace: vec![],
            recovery: vec![],
        },
    };
    assert!(!writes.allows_create(&parent.path().join(".voktty/PROJECT.md")));
    access.retire();
    assert!(!access.allows_metadata(&root));
    assert!(!access.allows_read(&parent.path().join(".voktty/kit.json")));
}

#[test]
fn secret_paths_and_escaping_links_never_become_memory_sources() {
    let (project, _private, mut server) = fixture();
    let root = project.path();
    let outside = tempfile::tempdir_in("/dev/shm").unwrap();
    symlink(outside.path(), root.join("escape")).unwrap();
    fs::create_dir(root.join(".ssh")).unwrap();
    let handle = ok(&mut server, root, json!({"operation":"open"}));
    for (index, path) in [
        root.join("escape"),
        root.join(".ssh"),
        root.join("../outside"),
    ]
    .iter()
    .enumerate()
    {
        let reply = call(
            &mut server,
            root,
            json!({"operation":"select","handle":handle,"path":path,"revision":index+1}),
        );
        assert_eq!(reply["ok"], false);
        assert!(!reply.to_string().contains(root.to_str().unwrap()));
    }
}

#[test]
fn resource_limit_and_unforgeable_handles_hold_across_helpers() {
    let (project, _private, mut server) = fixture();
    let root = project.path();
    let first = ok(&mut server, root, json!({"operation":"open"}));
    let (_other_project, _other_private, mut other) = fixture();
    let other_handle = ok(&mut other, root, json!({"operation":"open"}));
    error(
        &mut server,
        root,
        json!({"operation":"close","handle":other_handle}),
        "cancelled",
    );
    for _ in 1..MAX_RESOURCES {
        ok(&mut server, root, json!({"operation":"contextOpen"}));
    }
    error(&mut server, root, json!({"operation":"open"}), "limit");
    ok(
        &mut server,
        root,
        json!({"operation":"close","handle":first}),
    );
    ok(&mut server, root, json!({"operation":"open"}));
}

#[test]
fn capability_requires_handshake_and_rehandshake_retires_all_receipts() {
    fn dispatch(server: &mut crate::RemoteServer, params: Value) -> RemoteResponse {
        let (sender, receiver) = std::sync::mpsc::channel();
        let sink: crate::proc_host::FrameSink = Arc::new(move |frame| {
            sender
                .send(frame)
                .map_err(|_| std::io::Error::other("test response receiver closed"))
        });
        server
            .start_memory(request(params), sink)
            .unwrap_or_else(|| {
                let voktty_remote_protocol::Frame::Response(response) =
                    receiver.recv_timeout(Duration::from_secs(3)).unwrap()
                else {
                    panic!("expected a memory response");
                };
                response
            })
    }
    let (project, _, _) = fixture();
    let mut server = crate::RemoteServer::new();
    assert_eq!(
        dispatch(&mut server, json!({"operation":"open"}))
            .error
            .unwrap()
            .code,
        "handshake_required"
    );
    let handshake = || RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: "handshake".into(),
        method: METHOD_HANDSHAKE.into(),
        params: json!({"workspaceRoot":project.path()}),
    };
    let reply = server.handle(handshake());
    assert!(reply.result.unwrap()["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == METHOD_MEMORY_MANAGE));
    let handle = dispatch(&mut server, json!({"operation":"open"}))
        .result
        .unwrap()["result"]
        .clone();
    server.handle(handshake());
    let rejected = dispatch(&mut server, json!({"operation":"close","handle":handle}));
    assert_eq!(rejected.result.unwrap()["error"]["code"], "cancelled");
}

#[test]
fn strict_parameters_and_limits_reject_before_private_state_or_project_writes() {
    let (project, private, mut server) = fixture();
    for params in [
        json!({"operation":"open","parent":"/forged"}),
        json!({"operation":"shell"}),
        json!({"operation":"open","extra":true}),
    ] {
        assert_eq!(
            server
                .handle(Some(project.path()), request(params))
                .error
                .unwrap()
                .code,
            "invalid_params"
        );
    }
    assert_eq!(
        server
            .handle(
                Some(project.path()),
                request(json!({"operation":"open","extra":"x".repeat(MAX_REQUEST_BYTES)}))
            )
            .error
            .unwrap()
            .code,
        "limit"
    );
    assert_eq!(fs::read_dir(private.path()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn trust_policy_and_session_consent_remain_independent_and_policy_changes_apply_to_live_context() {
    let (project, _private, mut server) = fixture();
    let root = project.path();
    let handle = ok(&mut server, root, json!({"operation":"open"}));
    let selection = select(&mut server, root, &handle, 1);
    initialize(&mut server, root, &handle, &selection);
    let review = ok(
        &mut server,
        root,
        json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":1}),
    );
    assert!(review["preference"].is_null());
    let context = ok(&mut server, root, json!({"operation":"contextOpen"}));
    ok(
        &mut server,
        root,
        json!({"operation":"contextBind","handle":handle,"selection":selection,"review":review["review"],"context":context,"mode":"enabled"}),
    );
    let denied = ok(
        &mut server,
        root,
        json!({"operation":"contextRead","context":context}),
    );
    assert_eq!(denied["decision"]["contextAllowed"], false);
    assert!(denied["packet"].is_null());
    ok(
        &mut server,
        root,
        json!({"operation":"contextClose","context":context}),
    );

    let selection = select(&mut server, root, &handle, 2);
    let review = ok(
        &mut server,
        root,
        json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":1}),
    );
    let accepted = ok(
        &mut server,
        root,
        json!({"operation":"confirmTrust","handle":handle,"selection":selection,"review":review["review"]}),
    );
    let review = ok(
        &mut server,
        root,
        json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":2}),
    );
    let context = ok(&mut server, root, json!({"operation":"contextOpen"}));
    ok(
        &mut server,
        root,
        json!({"operation":"contextBind","handle":handle,"selection":selection,"review":review["review"],"context":context,"mode":"enabled"}),
    );
    assert_eq!(
        ok(
            &mut server,
            root,
            json!({"operation":"contextRead","context":context})
        )["decision"]["contextAllowed"],
        true
    );

    let editor = ok(&mut server, root, json!({"operation":"open"}));
    let selected = select(&mut server, root, &editor, 1);
    let policy = ok(
        &mut server,
        root,
        json!({"operation":"reviewPolicy","handle":editor,"selection":selected,"revision":1,"policy":"never"}),
    );
    assert_eq!(policy["preference"]["policy"], "manual");
    assert_eq!(
        policy["preference"]["instructionDigest"],
        accepted["preference"]["instructionDigest"]
    );
    ok(
        &mut server,
        root,
        json!({"operation":"confirmPolicy","handle":editor,"selection":selected,"review":policy["review"]}),
    );
    let denied = ok(
        &mut server,
        root,
        json!({"operation":"contextRead","context":context}),
    );
    assert_eq!(denied["decision"]["contextAllowed"], false);
    assert!(denied["packet"].is_null());
    ok(
        &mut server,
        root,
        json!({"operation":"contextClose","context":context}),
    );
}

#[test]
fn cancellation_fences_out_of_order_reviews_and_changed_instructions_cannot_be_trusted() {
    let (project, _private, mut server) = fixture();
    let root = project.path();
    let handle = ok(&mut server, root, json!({"operation":"open"}));
    let selection = select(&mut server, root, &handle, 1);
    ok(
        &mut server,
        root,
        json!({"operation":"initialize","handle":handle,"selection":selection}),
    );
    ok(
        &mut server,
        root,
        json!({"operation":"cancel","handle":handle,"selection":selection,"revision":3}),
    );
    error(
        &mut server,
        root,
        json!({"operation":"preview","handle":handle,"selection":selection,"revision":2,"inputs":{},"links":{"agents":false,"claude":false}}),
        "cancelled",
    );
    assert!(!root.join(".voktty").exists());
    let review = preview(&mut server, root, &handle, &selection, 4);
    ok(
        &mut server,
        root,
        json!({"operation":"confirm","handle":handle,"selection":selection,"review":review["review"]}),
    );
    let review = ok(
        &mut server,
        root,
        json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":1}),
    );
    fs::write(root.join(".voktty/INIT.md"), "Changed instructions\n").unwrap();
    error(
        &mut server,
        root,
        json!({"operation":"confirmTrust","handle":handle,"selection":selection,"review":review["review"]}),
        "stale",
    );
    error(
        &mut server,
        root,
        json!({"operation":"confirmTrust","handle":handle,"selection":selection,"review":review["review"]}),
        "cancelled",
    );
    let snapshot = server
        .store(false, &ReadControl::default())
        .unwrap()
        .load()
        .unwrap();
    assert!(snapshot
        .project(review["projectKey"].as_str().unwrap())
        .is_none());
}
