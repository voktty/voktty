#![cfg(any(target_os = "linux", windows))]

use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;
use voktty_memory_local::{
    acquire_reservation, complete_mailbox_note, list_mailbox_inbox, list_reservations,
    release_reservation, send_mailbox_note, DiscoveryControl, MailboxNote, MemoryReadAccess,
    MemoryWriteAccess, NoteKind, OwnedProjectInitializationPreview, OwnedProjectRecoveryPreview,
    ProjectInitializationRequest, ProjectRecoveryRequest, WorkReservation,
    PROJECT_INITIALIZATION_RECORD,
};
use voktty_workspace_kit::RootLinks;

struct TestAuthority {
    root: PathBuf,
    live: AtomicBool,
    fail_at: Mutex<Option<String>>,
}

impl MemoryReadAccess for TestAuthority {
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.live.load(Ordering::Acquire) && path.starts_with(&self.root)
    }
    fn allows_metadata(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
}

impl MemoryWriteAccess for TestAuthority {
    fn allows_create(&self, path: &Path) -> bool {
        if self.root.join(PROJECT_INITIALIZATION_RECORD).exists() {
            if let Some(ref fail) = *self.fail_at.lock().unwrap() {
                if path == self.root.join(fail) {
                    return false;
                }
            }
        }
        self.allows_workspace_root(path)
    }
    fn allows_replace(&self, path: &Path) -> bool {
        self.allows_create(path)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        self.allows_workspace_root(path)
    }
}

static SERIAL: Mutex<()> = Mutex::new(());

fn authority(root: &Path) -> Arc<TestAuthority> {
    Arc::new(TestAuthority {
        root: fs::canonicalize(root).unwrap(),
        live: AtomicBool::new(true),
        fail_at: Mutex::new(None),
    })
}

#[test]
fn u1_main_flow_empty_folder_and_project_with_code() {
    let _serial = SERIAL.lock().unwrap();
    let temp = tempdir().unwrap();
    let root = temp.path();

    let auth = authority(root);

    // 1. Initialize project memory in empty directory
    let preview = OwnedProjectInitializationPreview::prepare_at_project_root(
        ProjectInitializationRequest {
            origin: auth.root.clone(),
            origin_access: auth.clone(),
            destination: auth.root.clone(),
            destination_access: auth.clone(),
            inputs: json!({
                "project_name": "U1 Linux Project",
                "created_at": "2026-11-08"
            })
            .as_object()
            .unwrap()
            .clone(),
            links: RootLinks {
                agents: true,
                claude: true,
            },
        },
        &DiscoveryControl::default(),
    )
    .unwrap();

    let digest = preview.acceptance_digest();
    preview
        .publish(&digest, auth.as_ref(), &DiscoveryControl::default())
        .unwrap();

    // 2. Verify physical files created in .voktty/ and root links
    assert!(root.join(".voktty").is_dir());
    assert!(root.join(".voktty/kit.json").is_file());
    assert!(root.join(".voktty/PROJECT.md").is_file());
    assert!(root.join(".voktty/CONTEXT.md").is_file());
    assert!(root.join(".voktty/RULES.md").is_file());
    assert!(root.join("AGENTS.md").is_file());
    assert!(root.join("CLAUDE.md").is_file());

    // 3. Populate project code and customize rules
    let src_dir = root.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    fs::write(
        src_dir.join("main.rs"),
        b"fn main() { println!(\"hello\"); }",
    )
    .unwrap();

    let custom_rule = "\n# Custom Team Invariants\n- Always run cargo nextest.\n";
    let mut rules_content = fs::read_to_string(root.join(".voktty/RULES.md")).unwrap();
    rules_content.push_str(custom_rule);
    fs::write(root.join(".voktty/RULES.md"), rules_content.as_bytes()).unwrap();

    // 4. Second session portability: reading memory without prior chat context or global DB
    let re_read_rules = fs::read_to_string(root.join(".voktty/RULES.md")).unwrap();
    assert!(re_read_rules.contains("Always run cargo nextest"));

    let agents_content = fs::read_to_string(root.join("AGENTS.md")).unwrap();
    assert!(agents_content.contains(".voktty/"));
}

#[test]
fn u1_interruption_and_recovery_preserves_custom_rules_and_cleans_record() {
    let _serial = SERIAL.lock().unwrap();
    let temp = tempdir().unwrap();
    let root = temp.path();

    let auth = authority(root);

    // 1. Start initialization but simulate an interruption on RULES.md
    let preview = OwnedProjectInitializationPreview::prepare_at_project_root(
        ProjectInitializationRequest {
            origin: auth.root.clone(),
            origin_access: auth.clone(),
            destination: auth.root.clone(),
            destination_access: auth.clone(),
            inputs: json!({
                "project_name": "Recovery Test",
                "created_at": "2026-11-08"
            })
            .as_object()
            .unwrap()
            .clone(),
            links: RootLinks {
                agents: true,
                claude: true,
            },
        },
        &DiscoveryControl::default(),
    )
    .unwrap();

    let digest = preview.acceptance_digest();
    *auth.fail_at.lock().unwrap() = Some(".voktty/RULES.md".into());
    let err = preview.publish(&digest, auth.as_ref(), &DiscoveryControl::default());
    assert!(err.is_err(), "interrupted publication must return an error");
    *auth.fail_at.lock().unwrap() = None;

    // Initialization record was created on interruption
    assert!(root.join(PROJECT_INITIALIZATION_RECORD).is_file());

    // 2. Add custom user context and session work while in interrupted state
    let custom_context = "User added context during partial state";
    fs::write(root.join(".voktty/CONTEXT.md"), custom_context).unwrap();

    let sessions_dir = root.join(".voktty/sessions");
    fs::create_dir_all(&sessions_dir).unwrap();
    fs::write(sessions_dir.join("current.json"), b"{\"session\": 1}").unwrap();

    // 3. Run explicit recovery
    let recovery_preview = OwnedProjectRecoveryPreview::prepare(
        ProjectRecoveryRequest {
            origin: auth.root.clone(),
            origin_access: auth.clone(),
            destination: auth.root.clone(),
            destination_access: auth.clone(),
        },
        &DiscoveryControl::default(),
    )
    .unwrap();

    let rec_digest = recovery_preview.acceptance_digest();
    let report = recovery_preview
        .publish(&rec_digest, auth.as_ref(), &DiscoveryControl::default())
        .unwrap();

    // 4. Record must be cleaned up on recovery completion
    assert!(!root.join(PROJECT_INITIALIZATION_RECORD).exists());
    assert!(report
        .cleaned
        .contains(&PROJECT_INITIALIZATION_RECORD.to_owned()));

    // 5. Custom context and sessions survived intact
    assert_eq!(
        fs::read_to_string(root.join(".voktty/CONTEXT.md")).unwrap(),
        custom_context
    );
    assert_eq!(
        fs::read(sessions_dir.join("current.json")).unwrap(),
        b"{\"session\": 1}"
    );
}

#[test]
fn u1_independent_coordination_and_mailbox_in_project_memory() {
    let _serial = SERIAL.lock().unwrap();
    let temp = tempdir().unwrap();
    let root = temp.path();

    // 1. Agent 1 acquires reservation
    let res_1 = WorkReservation {
        agent: "agent-architect".into(),
        owner: "session-arch-1".into(),
        task: "T-01: design auth module".into(),
        paths: vec!["src/auth/".into()],
        resources: vec!["auth-spec".into()],
        updated_at: "2030-01-01T12:00:00Z".into(),
    };
    let lock_path = acquire_reservation(root, "T-01", &res_1).unwrap();
    assert!(lock_path.is_file());

    // 2. Agent 1 sends mailbox note to Agent 2
    let note = MailboxNote {
        from: "agent-architect".into(),
        to: "agent-developer".into(),
        kind: NoteKind::Task,
        text: "Please implement JWT verification under src/auth/jwt.rs".into(),
        sent_at: "2030-01-01T12:05:00Z".into(),
    };
    send_mailbox_note(root, "task-jwt-01", &note).unwrap();

    // 3. Agent 2 reads inbox
    let inbox = list_mailbox_inbox(root, "agent-developer").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(
        inbox[0].note.text,
        "Please implement JWT verification under src/auth/jwt.rs"
    );

    // 4. Agent 2 completes note -> moved to done
    let done = complete_mailbox_note(root, "agent-developer", "task-jwt-01.json").unwrap();
    assert!(done.is_file());
    assert!(list_mailbox_inbox(root, "agent-developer")
        .unwrap()
        .is_empty());

    // 5. Agent 1 releases reservation
    release_reservation(root, "T-01", "session-arch-1").unwrap();
    assert!(list_reservations(root).unwrap().is_empty());
}
