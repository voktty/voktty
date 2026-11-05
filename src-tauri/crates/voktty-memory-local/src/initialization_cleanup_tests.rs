use super::*;
use crate::MemoryWriteAccess;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Access {
    root: PathBuf,
    action: u8,
    removals: AtomicUsize,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        path == self.root
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_enumeration(&self, _: &Path) -> bool {
        false
    }
}
impl MemoryWriteAccess for Access {
    fn allows_create(&self, _: &Path) -> bool {
        false
    }
    fn allows_replace(&self, _: &Path) -> bool {
        false
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        if path != self.root.join(crate::PROJECT_INITIALIZATION_RECORD) {
            return false;
        }
        if self.removals.fetch_add(1, Ordering::SeqCst) == 1 {
            match self.action {
                1 => {
                    fs::remove_file(path).unwrap();
                    fs::write(path, "replacement").unwrap();
                }
                2 => {
                    fs::rename(self.root.join(".voktty"), self.root.join("saved-kit")).unwrap();
                    fs::create_dir(self.root.join(".voktty")).unwrap();
                    fs::write(path, "replacement").unwrap();
                }
                3 => {
                    fs::rename(&self.root, self.root.with_extension("saved")).unwrap();
                    fs::create_dir_all(self.root.join(".voktty")).unwrap();
                    fs::write(path, "replacement").unwrap();
                }
                4 => return false,
                _ => {}
            }
        }
        true
    }
}

fn fixture(action: u8) -> (tempfile::TempDir, Access) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("project");
    fs::create_dir_all(root.join(".voktty")).unwrap();
    fs::write(
        root.join(crate::PROJECT_INITIALIZATION_RECORD),
        "owned record",
    )
    .unwrap();
    (
        temp,
        Access {
            root,
            action,
            removals: AtomicUsize::new(0),
        },
    )
}

fn cleanup(access: &Access, expected: &str) -> Result<(), ReadError> {
    let control = ReadControl::default();
    Directory::open_root(&access.root, &control)?.cleanup_initialization_record(
        &access.root,
        expected,
        access,
        access,
        &control,
    )
}

#[test]
fn removes_only_the_matching_record_and_preserves_unrelated_files() {
    let (_temp, access) = fixture(0);
    let path = access.root.join(crate::PROJECT_INITIALIZATION_RECORD);
    fs::write(access.root.join(".voktty/CONTEXT.md"), "project facts").unwrap();
    assert_eq!(
        cleanup(&access, "wrong record"),
        Err(ReadError::Unavailable)
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "owned record");
    cleanup(&access, "owned record").unwrap();
    assert!(!path.exists());
    assert_eq!(
        fs::read_to_string(access.root.join(".voktty/CONTEXT.md")).unwrap(),
        "project facts"
    );
}

#[test]
fn late_replacement_root_parent_file_or_authority_is_preserved() {
    for action in 1..=4 {
        let (_temp, access) = fixture(action);
        assert!(cleanup(&access, "owned record").is_err());
        let expected = if action == 4 {
            "owned record"
        } else {
            "replacement"
        };
        assert_eq!(
            fs::read_to_string(access.root.join(crate::PROJECT_INITIALIZATION_RECORD)).unwrap(),
            expected
        );
        if action == 2 {
            assert_eq!(
                fs::read_to_string(access.root.join("saved-kit/.initialization.json")).unwrap(),
                "owned record"
            );
        }
        if action == 3 {
            assert_eq!(
                fs::read_to_string(
                    access
                        .root
                        .with_extension("saved")
                        .join(crate::PROJECT_INITIALIZATION_RECORD)
                )
                .unwrap(),
                "owned record"
            );
        }
    }
}

#[test]
fn linked_records_never_remove_the_link_or_its_target() {
    for hardlink in [false, true] {
        let (_temp, access) = fixture(0);
        let path = access.root.join(crate::PROJECT_INITIALIZATION_RECORD);
        let other = access.root.join("owned-elsewhere");
        fs::rename(&path, &other).unwrap();
        if hardlink {
            fs::hard_link(&other, &path).unwrap();
        } else {
            std::os::unix::fs::symlink(&other, &path).unwrap();
        }
        assert!(cleanup(&access, "owned record").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "owned record");
        assert_eq!(fs::read_to_string(&other).unwrap(), "owned record");
    }
}
