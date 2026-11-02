use super::*;
use std::fs;
use std::sync::Mutex;

struct Access {
    root: PathBuf,
    reads: Mutex<Vec<PathBuf>>,
    replace: AtomicBool,
}
impl MemoryReadAccess for Access {
    fn allows_workspace_root(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_metadata(&self, _path: &Path) -> bool {
        true
    }
    fn allows_enumeration(&self, _path: &Path) -> bool {
        true
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().push(path.to_path_buf());
        if path.ends_with(".voktty/plans/a.md") && self.replace.swap(false, Ordering::AcqRel) {
            let plans = self.root.join(".voktty/plans");
            fs::rename(&plans, self.root.join("old-plans")).unwrap();
            fs::create_dir(&plans).unwrap();
            fs::write(plans.join("a.md"), "replacement").unwrap();
        }
        true
    }
}

fn fixture() -> (tempfile::TempDir, Access) {
    let dir = tempfile::tempdir_in("/dev/shm").unwrap();
    let root = dir.path().to_path_buf();
    for file in voktty_workspace_kit::render_template(
        serde_json::json!({"project_name":"Display", "created_at":"2026-11-02"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    {
        let path = root.join(file.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, file.text).unwrap();
    }
    (
        dir,
        Access {
            root,
            reads: Mutex::new(Vec::new()),
            replace: AtomicBool::new(false),
        },
    )
}

#[test]
fn wrong_root_never_reads_document_bodies_and_cancelled_requests_start_no_reads() {
    let (dir, access) = fixture();
    let expected = dir.path().join("other").to_str().unwrap().to_owned();
    assert!(matches!(
        read_local_memory_documents(
            dir.path(),
            &expected,
            &access,
            &crate::DiscoveryControl::default()
        ),
        Err(ReadError::StaleRoot)
    ));
    assert!(access
        .reads
        .lock()
        .unwrap()
        .iter()
        .all(|p| p.ends_with("kit.json")));
    access.reads.lock().unwrap().clear();
    let control = crate::DiscoveryControl::default();
    control.cancel();
    assert!(matches!(
        read_local_memory_documents(dir.path(), dir.path().to_str().unwrap(), &access, &control),
        Err(ReadError::Cancelled)
    ));
    assert!(access.reads.lock().unwrap().is_empty());
}

#[test]
fn replaced_document_directory_cannot_publish_a_snapshot() {
    let (dir, access) = fixture();
    fs::create_dir_all(dir.path().join(".voktty/plans")).unwrap();
    fs::write(dir.path().join(".voktty/plans/a.md"), "original").unwrap();
    access.replace.store(true, Ordering::Release);
    assert!(matches!(
        read_local_memory_documents(
            dir.path(),
            dir.path().to_str().unwrap(),
            &access,
            &crate::DiscoveryControl::default()
        ),
        Err(ReadError::StaleRoot)
    ));
}

#[test]
fn total_text_budget_is_honest_and_wire_expansion_cannot_exceed_the_reply_budget() {
    let (dir, access) = fixture();
    let plans = dir.path().join(".voktty/plans");
    fs::create_dir_all(&plans).unwrap();
    for i in 0..10 {
        fs::write(plans.join(format!("{i}.md")), vec![b'x'; 256 * 1024]).unwrap();
    }
    let result = read_local_memory_documents(
        dir.path(),
        dir.path().to_str().unwrap(),
        &access,
        &crate::DiscoveryControl::default(),
    )
    .unwrap();
    assert!(!result.complete);
    assert!(result.blocked_count > 0);
    let total: usize = result
        .files
        .iter()
        .filter_map(|file| {
            if let PathFact::File { text } = &file.fact {
                Some(text.len())
            } else {
                None
            }
        })
        .sum();
    assert!(total <= MAX_TEXT_BYTES);
    for i in 0..10 {
        fs::write(plans.join(format!("{i}.md")), vec![1u8; 256 * 1024]).unwrap();
    }
    assert!(matches!(
        read_local_memory_documents(
            dir.path(),
            dir.path().to_str().unwrap(),
            &access,
            &crate::DiscoveryControl::default()
        ),
        Err(ReadError::Limit)
    ));
}

#[test]
fn recursive_catalogue_has_a_directory_budget_even_without_document_files() {
    let (dir, access) = fixture();
    let plans = dir.path().join(".voktty/plans");
    fs::create_dir_all(&plans).unwrap();
    for i in 0..128 {
        fs::create_dir(plans.join(format!("directory-{i}"))).unwrap();
    }
    assert!(matches!(
        read_local_memory_documents(
            dir.path(),
            dir.path().to_str().unwrap(),
            &access,
            &crate::DiscoveryControl::default()
        ),
        Err(ReadError::Limit)
    ));
}
