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
    pub(crate) fn probe(
        &self,
        _: &std::ffi::OsStr,
    ) -> std::io::Result<Option<crate::discovery::EntryKind>> {
        match *self {}
    }
    pub(crate) fn open_child(
        &self,
        _: &std::ffi::OsStr,
        _: &Path,
        _: &ReadControl,
    ) -> Result<Self, ReadError> {
        match *self {}
    }
    pub(crate) fn revision(&self) -> std::io::Result<(i64, i64, i64, i64)> {
        match *self {}
    }
    pub(crate) fn entries(
        &self,
        _: &Path,
        _: &dyn MemoryReadAccess,
        _: &ReadControl,
        _: usize,
    ) -> Result<crate::discovery::DirectoryListing, ReadError> {
        match *self {}
    }
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
