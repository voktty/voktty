use std::ffi::{CString, OsStr};
use std::fs::{self, File};
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path};

use crate::reader::{MemoryReadAccess, ReadControl, ReadError};
use voktty_workspace_kit::PathFact;

pub(crate) fn ensure_supported() -> Result<(), ReadError> {
    Ok(())
}

pub(crate) struct Directory {
    file: File,
    metadata: fs::Metadata,
}

fn open_at(parent: &File, name: &OsStr, directory: bool) -> io::Result<File> {
    let name =
        CString::new(name.as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    let flags = libc::O_RDONLY
        | libc::O_NOFOLLOW
        | libc::O_CLOEXEC
        | libc::O_NONBLOCK
        | if directory { libc::O_DIRECTORY } else { 0 };
    // Each component is opened relative to an owned directory descriptor. No
    // symlink can redirect a later content read through a replaced path prefix.
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if descriptor < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }
}

impl Directory {
    pub(crate) fn open_root(path: &Path, control: &ReadControl) -> Result<Self, ReadError> {
        control.check()?;
        let mut file = File::open("/").map_err(|_| ReadError::Io)?;
        for part in path.components() {
            control.check()?;
            match part {
                Component::RootDir => {}
                Component::Normal(name) => {
                    file = open_at(&file, name, true).map_err(|_| ReadError::Io)?
                }
                _ => return Err(ReadError::InvalidInput),
            }
        }
        let metadata = file.metadata().map_err(|_| ReadError::Io)?;
        control.check()?;
        if !metadata.is_dir() {
            return Err(ReadError::InvalidInput);
        }
        Ok(Self { file, metadata })
    }

    pub(crate) fn identity(&self) -> (u64, u64) {
        (self.metadata.dev(), self.metadata.ino())
    }
    pub(crate) fn filesystem_id(&self) -> String {
        format!("unix-device:{}", self.metadata.dev())
    }

    pub(crate) fn read_text(
        &self,
        root: &Path,
        relative: &str,
        access: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<PathFact, ReadError> {
        let full = root.join(relative);
        if !access.allows_read(&full) {
            return Ok(PathFact::Blocked);
        }
        let parts: Vec<_> = Path::new(relative).components().collect();
        if parts.is_empty()
            || parts.len() > 64
            || parts
                .iter()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(ReadError::InvalidInput);
        }
        let mut directory = self.file.try_clone().map_err(|_| ReadError::Io)?;
        let mut current = root.to_path_buf();
        for (index, part) in parts.iter().enumerate() {
            control.check()?;
            let Component::Normal(name) = part else {
                return Err(ReadError::InvalidInput);
            };
            current.push(name);
            let is_directory = index + 1 < parts.len();
            if is_directory && !access.allows_metadata(&current) {
                return Ok(PathFact::Blocked);
            }
            let file = match open_at(&directory, name, is_directory) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    control.check()?;
                    return Ok(PathFact::Absent);
                }
                Err(_) => return Ok(PathFact::Blocked),
            };
            if is_directory {
                directory = file;
                continue;
            }
            let before = file.metadata().map_err(|_| ReadError::Io)?;
            if !before.is_file() || before.nlink() != 1 || before.len() > 256 * 1024 {
                return Ok(PathFact::Blocked);
            }
            let mut bytes = Vec::new();
            let mut bounded = file.take(256 * 1024 + 1);
            if bounded.read_to_end(&mut bytes).is_err() {
                return Ok(PathFact::Blocked);
            }
            control.check()?;
            let after = bounded.get_ref().metadata().map_err(|_| ReadError::Io)?;
            if !same_file(&before, &after) || bytes.len() > 256 * 1024 || !access.allows_read(&full)
            {
                return Ok(PathFact::Blocked);
            }
            return Ok(match String::from_utf8(bytes) {
                Ok(text) if !text.contains('\0') => PathFact::File { text },
                _ => PathFact::Blocked,
            });
        }
        Err(ReadError::InvalidInput)
    }
}

fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    a.dev() == b.dev()
        && a.ino() == b.ino()
        && a.len() == b.len()
        && b.nlink() == 1
        && a.mtime() == b.mtime()
        && a.mtime_nsec() == b.mtime_nsec()
        && a.ctime() == b.ctime()
        && a.ctime_nsec() == b.ctime_nsec()
}
