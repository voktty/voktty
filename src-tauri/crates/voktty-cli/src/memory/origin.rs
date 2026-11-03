use super::{map_error, CliError, EXIT_REQUEST};
use std::path::{Path, PathBuf};
use voktty_memory_local::ReadError;

const APPLICATION_ID: &str = "app.voktty.voktty";

pub(super) fn parent() -> Result<Option<PathBuf>, CliError> {
    dirs::data_local_dir()
        .map(|base| resolve(&base))
        .transpose()
}

pub(super) fn required_parent() -> Result<PathBuf, CliError> {
    parent()?.ok_or_else(|| map_error(ReadError::Unavailable))
}

fn resolve(base: &Path) -> Result<PathBuf, CliError> {
    if !base.is_absolute() {
        return Err(map_error(ReadError::Unavailable));
    }
    let legacy = base.join("dev.voktty");
    match std::fs::symlink_metadata(&legacy) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => {
            match std::fs::symlink_metadata(legacy.join("project-memory")) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(legacy_error()),
            }
        }
        _ => return Err(legacy_error()),
    }
    Ok(base.join(APPLICATION_ID))
}

fn legacy_error() -> CliError {
    CliError::new(
        "memory_legacy_state_requires_review",
        "legacy CLI memory state requires explicit review before using the Desktop storage origin; no state was moved, merged or enabled; automatic migration is unavailable; memory run --no-memory bypasses private state",
        EXIT_REQUEST,
    )
}

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_matches_the_desktop_local_data_identifier_without_creating_state() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../../tauri.conf.json")).unwrap();
        assert_eq!(APPLICATION_ID, config["identifier"].as_str().unwrap());
        let base = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve(base.path()).unwrap(),
            base.path().join(APPLICATION_ID)
        );
        assert_eq!(std::fs::read_dir(base.path()).unwrap().count(), 0);
        assert!(resolve(Path::new("relative-fixture")).is_err());
    }
}
