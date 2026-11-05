use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

const PROBE_PATH: &str = "VOKTTY_TEST_RECORD_LOCK_PATH";
const PROBE_EXPECTED: &str = "VOKTTY_TEST_RECORD_LOCK_EXPECTED";

#[test]
fn child_probes_record() {
    let Some(path) = std::env::var_os(PROBE_PATH) else {
        return;
    };
    let file = std::fs::File::open(path).unwrap();
    let result = lock_record(&file);
    if std::env::var(PROBE_EXPECTED).unwrap() == "busy" {
        assert_eq!(result, Err(ReadError::Busy));
    } else {
        result.unwrap();
    }
    if std::env::var(PROBE_EXPECTED).unwrap() == "exit" {
        std::process::exit(29);
    }
    let mut text = String::new();
    (&file).read_to_string(&mut text).unwrap();
    assert!(!text.is_empty());
}

fn probe(path: &Path, expected: &str) {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "publication::project_initialization::record_lock_tests::child_probes_record",
            "--nocapture",
        ])
        .env(PROBE_PATH, path)
        .env(PROBE_EXPECTED, expected)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "record lock probe failed: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
}

#[test]
fn record_lock_is_released_when_the_owning_process_exits() {
    let project = tempfile::tempdir().unwrap();
    let record = project.path().join("record");
    fs::write(&record, "interrupted record").unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "publication::project_initialization::record_lock_tests::child_probes_record",
        ])
        .env(PROBE_PATH, &record)
        .env(PROBE_EXPECTED, "exit")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(29));
    probe(&record, "released");
    assert_eq!(fs::read(&record).unwrap(), b"interrupted record");
}

struct Access {
    root: PathBuf,
    checked_stage: AtomicBool,
    checked_record: AtomicBool,
    interrupt: bool,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
}

impl crate::MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        if path == self.root.join(PROJECT_INITIALIZATION_RECORD) {
            if let Ok(entries) = fs::read_dir(self.root.join(".voktty")) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".voktty-stage-")
                        && !self.checked_stage.swap(true, Ordering::AcqRel)
                    {
                        probe(&entry.path(), "busy");
                    }
                }
            }
        }
        let record = self.root.join(PROJECT_INITIALIZATION_RECORD);
        if path.ends_with("INIT.md")
            && record.exists()
            && !self.checked_record.swap(true, Ordering::AcqRel)
        {
            probe(&record, "busy");
        }
        path.starts_with(&self.root)
            && !(self.interrupt
                && path.ends_with("RULES.md")
                && self.root.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
}

#[test]
fn record_is_locked_before_publication_and_released_after_success_or_interruption() {
    for interrupt in [false, true] {
        let project = tempfile::tempdir().unwrap();
        let access = Arc::new(Access {
            root: fs::canonicalize(project.path()).unwrap(),
            checked_stage: AtomicBool::new(false),
            checked_record: AtomicBool::new(false),
            interrupt,
        });
        let control = DiscoveryControl::default();
        let review = OwnedProjectInitializationPreview::prepare_at_project_root(
            ProjectInitializationRequest {
                origin: access.root.clone(),
                destination: access.root.clone(),
                origin_access: access.clone(),
                destination_access: access.clone(),
                inputs: serde_json::json!({
                    "project_name":"Record lifecycle", "created_at":"2026-11-05"
                })
                .as_object()
                .unwrap()
                .clone(),
                links: RootLinks::default(),
            },
            &control,
        )
        .unwrap();
        let digest = review.acceptance_digest();
        let result = review.publish(&digest, access.as_ref(), &control);
        assert!(access.checked_stage.load(Ordering::Acquire));
        assert!(access.checked_record.load(Ordering::Acquire));
        let record = access.root.join(PROJECT_INITIALIZATION_RECORD);
        if interrupt {
            assert!(result.is_err());
            let before = fs::read(&record).unwrap();
            let value: Value = serde_json::from_slice(&before).unwrap();
            assert_eq!(value["activityLock"], "record-v1");
            probe(&record, "released");
            assert_eq!(fs::read(&record).unwrap(), before);
        } else {
            result.unwrap();
            assert!(!record.exists());
        }
    }
}
