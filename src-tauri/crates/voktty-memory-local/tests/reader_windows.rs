#![cfg(windows)]

use std::fs::{self, OpenOptions};
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use voktty_memory_local::{
    LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess, ReadControl, ReadError,
};
use voktty_workspace_kit::{
    memory_project_key, prepare_deployment, render_template, PathFact, RootLinks,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_WRITE_ATTRIBUTES,
    FILE_WRITE_DATA,
};
use windows_sys::Win32::System::{Ioctl::FSCTL_SET_REPARSE_POINT, IO::DeviceIoControl};

struct Access {
    requested: PathBuf,
    canonical: PathBuf,
    denied: Mutex<Option<PathBuf>>,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.requested) || path.starts_with(&self.canonical)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.allows_metadata(path) && self.denied.lock().unwrap().as_deref() != Some(path)
    }
}
struct Fixture {
    project: tempfile::TempDir,
    _state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}
fn fixture(populated: bool) -> Fixture {
    let project = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    let store = LocalMemoryStore::open(state.path()).unwrap();
    store.initialize().unwrap();
    if populated {
        for file in render_template(
            json!({"project_name":"Windows reader","created_at":"2026-10-28"})
                .as_object()
                .unwrap(),
        )
        .unwrap()
        .into_iter()
        .filter(|f| f.path.starts_with(".voktty/"))
        {
            let path = project.path().join(file.path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, file.text).unwrap();
        }
    }
    let access = Access {
        requested: project.path().to_path_buf(),
        canonical: fs::canonicalize(project.path()).unwrap(),
        denied: Mutex::new(None),
    };
    Fixture {
        project,
        _state: state,
        store,
        access,
    }
}
fn open(f: &Fixture) -> LocalMemoryWorkspace<'_> {
    LocalMemoryWorkspace::open(
        &f.store,
        f.project.path(),
        &f.access,
        &ReadControl::default(),
    )
    .unwrap()
}

fn junction(link: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir(link)?;
    let actual = fs::canonicalize(target)?;
    let text = actual.to_str().ok_or(io::ErrorKind::InvalidInput)?;
    let native = format!(
        "\\??\\{}",
        text.strip_prefix(r"\\?\")
            .ok_or(io::ErrorKind::InvalidInput)?
    );
    let substitute: Vec<_> = native.encode_utf16().collect();
    let print: Vec<_> = voktty_paths::canonical_display_path(&actual)
        .encode_utf16()
        .collect();
    let length = 8 + (substitute.len() + print.len() + 2) * 2;
    let mut data = Vec::new();
    data.extend(0xa0000003u32.to_le_bytes());
    data.extend((length as u16).to_le_bytes());
    data.extend(0u16.to_le_bytes());
    for value in [
        0,
        substitute.len() * 2,
        (substitute.len() + 1) * 2,
        print.len() * 2,
    ] {
        data.extend((value as u16).to_le_bytes());
    }
    for unit in substitute
        .into_iter()
        .chain(Some(0))
        .chain(print)
        .chain(Some(0))
    {
        data.extend(unit.to_le_bytes());
    }
    let file = OpenOptions::new()
        .read(true)
        .access_mode(FILE_WRITE_DATA | FILE_WRITE_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(link)?;
    let mut returned = 0;
    if unsafe {
        DeviceIoControl(
            file.as_raw_handle(),
            FSCTL_SET_REPARSE_POINT,
            data.as_ptr().cast(),
            data.len() as u32,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[test]
fn native_volume_identity_and_actual_context_fingerprint_are_stable() {
    let f = fixture(true);
    let workspace = open(&f);
    assert_eq!(
        workspace.identity()["machineId"],
        f.store.load().unwrap().installation_id()
    );
    assert!(workspace.identity()["filesystemId"]
        .as_str()
        .unwrap()
        .starts_with("windows-volume:"));
    assert_eq!(
        workspace.identity()["canonicalRoot"],
        voktty_paths::canonical_display_path(&f.access.canonical)
    );
    assert_eq!(
        workspace.project_key(),
        memory_project_key(&workspace.identity().to_string()).unwrap()
    );
    let first = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    fs::write(
        f.project.path().join(".voktty/INIT.md"),
        "changed\r\n😀\r\n",
    )
    .unwrap();
    let changed = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    assert_ne!(first.fingerprint.digest, changed.fingerprint.digest);
    assert_eq!(open(&f).project_key(), workspace.project_key());
}

#[test]
fn empty_native_preview_and_opt_in_rules_preserve_exact_bytes() {
    let f = fixture(false);
    let workspace = open(&f);
    let observed = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    let files = render_template(
        json!({"project_name":"Windows reader","created_at":"2026-10-28"})
            .as_object()
            .unwrap(),
    )
    .unwrap();
    assert!(
        prepare_deployment("1.1.0", &files, &observed, RootLinks::default())
            .unwrap()
            .plan
            .can_publish
    );
    assert!(!f.project.path().join(".voktty").exists());
    fs::write(f.project.path().join("AGENTS.md"), "User rules\r\n😀\r\n").unwrap();
    let observed = workspace
        .observe_deployment(
            RootLinks {
                agents: true,
                claude: false,
            },
            &ReadControl::default(),
        )
        .unwrap();
    assert!(matches!(&observed["AGENTS.md"],PathFact::File{text} if text=="User rules\r\n😀\r\n"));
    assert!(!observed.contains_key("CLAUDE.md"));
}

#[test]
fn junctions_and_hardlinks_cannot_supply_instruction_content() {
    let f = fixture(false);
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("INIT.md"), "outside secret").unwrap();
    junction(&f.project.path().join(".voktty"), outside.path()).unwrap();
    let workspace = open(&f);
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/INIT.md"], PathFact::Blocked));
    fs::remove_dir(f.project.path().join(".voktty")).unwrap();
    fs::create_dir(f.project.path().join(".voktty")).unwrap();
    fs::hard_link(
        outside.path().join("INIT.md"),
        f.project.path().join(".voktty/INIT.md"),
    )
    .unwrap();
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/INIT.md"], PathFact::Blocked));
    assert_eq!(
        fs::read_to_string(outside.path().join("INIT.md")).unwrap(),
        "outside secret"
    );
}

#[test]
fn invalid_text_oversized_files_and_denied_rules_block_context() {
    let f = fixture(true);
    let workspace = open(&f);
    let init = f.project.path().join(".voktty/INIT.md");
    for bytes in [
        vec![0xff],
        b"nul\0text".to_vec(),
        vec![b'x'; 256 * 1024 + 1],
    ] {
        fs::write(&init, bytes).unwrap();
        assert!(matches!(
            workspace.observe_context(None, &ReadControl::default()),
            Err(ReadError::Contract(_))
        ));
    }
    fs::write(&init, "restored").unwrap();
    *f.access.denied.lock().unwrap() = Some(f.access.canonical.join(".voktty/INIT.md"));
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::default()),
        Err(ReadError::Contract(_))
    ));
}

#[test]
fn replacement_between_batches_invalidates_root_and_handles_are_released() {
    let f = fixture(true);
    let workspace = open(&f);
    let owner = tempfile::tempdir().unwrap();
    let moved = owner.path().join("original");
    fs::rename(f.project.path(), &moved).unwrap();
    fs::create_dir(f.project.path()).unwrap();
    let result = workspace.observe_deployment(RootLinks::default(), &ReadControl::default());
    fs::remove_dir(f.project.path()).unwrap();
    fs::rename(&moved, f.project.path()).unwrap();
    assert!(matches!(result, Err(ReadError::StaleRoot)));
    workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
}

#[test]
fn root_rename_is_refused_while_a_batch_owns_directory_handles() {
    struct RacingAccess<'a> {
        inner: &'a Access,
        moved: PathBuf,
        attempted: AtomicBool,
        refused: AtomicBool,
    }
    impl MemoryReadAccess for RacingAccess<'_> {
        fn allows_metadata(&self, path: &Path) -> bool {
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            if !self.attempted.swap(true, Ordering::AcqRel) {
                self.refused.store(
                    fs::rename(&self.inner.requested, &self.moved).is_err(),
                    Ordering::Release,
                );
            }
            self.inner.allows_read(path)
        }
    }
    let f = fixture(true);
    let owner = tempfile::tempdir().unwrap();
    let access = RacingAccess {
        inner: &f.access,
        moved: owner.path().join("original"),
        attempted: AtomicBool::new(false),
        refused: AtomicBool::new(false),
    };
    let workspace =
        LocalMemoryWorkspace::open(&f.store, f.project.path(), &access, &ReadControl::default())
            .unwrap();
    let result = workspace.observe_context(None, &ReadControl::default());
    if access.moved.exists() {
        fs::rename(&access.moved, f.project.path()).unwrap();
    }
    assert!(access.attempted.load(Ordering::Acquire));
    assert!(access.refused.load(Ordering::Acquire));
    result.unwrap();
}

#[test]
fn remote_namespaces_are_refused_before_network_canonicalization() {
    struct RequestedOnly;
    impl MemoryReadAccess for RequestedOnly {
        fn allows_metadata(&self, _: &Path) -> bool {
            true
        }
        fn allows_read(&self, _: &Path) -> bool {
            panic!("must not read")
        }
    }
    let f = fixture(false);
    for path in [
        r"\\unreachable.invalid\share\project",
        r"\\?\UNC\unreachable.invalid\share",
        r"\\.\pipe\memory",
        r"\\?\GLOBALROOT\Device\HarddiskVolume1\project",
    ] {
        assert!(matches!(
            LocalMemoryWorkspace::open(
                &f.store,
                Path::new(path),
                &RequestedOnly,
                &ReadControl::default()
            ),
            Err(ReadError::Unsupported)
        ));
    }
}

#[test]
fn cancellation_and_expired_deadline_prevent_observations() {
    let f = fixture(true);
    let workspace = open(&f);
    let cancelled = ReadControl::default();
    cancelled.cancel();
    assert!(matches!(
        workspace.observe_context(None, &cancelled),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::new(Duration::ZERO)),
        Err(ReadError::Timeout)
    ));
}

#[test]
fn normalized_handle_path_is_authorized_before_reading_a_case_alias() {
    let f = fixture(true);
    let original = f.project.path().join(".voktty/INIT.md");
    let actual = f.project.path().join(".voktty/init.md");
    fs::rename(&original, &actual).unwrap();
    *f.access.denied.lock().unwrap() = Some(fs::canonicalize(&actual).unwrap());
    let workspace = open(&f);
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    // Case-sensitive directories have no INIT.md; insensitive directories resolve
    // the alias but still must honor authorization of the actual opened name.
    assert!(matches!(
        facts[".voktty/INIT.md"],
        PathFact::Blocked | PathFact::Absent
    ));
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::default()),
        Err(ReadError::Contract(_))
    ));
}
