use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{self, Read};
use std::mem::{offset_of, size_of};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::path::{Component, Path, PathBuf, Prefix};
use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    NtCreateFile, FILE_CREATE, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
    FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
};
use windows_sys::Win32::Foundation::{RtlNtStatusToDosError, OBJ_CASE_INSENSITIVE, UNICODE_STRING};
use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

use crate::discovery::{DirectoryEntry, DirectoryListing, EntryKind};
use crate::reader::{MemoryReadAccess, ReadControl, ReadError};
use voktty_workspace_kit::PathFact;
use windows_sys::Win32::Storage::FileSystem::{
    FileBasicInfo, FileCaseSensitiveInfo, FileIdBothDirectoryInfo, FileIdBothDirectoryRestartInfo,
    FileIdInfo, FileStandardInfo, GetDriveTypeW, GetFileInformationByHandleEx, GetFileType,
    GetFinalPathNameByHandleW, DELETE, FILE_ATTRIBUTE_DEVICE, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_CASE_SENSITIVE_INFO, FILE_ID_BOTH_DIR_INFO,
    FILE_ID_INFO, FILE_INFO_BY_HANDLE_CLASS, FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES,
    FILE_READ_DATA, FILE_SHARE_READ, FILE_STANDARD_INFO, FILE_TRAVERSE, FILE_TYPE_DISK,
    FILE_WRITE_DATA, SYNCHRONIZE,
};

#[path = "publication_windows.rs"]
mod publication;

pub(crate) fn ensure_supported() -> Result<(), ReadError> {
    Ok(())
}

fn drive(path: &Path) -> Result<PathBuf, ReadError> {
    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return Err(ReadError::Unsupported);
    };
    let letter = match prefix.kind() {
        Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => letter,
        _ => return Err(ReadError::Unsupported),
    };
    if !matches!(components.next(), Some(Component::RootDir)) {
        return Err(ReadError::InvalidInput);
    }
    Ok(PathBuf::from(format!("{}:\\", char::from(letter))))
}

pub(crate) fn validate_requested_root(path: &Path) -> Result<(), ReadError> {
    let root = drive(path)?;
    if path
        .components()
        .any(|part| matches!(part, Component::Normal(name) if name.to_string_lossy().contains(':')))
    {
        return Err(ReadError::InvalidInput);
    }
    let wide: Vec<_> = root.as_os_str().encode_wide().chain(Some(0)).collect();
    // UNC, device namespaces and mapped network drives belong to separately
    // qualified transports, never an implicit local read or canonicalization.
    match unsafe { GetDriveTypeW(wide.as_ptr()) } {
        2 | 3 | 5 | 6 => Ok(()),
        _ => Err(ReadError::Unsupported),
    }
}

#[derive(PartialEq, Eq)]
struct FileState {
    volume: u64,
    id: u128,
    size: i64,
    links: u32,
    directory: bool,
    delete_pending: bool,
    attributes: u32,
    created: i64,
    written: i64,
    changed: i64,
}

fn information<T: Default>(file: &File, class: FILE_INFO_BY_HANDLE_CLASS) -> io::Result<T> {
    let mut value = T::default();
    let result = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            class,
            (&mut value as *mut T).cast(),
            size_of::<T>() as u32,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(value)
    }
}

fn state(file: &File) -> io::Result<FileState> {
    if unsafe { GetFileType(file.as_raw_handle()) } != FILE_TYPE_DISK {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let id: FILE_ID_INFO = information(file, FileIdInfo)?;
    let basic: FILE_BASIC_INFO = information(file, FileBasicInfo)?;
    let standard: FILE_STANDARD_INFO = information(file, FileStandardInfo)?;
    Ok(FileState {
        volume: id.VolumeSerialNumber,
        id: u128::from_le_bytes(id.FileId.Identifier),
        size: standard.EndOfFile,
        links: standard.NumberOfLinks,
        directory: standard.Directory,
        delete_pending: standard.DeletePending,
        attributes: basic.FileAttributes,
        created: basic.CreationTime,
        written: basic.LastWriteTime,
        changed: basic.ChangeTime,
    })
}

fn final_path(file: &File) -> Result<PathBuf, ReadError> {
    let mut wide = vec![0u16; 32768];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            wide.as_mut_ptr(),
            wide.len() as u32,
            0,
        )
    };
    if length == 0 || length as usize >= wide.len() {
        return Err(ReadError::Io);
    }
    let text = String::from_utf16(&wide[..length as usize]).map_err(|_| ReadError::InvalidInput)?;
    Ok(PathBuf::from(text))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OpenKind {
    Directory,
    Enumerate,
    File,
    Metadata,
    CreateDirectory,
    CreateFile,
}

impl OpenKind {
    fn directory(self) -> bool {
        matches!(
            self,
            Self::Directory | Self::Enumerate | Self::CreateDirectory
        )
    }

    fn create(self) -> bool {
        matches!(self, Self::CreateDirectory | Self::CreateFile)
    }
}
fn open_kind(parent: Option<&File>, name: &OsStr, kind: OpenKind) -> io::Result<(File, FileState)> {
    let mut wide: Vec<_> = name.encode_wide().collect();
    if wide.is_empty() || wide.len() > 32767 || wide.contains(&0) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    if parent.is_some() && wide.iter().any(|c| matches!(*c, 47 | 92 | 58)) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let insensitive = if let Some(parent) = parent {
        let info: FILE_CASE_SENSITIVE_INFO = information(parent, FileCaseSensitiveInfo)?;
        if info.Flags & !1 != 0 {
            return Err(io::ErrorKind::Unsupported.into());
        }
        info.Flags & 1 == 0
    } else {
        true
    };
    let unicode = UNICODE_STRING {
        Length: (wide.len() * 2) as u16,
        MaximumLength: (wide.len() * 2) as u16,
        Buffer: wide.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.map_or(std::ptr::null_mut(), |p| p.as_raw_handle()),
        ObjectName: &unicode,
        Attributes: if insensitive { OBJ_CASE_INSENSITIVE } else { 0 },
        ..Default::default()
    };
    let mut status_block = IO_STATUS_BLOCK::default();
    let mut handle = std::ptr::null_mut();
    let desired = FILE_READ_ATTRIBUTES
        | SYNCHRONIZE
        | match kind {
            OpenKind::Directory | OpenKind::CreateDirectory => FILE_TRAVERSE,
            OpenKind::Enumerate => FILE_TRAVERSE | FILE_LIST_DIRECTORY,
            OpenKind::File => FILE_READ_DATA,
            OpenKind::Metadata => 0,
            OpenKind::CreateFile => FILE_READ_DATA | FILE_WRITE_DATA | DELETE,
        };
    let options = FILE_OPEN_REPARSE_POINT
        | FILE_SYNCHRONOUS_IO_NONALERT
        | match kind {
            OpenKind::Directory | OpenKind::Enumerate | OpenKind::CreateDirectory => {
                FILE_DIRECTORY_FILE
            }
            OpenKind::File | OpenKind::CreateFile => FILE_NON_DIRECTORY_FILE,
            OpenKind::Metadata => 0,
        };
    // Relative calls carry exactly one component. FILE_OPEN_REPARSE_POINT opens
    // that entry itself; no absolute prefix can be reinterpreted after validation.
    let result = unsafe {
        NtCreateFile(
            &mut handle,
            desired,
            &attributes,
            &mut status_block,
            std::ptr::null(),
            0,
            FILE_SHARE_READ,
            if kind.create() {
                FILE_CREATE
            } else {
                FILE_OPEN
            },
            options,
            std::ptr::null(),
            0,
        )
    };
    if result < 0 {
        return Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(result) } as i32,
        ));
    }
    if handle.is_null() {
        return Err(io::ErrorKind::Other.into());
    }
    let file = unsafe { File::from_raw_handle(handle) };
    if result != 0 {
        return Err(io::ErrorKind::Other.into());
    }
    let metadata = state(&file)?;
    if (kind != OpenKind::Metadata
        && (metadata.directory != kind.directory()
            || metadata.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0))
        || metadata.delete_pending
    {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    Ok((file, metadata))
}
fn open(parent: Option<&File>, name: &OsStr, directory: bool) -> io::Result<(File, FileState)> {
    open_kind(
        parent,
        name,
        if directory {
            OpenKind::Directory
        } else {
            OpenKind::File
        },
    )
}

pub(crate) struct Directory {
    // Keep the ancestor objects alive; child lookup is relative to these handles,
    // never an absolute path assembled from names that could change underneath us.
    ancestors: Vec<File>,
    path: PathBuf,
    state: FileState,
}

impl Directory {
    pub(crate) fn probe(&self, name: &OsStr) -> io::Result<Option<EntryKind>> {
        let parent = self.ancestors.last().ok_or(io::ErrorKind::InvalidInput)?;
        match open_kind(Some(parent), name, OpenKind::Metadata) {
            Ok((_, state)) => Ok(Some(
                if state.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    EntryKind::Link
                } else if state.directory {
                    EntryKind::Directory
                } else if state.attributes & FILE_ATTRIBUTE_DEVICE != 0 {
                    EntryKind::Other
                } else {
                    EntryKind::File
                },
            )),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    pub(crate) fn open_child(
        &self,
        name: &OsStr,
        path: &Path,
        control: &ReadControl,
    ) -> Result<Self, ReadError> {
        control.check()?;
        let (file, state) = open(self.ancestors.last(), name, true).map_err(|_| ReadError::Io)?;
        control.check()?;
        Ok(Self {
            ancestors: vec![file],
            path: path.to_path_buf(),
            state,
        })
    }
    pub(crate) fn revision(&self) -> io::Result<(i64, i64, i64, i64)> {
        let state = state(self.ancestors.last().ok_or(io::ErrorKind::InvalidInput)?)?;
        Ok((state.written, 0, state.changed, 0))
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
        let (file, state) = open_kind(self.ancestors.last(), OsStr::new("."), OpenKind::Enumerate)
            .map_err(|_| ReadError::Io)?;
        if (state.volume, state.id) != self.identity() {
            return Err(ReadError::StaleRoot);
        }
        let mut storage = vec![0u64; 8192];
        let capacity = storage.len() * 8;
        let mut entries = Vec::new();
        let mut restart = true;
        while entries.len() < limit {
            control.check()?;
            storage.fill(0);
            let class = if restart {
                FileIdBothDirectoryRestartInfo
            } else {
                FileIdBothDirectoryInfo
            };
            restart = false;
            if unsafe {
                GetFileInformationByHandleEx(
                    file.as_raw_handle(),
                    class,
                    storage.as_mut_ptr().cast(),
                    capacity as u32,
                )
            } == 0
            {
                let error = io::Error::last_os_error();
                return if error.raw_os_error() == Some(18) {
                    Ok(DirectoryListing {
                        entries,
                        complete: true,
                    })
                } else {
                    Err(ReadError::Io)
                };
            }
            let mut offset = 0;
            loop {
                if capacity - offset < size_of::<FILE_ID_BOTH_DIR_INFO>() {
                    return Err(ReadError::Io);
                }
                let base = unsafe { storage.as_ptr().cast::<u8>().add(offset) };
                let record =
                    unsafe { std::ptr::read_unaligned(base.cast::<FILE_ID_BOTH_DIR_INFO>()) };
                let end = if record.NextEntryOffset == 0 {
                    capacity
                } else {
                    let next = record.NextEntryOffset as usize;
                    if !next.is_multiple_of(8)
                        || next < size_of::<FILE_ID_BOTH_DIR_INFO>()
                        || next > capacity - offset
                    {
                        return Err(ReadError::Io);
                    }
                    offset + next
                };
                let start = offset + offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
                let length = record.FileNameLength as usize;
                if length == 0 || !length.is_multiple_of(2) || length > end.saturating_sub(start) {
                    return Err(ReadError::Io);
                }
                let units = unsafe {
                    std::slice::from_raw_parts(
                        storage.as_ptr().cast::<u8>().add(start).cast::<u16>(),
                        length / 2,
                    )
                };
                let name = OsString::from_wide(units);
                if name != "." && name != ".." {
                    if Path::new(&name).components().count() != 1
                        || !matches!(
                            Path::new(&name).components().next(),
                            Some(Component::Normal(_))
                        )
                    {
                        return Err(ReadError::InvalidInput);
                    }
                    if !access.allows_metadata(&path.join(&name)) {
                        return Err(ReadError::Denied);
                    }
                    let kind = if record.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                        EntryKind::Link
                    } else if record.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
                        EntryKind::Directory
                    } else if record.FileAttributes & FILE_ATTRIBUTE_DEVICE != 0 {
                        EntryKind::Other
                    } else {
                        EntryKind::File
                    };
                    entries.push(DirectoryEntry { name, kind });
                    if entries.len() == limit {
                        return Ok(DirectoryListing {
                            entries,
                            complete: false,
                        });
                    }
                }
                if record.NextEntryOffset == 0 {
                    break;
                }
                offset = end;
            }
        }
        Ok(DirectoryListing {
            entries,
            complete: false,
        })
    }
    pub(crate) fn open_root(path: &Path, control: &ReadControl) -> Result<Self, ReadError> {
        validate_requested_root(path)?;
        let volume_root = drive(path)?;
        let mut ancestors = Vec::new();
        let mut observed = None;
        for part in path.components() {
            control.check()?;
            match part {
                Component::Prefix(_) => continue,
                Component::RootDir | Component::Normal(_) => {}
                _ => return Err(ReadError::InvalidInput),
            }
            let (file, metadata) = if matches!(part, Component::RootDir) {
                let native = format!(
                    "\\??\\{}",
                    volume_root.to_str().ok_or(ReadError::InvalidInput)?
                );
                open(None, OsStr::new(&native), true)
            } else {
                open(ancestors.last(), part.as_os_str(), true)
            }
            .map_err(|_| ReadError::Io)?;
            ancestors.push(file);
            observed = Some(metadata);
        }
        control.check()?;
        Ok(Self {
            ancestors,
            path: path.to_path_buf(),
            state: observed.ok_or(ReadError::InvalidInput)?,
        })
    }

    pub(crate) fn identity(&self) -> (u64, u128) {
        (self.state.volume, self.state.id)
    }
    pub(crate) fn filesystem_id(&self) -> String {
        format!("windows-volume:{:016x}", self.state.volume)
    }

    pub(crate) fn canonical_root(&self, _: &Path) -> Result<PathBuf, ReadError> {
        let file = self.ancestors.last().ok_or(ReadError::InvalidInput)?;
        let resolved = final_path(file)?;
        validate_requested_root(&resolved)?;
        Ok(resolved)
    }

    pub(crate) fn read_text(
        &self,
        root: &Path,
        relative: &str,
        access: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<PathFact, ReadError> {
        if root != self.path {
            return Err(ReadError::StaleRoot);
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
        let full = root.join(relative);
        if !access.allows_read(&full) {
            return Ok(PathFact::Blocked);
        }
        let mut current = root.to_path_buf();
        let mut pinned = Vec::new();
        for (index, part) in parts.iter().enumerate() {
            control.check()?;
            current.push(part.as_os_str());
            let directory = index + 1 < parts.len();
            if directory && !access.allows_metadata(&current) {
                return Ok(PathFact::Blocked);
            }
            let parent = pinned
                .last()
                .or_else(|| self.ancestors.last())
                .ok_or(ReadError::InvalidInput)?;
            let (file, before) = match open(Some(parent), part.as_os_str(), directory) {
                Ok(observation) => observation,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    control.check()?;
                    return Ok(PathFact::Absent);
                }
                Err(_) => return Ok(PathFact::Blocked),
            };
            if directory {
                pinned.push(file);
                continue;
            }
            if before.links != 1 || !(0..=256 * 1024).contains(&before.size) {
                return Ok(PathFact::Blocked);
            }
            let actual = final_path(&file)?;
            if !access.allows_read(&actual) {
                return Ok(PathFact::Blocked);
            }
            control.check()?;
            let mut bounded = file.take(256 * 1024 + 1);
            let mut bytes = Vec::new();
            if bounded.read_to_end(&mut bytes).is_err() {
                return Ok(PathFact::Blocked);
            }
            control.check()?;
            let after = state(bounded.get_ref()).map_err(|_| ReadError::Io)?;
            if before != after
                || bytes.len() > 256 * 1024
                || !access.allows_read(&full)
                || !access.allows_read(&actual)
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
