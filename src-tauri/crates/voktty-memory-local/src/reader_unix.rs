use std::ffi::{CStr, CString, OsStr, OsString};
use std::fs::{self, File};
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

use crate::discovery::{DirectoryEntry, DirectoryListing, EntryKind};
use crate::reader::{MemoryReadAccess, ReadControl, ReadError};
use voktty_workspace_kit::PathFact;

pub(crate) fn ensure_supported() -> Result<(), ReadError> {
    Ok(())
}

pub(crate) fn validate_requested_root(_: &Path) -> Result<(), ReadError> {
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
    pub(crate) fn probe(&self, name: &OsStr) -> io::Result<Option<EntryKind>> {
        let name = CString::new(name.as_bytes())
            .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe {
            libc::fstatat(
                self.file.as_raw_fd(),
                name.as_ptr(),
                metadata.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            let error = io::Error::last_os_error();
            return if error.kind() == io::ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(error)
            };
        }
        let metadata = unsafe { metadata.assume_init() };
        Ok(Some(match metadata.st_mode & libc::S_IFMT {
            libc::S_IFDIR => EntryKind::Directory,
            libc::S_IFREG => EntryKind::File,
            libc::S_IFLNK => EntryKind::Link,
            _ => EntryKind::Other,
        }))
    }
    pub(crate) fn open_child(
        &self,
        name: &OsStr,
        _: &Path,
        control: &ReadControl,
    ) -> Result<Self, ReadError> {
        control.check()?;
        let file = open_at(&self.file, name, true).map_err(|_| ReadError::Io)?;
        let metadata = file.metadata().map_err(|_| ReadError::Io)?;
        control.check()?;
        Ok(Self { file, metadata })
    }
    pub(crate) fn revision(&self) -> io::Result<(i64, i64, i64, i64)> {
        let m = self.file.metadata()?;
        Ok((m.mtime(), m.mtime_nsec(), m.ctime(), m.ctime_nsec()))
    }
    pub(crate) fn entries(
        &self,
        path: &Path,
        access: &dyn MemoryReadAccess,
        control: &ReadControl,
        limit: usize,
    ) -> Result<DirectoryListing, ReadError> {
        control.check()?;
        if !access.allows_enumeration(path) {
            return Err(ReadError::Denied);
        }
        let errno = errno_pointer().ok_or(ReadError::Unsupported)?;
        let descriptor = self
            .file
            .try_clone()
            .map_err(|_| ReadError::Io)?
            .into_raw_fd();
        let raw = unsafe { libc::fdopendir(descriptor) };
        if raw.is_null() {
            unsafe { libc::close(descriptor) };
            return Err(ReadError::Io);
        }
        struct Stream(*mut libc::DIR);
        impl Drop for Stream {
            fn drop(&mut self) {
                unsafe { libc::closedir(self.0) };
            }
        }
        let stream = Stream(raw);
        unsafe { libc::rewinddir(stream.0) };
        let mut entries = Vec::new();
        while entries.len() < limit {
            control.check()?;
            unsafe { *errno = 0 };
            let record = unsafe { libc::readdir(stream.0) };
            if record.is_null() {
                return if unsafe { *errno } == 0 {
                    Ok(DirectoryListing {
                        entries,
                        complete: true,
                    })
                } else {
                    Err(ReadError::Io)
                };
            }
            let bytes = unsafe { CStr::from_ptr((*record).d_name.as_ptr()) }.to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            let name = OsString::from_vec(bytes.to_vec());
            if !access.allows_metadata(&path.join(&name)) {
                return Err(ReadError::Denied);
            }
            let kind = self
                .probe(&name)
                .map_err(|_| ReadError::Io)?
                .ok_or(ReadError::StaleRoot)?;
            entries.push(DirectoryEntry { name, kind });
        }
        Ok(DirectoryListing {
            entries,
            complete: false,
        })
    }
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

    pub(crate) fn identity(&self) -> (u64, u128) {
        (self.metadata.dev(), self.metadata.ino().into())
    }
    pub(crate) fn canonical_root(&self, root: &Path) -> Result<PathBuf, ReadError> {
        Ok(root.to_path_buf())
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

fn errno_pointer() -> Option<*mut libc::c_int> {
    #[cfg(target_os = "linux")]
    {
        Some(unsafe { libc::__errno_location() })
    }
    #[cfg(target_os = "android")]
    {
        Some(unsafe { libc::__errno() })
    }
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly"
    ))]
    {
        Some(unsafe { libc::__error() })
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly"
    )))]
    {
        None
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
