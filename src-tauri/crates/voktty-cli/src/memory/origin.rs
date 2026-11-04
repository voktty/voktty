use super::{map_error, CliError, EXIT_REQUEST};
use std::path::{Path, PathBuf};
use voktty_memory_local::{
    resolve_memory_application_parent, MemoryOriginError, ReadControl, ReadError,
};

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
    resolve_memory_application_parent(base, &ReadControl::default()).map_err(|error| match error {
        MemoryOriginError::Read(error) => map_error(error),
        MemoryOriginError::LegacyStateRequiresReview => legacy_error(),
    })
}

fn legacy_error() -> CliError {
    CliError::new(
        "memory_legacy_state_requires_review",
        "legacy CLI memory state requires explicit review before using the Desktop storage origin; no state was moved, merged or enabled; automatic migration is unavailable; memory run --no-memory bypasses private state",
        EXIT_REQUEST,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use voktty_memory_local::MEMORY_APPLICATION_ID as APPLICATION_ID;

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
