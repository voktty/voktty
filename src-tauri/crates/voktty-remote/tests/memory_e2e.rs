#![cfg(target_os = "linux")]

use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use voktty_memory_local::{
    DiscoveryControl, InitializationPreview, LocalMemoryStore, LocalMemoryWorkspace,
    MemoryReadAccess, MemoryWriteAccess, ReadControl,
};
use voktty_remote_protocol::{
    read_frame, write_frame, Frame, RemoteRequest, RemoteResponse, METHOD_HANDSHAKE,
    METHOD_MEMORY_MANAGE, PROTOCOL_VERSION,
};

struct Helper {
    child: Child,
    input: ChildStdin,
    output: Receiver<Frame>,
    reader: Option<JoinHandle<()>>,
    next_id: u64,
}

impl Helper {
    fn start(data: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_voktty-remote"))
            .arg("--stdio")
            .env("XDG_DATA_HOME", data)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let (sender, output) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            while let Ok(Some(frame)) = read_frame(&mut stdout) {
                if sender.send(frame).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            input,
            output,
            reader: Some(reader),
            next_id: 0,
        }
    }

    fn request(&mut self, method: &str, params: Value) -> RemoteResponse {
        self.next_id += 1;
        let id = self.next_id.to_string();
        write_frame(
            &mut self.input,
            &Frame::Request(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: id.clone(),
                method: method.into(),
                params,
            }),
        )
        .unwrap();
        self.input.flush().unwrap();
        let Frame::Response(reply) = self.output.recv_timeout(Duration::from_secs(20)).unwrap()
        else {
            panic!("expected a memory response");
        };
        assert_eq!(reply.id, id);
        assert_eq!(reply.protocol, PROTOCOL_VERSION);
        reply
    }

    fn memory(&mut self, params: Value) -> Value {
        let response = self.request(METHOD_MEMORY_MANAGE, params);
        assert!(response.ok, "{:?}", response.error);
        let reply = response.result.unwrap();
        assert_eq!(reply["schema"], 1);
        reply
    }

    fn ok(&mut self, params: Value) -> Value {
        let reply = self.memory(params);
        assert_eq!(reply["ok"], true, "{reply}");
        reply["result"].clone()
    }

    fn handshake(&mut self, root: &Path) {
        let response = self.request(METHOD_HANDSHAKE, json!({"workspaceRoot":root}));
        assert!(response.ok, "{:?}", response.error);
        assert!(response.result.unwrap()["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|method| method == METHOD_MEMORY_MANAGE));
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            reader.join().unwrap();
        }
    }
}

#[test]
fn real_helper_initializes_reserved_kit_and_uses_context_without_transferring_receipts_to_reconnections(
) {
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let private = tempfile::tempdir().unwrap();
    fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let data = private.path().join("data");
    let root = project.path();
    fs::create_dir_all(root.join(".voktty/sessions")).unwrap();
    fs::write(
        root.join(".voktty/sessions/kept.json"),
        "reserved conversation",
    )
    .unwrap();
    fs::write(root.join(".voktty/.gitignore"), "*\n").unwrap();
    let mut helper = Helper::start(&data);
    assert_eq!(
        helper
            .request(METHOD_MEMORY_MANAGE, json!({"operation":"open"}))
            .error
            .unwrap()
            .code,
        "handshake_required"
    );
    helper.handshake(root);
    let handle = helper.ok(json!({"operation":"open"}));
    let selection = helper.ok(json!({"operation":"select","handle":handle,"path":root,"revision":1,"inspectAncestors":true}));
    let scope = helper.ok(json!({"operation":"inspect","handle":handle,"selection":selection}));
    assert_eq!(scope["scope"]["state"], "reserved");
    assert!(!data.exists());
    helper.ok(json!({"operation":"initialize","handle":handle,"selection":selection}));
    let preview = helper.ok(json!({"operation":"preview","handle":handle,"selection":selection,"revision":1,
        "inputs":{"project_name":"Helper integration","project_summary":"Memory over framed transport","owner_title":"Owner","primary_branch":"main",
        "verify_commands":"cargo test","language":"English","created_at":"2026-11-02","default_runtime":"codex","default_model":"default"},
        "links":{"agents":false,"claude":false}}));
    assert_eq!(preview["deployment"]["canPublish"], true);
    assert!(!root.join(".voktty/kit.json").exists());
    helper.ok(json!({"operation":"confirm","handle":handle,"selection":selection,"review":preview["review"]}));
    let documents = helper
        .ok(json!({"operation":"documents","handle":handle,"selection":selection,"root":root}));
    assert!(documents["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == ".voktty/PROJECT.md"));
    let trust = helper
        .ok(json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":1}));
    helper.ok(json!({"operation":"confirmTrust","handle":handle,"selection":selection,"review":trust["review"]}));
    let trust = helper
        .ok(json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":2}));
    let context = helper.ok(json!({"operation":"contextOpen"}));
    let bound = helper.ok(json!({"operation":"contextBind","handle":handle,"selection":selection,"review":trust["review"],"context":context,"mode":"enabled"}));
    assert_eq!(bound, json!({"schema":1,"root":root}));
    helper.ok(json!({"operation":"close","handle":handle}));
    let context_reply = helper.ok(json!({"operation":"contextRead","context":context}));
    assert_eq!(context_reply["decision"]["contextAllowed"], true);
    assert_eq!(context_reply["decision"]["captureAllowed"], false);
    assert!(context_reply["packet"]["text"]
        .as_str()
        .unwrap()
        .contains("Helper integration"));
    let stored = fs::read(data.join("dev.voktty/project-memory/memory-local.json")).unwrap();
    drop(helper);

    let mut replacement = Helper::start(&data);
    replacement.handshake(root);
    assert_eq!(
        replacement.memory(json!({"operation":"contextRead","context":context}))["error"]["code"],
        "cancelled"
    );
    assert_eq!(
        fs::read(data.join("dev.voktty/project-memory/memory-local.json")).unwrap(),
        stored
    );
    assert_eq!(
        fs::read_to_string(root.join(".voktty/sessions/kept.json")).unwrap(),
        "reserved conversation"
    );
}

struct RecoveryFixtureAccess(PathBuf);
impl MemoryReadAccess for RecoveryFixtureAccess {
    fn allows_metadata(&self, _path: &Path) -> bool {
        true
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.0) || path.ends_with(".voktty/kit.json")
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
            || self
                .0
                .ancestors()
                .any(|ancestor| path == ancestor.join(".voktty"))
    }
}
impl MemoryWriteAccess for RecoveryFixtureAccess {
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

#[test]
fn real_framed_helper_restores_only_after_review_and_rejects_a_retired_handshake_receipt() {
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let private = tempfile::tempdir().unwrap();
    fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let data = private.path().join("data");
    let parent = data.join("dev.voktty");
    let root = project.path();
    fs::create_dir(root.join(".voktty")).unwrap();
    fs::write(root.join(".voktty/.gitignore"), b"*\r\n").unwrap();
    let control = ReadControl::default();
    LocalMemoryStore::prepare_application_parent(&parent, &control).unwrap();
    let store = Arc::new(LocalMemoryStore::create_private(&parent, &control).unwrap());
    store.initialize().unwrap();
    let access = Arc::new(RecoveryFixtureAccess(root.to_owned()));
    let workspace = LocalMemoryWorkspace::open(&store, root, access.as_ref(), &control).unwrap();
    let preview = InitializationPreview::prepare(
        &workspace,
        &workspace,
        json!({"project_name":"Framed recovery","created_at":"2026-11-03"})
            .as_object()
            .unwrap(),
        voktty_workspace_kit::RootLinks::default(),
        &DiscoveryControl::default(),
    )
    .unwrap()
    .into_owned(store.clone(), access.clone(), access.clone())
    .unwrap();
    let failure = preview
        .publish(access.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.possible_recovery_files.len(), 1);
    let backup = &failure.possible_recovery_files[0];
    fs::remove_file(root.join(".voktty/.gitignore")).unwrap();
    let intent_path = parent.join("project-memory/memory-deployment.json");
    let state_path = parent.join("project-memory/memory-local.json");
    let intent = fs::read(&intent_path).unwrap();
    let state = fs::read(&state_path).unwrap();
    let mut helper = Helper::start(&data);
    helper.handshake(root);
    let handle = helper.ok(json!({"operation":"open"}));
    let selection = helper.ok(json!({"operation":"select","handle":handle,"path":root,"revision":1,"inspectAncestors":true}));
    let review = helper.ok(
        json!({"operation":"reviewRecovery","handle":handle,"selection":selection,"revision":1}),
    );
    assert_eq!(
        review["entries"],
        json!([{"target":".voktty/.gitignore","backup":backup,"text":"*\r\n"}])
    );
    assert!(!root.join(".voktty/.gitignore").exists());
    helper.handshake(root);
    let rejected = helper.memory(
        json!({"operation":"confirmRecovery","handle":handle,"selection":selection,
        "review":review["review"],"digest":review["digest"]}),
    );
    assert_eq!(rejected["error"]["code"], "cancelled");
    assert!(!root.join(".voktty/.gitignore").exists());
    let handle = helper.ok(json!({"operation":"open"}));
    let selection = helper.ok(json!({"operation":"select","handle":handle,"path":root,"revision":1,"inspectAncestors":true}));
    let review = helper.ok(
        json!({"operation":"reviewRecovery","handle":handle,"selection":selection,"revision":1}),
    );
    let report = helper.ok(
        json!({"operation":"confirmRecovery","handle":handle,"selection":selection,
        "review":review["review"],"digest":review["digest"]}),
    );
    assert_eq!(report["created"], json!([".voktty/.gitignore"]));
    assert_eq!(report["cleaned"], json!([backup]));
    assert_eq!(fs::read(root.join(".voktty/.gitignore")).unwrap(), b"*\r\n");
    assert!(!root.join(backup).exists());
    assert!(!root.join(".voktty/kit.json").exists());
    assert_eq!(fs::read(intent_path).unwrap(), intent);
    assert_eq!(fs::read(state_path).unwrap(), state);
}
