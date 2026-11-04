use crate::{bootstrap, is_link, ReadControl, ReadError};
use std::path::{Path, PathBuf};

pub const MEMORY_APPLICATION_ID: &str = "app.voktty.voktty";

#[derive(Debug)]
pub enum MemoryOriginError {
    Read(ReadError),
    LegacyStateRequiresReview,
}

/// The base must come from the native local application-data resolver.
/// This checks fixed legacy markers only; callers must still qualify the full
/// application directory chain before opening or creating private state.
pub fn resolve_memory_application_parent(
    base: &Path,
    control: &ReadControl,
) -> Result<PathBuf, MemoryOriginError> {
    bootstrap::validate_parent(base, control).map_err(MemoryOriginError::Read)?;
    let legacy = base.join("dev.voktty");
    match std::fs::symlink_metadata(&legacy) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => {
            match std::fs::symlink_metadata(legacy.join(bootstrap::PRIVATE_DIRECTORY)) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(MemoryOriginError::LegacyStateRequiresReview),
            }
        }
        _ => return Err(MemoryOriginError::LegacyStateRequiresReview),
    }
    control.check().map_err(MemoryOriginError::Read)?;
    Ok(base.join(MEMORY_APPLICATION_ID))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_origin_matches_desktop_and_resolution_creates_nothing() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
        assert_eq!(
            MEMORY_APPLICATION_ID,
            config["identifier"].as_str().unwrap()
        );
        let base = tempfile::tempdir().unwrap();
        let missing = base.path().join("missing");
        assert_eq!(
            resolve_memory_application_parent(&missing, &ReadControl::default()).unwrap(),
            missing.join(MEMORY_APPLICATION_ID)
        );
        assert_eq!(std::fs::read_dir(base.path()).unwrap().count(), 0);
        assert!(
            resolve_memory_application_parent(Path::new("relative"), &ReadControl::default())
                .is_err()
        );
    }

    #[test]
    fn any_legacy_entry_blocks_resolution_even_with_canonical_state() {
        for directory in [false, true] {
            let base = tempfile::tempdir().unwrap();
            std::fs::create_dir(base.path().join(MEMORY_APPLICATION_ID)).unwrap();
            let legacy = base.path().join("dev.voktty");
            std::fs::create_dir(&legacy).unwrap();
            assert!(
                resolve_memory_application_parent(base.path(), &ReadControl::default()).is_ok()
            );
            let state = legacy.join("project-memory");
            if directory {
                std::fs::create_dir(&state).unwrap();
            } else {
                std::fs::write(&state, b"unchanged legacy sentinel").unwrap();
            }
            assert!(matches!(
                resolve_memory_application_parent(base.path(), &ReadControl::default()),
                Err(MemoryOriginError::LegacyStateRequiresReview)
            ));
            if !directory {
                assert_eq!(std::fs::read(state).unwrap(), b"unchanged legacy sentinel");
            }
        }
    }
}
