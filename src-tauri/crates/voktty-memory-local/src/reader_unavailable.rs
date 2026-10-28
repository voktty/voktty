use crate::reader::{MemoryReadAccess, ReadControl, ReadError};
use std::path::{Path, PathBuf};
use voktty_workspace_kit::PathFact;

pub(crate) fn ensure_supported() -> Result<(), ReadError> {
    Err(ReadError::Unsupported)
}
pub(crate) fn validate_requested_root(_: &Path) -> Result<(), ReadError> {
    Err(ReadError::Unsupported)
}
pub(crate) enum Directory {}
impl Directory {
    pub(crate) fn open_root(_: &Path, _: &ReadControl) -> Result<Self, ReadError> {
        Err(ReadError::Unsupported)
    }
    pub(crate) fn identity(&self) -> (u64, u128) {
        match *self {}
    }
    pub(crate) fn canonical_root(&self, _: &Path) -> Result<PathBuf, ReadError> {
        match *self {}
    }
    pub(crate) fn filesystem_id(&self) -> String {
        match *self {}
    }
    pub(crate) fn read_text(
        &self,
        _: &Path,
        _: &str,
        _: &dyn MemoryReadAccess,
        _: &ReadControl,
    ) -> Result<PathFact, ReadError> {
        match *self {}
    }
}
