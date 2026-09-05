//! An SFTP channel bound to a native session.
//!
//! Every path is resolved against the authorized root before it reaches the
//! server. Reopening happens only for a dead transport, never for a refused
//! operation; see `failure`.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileAttributes;
use serde::Serialize;
use tokio::sync::Mutex;

use super::super::cells;
use super::super::connection::NativeChain;
use super::super::state::SessionLease;
use super::super::types::{SshErrorCode, SshNativeError};
use super::failure::{self, is_transport_dead};
use super::paths;

/// Matches the cap the existing remote helper applies, so a media preview
/// behaves the same on either backend.
pub const MAX_BINARY_BYTES: usize = 32 * 1024 * 1024;
/// A text document beyond this is not something the editor should open.
pub const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;
/// A directory larger than this is paged by the caller, not returned whole.
pub const MAX_ENTRIES: usize = 10_000;
/// Bounds a recursive delete against a hostile or looping tree.
pub const MAX_DELETE_ENTRIES: usize = 50_000;
const MAX_DELETE_DEPTH: usize = 64;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub mode: Option<u32>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStat {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub mode: Option<u32>,
}

fn modified_ms(attrs: &FileAttributes) -> Option<u64> {
    attrs.mtime.map(|seconds| u64::from(seconds) * 1_000)
}

fn entry_from(path: String, name: String, attrs: &FileAttributes) -> RemoteEntry {
    RemoteEntry {
        name,
        path,
        is_dir: attrs.is_dir(),
        is_symlink: attrs.is_symlink(),
        size: attrs.size.unwrap_or(0),
        modified_ms: modified_ms(attrs),
        mode: attrs.permissions,
    }
}

pub struct NativeSftp {
    lease: SessionLease<Arc<NativeChain>>,
    session: Mutex<SftpSession>,
    root: String,
}

/// Only the root: a live channel has nothing safe or useful to print.
impl std::fmt::Debug for NativeSftp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeSftp")
            .field("root", &self.root)
            .finish()
    }
}

type SftpFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, SftpError>> + Send + 'a>>;

impl NativeSftp {
    /// Open an SFTP channel on the session the lease points at.
    pub async fn open(
        lease: SessionLease<Arc<NativeChain>>,
        root: String,
    ) -> Result<Self, SshNativeError> {
        let root = paths::normalize(&root);
        let session = Self::open_channel(&lease).await?;
        Ok(Self {
            lease,
            session: Mutex::new(session),
            root,
        })
    }

    async fn open_channel(
        lease: &SessionLease<Arc<NativeChain>>,
    ) -> Result<SftpSession, SshNativeError> {
        let chain = cells::read(lease.cell());
        let channel = chain
            .destination()
            .channel_open_session()
            .await
            .map_err(|error| {
                SshNativeError::new(
                    SshErrorCode::Unreachable,
                    format!("cannot open an SFTP channel: {error}"),
                )
            })?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|error| {
                SshNativeError::new(
                    SshErrorCode::Protocol,
                    format!("the server refused the sftp subsystem: {error}"),
                )
            })?;
        SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| failure::classify(error, "sftp handshake"))
    }

    pub fn root(&self) -> &str {
        &self.root
    }

    pub fn resolve(&self, path: &str) -> Result<String, SshNativeError> {
        paths::resolve_within(&self.root, path)
    }

    /// Run one SFTP operation, reopening the channel and retrying exactly once
    /// when the transport died. A refused operation is returned as-is: retrying
    /// a permission error only doubles the load.
    async fn run<T, F>(&self, context: &str, operation: F) -> Result<T, SshNativeError>
    where
        F: for<'a> Fn(&'a SftpSession) -> SftpFuture<'a, T>,
    {
        let first = {
            let session = self.session.lock().await;
            operation(&session).await
        };
        let error = match first {
            Ok(value) => return Ok(value),
            Err(error) => error,
        };
        if !is_transport_dead(&error) {
            return Err(failure::classify(error, context));
        }

        let reopened = Self::open_channel(&self.lease).await?;
        let mut session = self.session.lock().await;
        *session = reopened;
        operation(&session)
            .await
            .map_err(|error| failure::classify(error, context))
    }

    pub async fn list_dir(&self, path: String) -> Result<Vec<RemoteEntry>, SshNativeError> {
        let target = self.resolve(&path)?;
        let listing = self
            .run(&format!("list {target}"), |session| {
                let target = target.clone();
                Box::pin(async move { session.read_dir(target).await })
            })
            .await?;

        let mut entries: Vec<RemoteEntry> = Vec::new();
        for item in listing {
            if entries.len() >= MAX_ENTRIES {
                break;
            }
            let name = item.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = format!("{}/{name}", target.trim_end_matches('/'));
            entries.push(entry_from(child, name, &item.metadata()));
        }
        entries.sort_by(|a, b| (b.is_dir, &a.name).cmp(&(a.is_dir, &b.name)));
        Ok(entries)
    }

    /// Uses `symlink_metadata` so a link is reported as a link rather than as
    /// whatever it points at, which is what a file tree needs to draw.
    pub async fn stat(&self, path: String) -> Result<RemoteStat, SshNativeError> {
        let target = self.resolve(&path)?;
        let attrs = self
            .run(&format!("stat {target}"), |session| {
                let target = target.clone();
                Box::pin(async move { session.symlink_metadata(target).await })
            })
            .await;

        match attrs {
            Ok(attrs) => Ok(RemoteStat {
                path: target,
                exists: true,
                is_dir: attrs.is_dir(),
                is_symlink: attrs.is_symlink(),
                size: attrs.size.unwrap_or(0),
                modified_ms: modified_ms(&attrs),
                mode: attrs.permissions,
            }),
            Err(error) if error.code == SshErrorCode::Protocol => Ok(RemoteStat {
                path: target,
                exists: false,
                is_dir: false,
                is_symlink: false,
                size: 0,
                modified_ms: None,
                mode: None,
            }),
            Err(error) => Err(error),
        }
    }

    pub async fn canonicalize(&self, path: String) -> Result<String, SshNativeError> {
        let target = self.resolve(&path)?;
        let canonical = self
            .run(&format!("canonicalize {target}"), |session| {
                let target = target.clone();
                Box::pin(async move { session.canonicalize(target).await })
            })
            .await?;
        // The server resolves symlinks, so the answer is re-checked: a link
        // inside the root may well point outside it.
        self.resolve(&canonical)
    }

    pub async fn create_dir(&self, path: String) -> Result<String, SshNativeError> {
        let target = self.resolve(&path)?;
        self.run(&format!("create directory {target}"), |session| {
            let target = target.clone();
            Box::pin(async move { session.create_dir(target).await })
        })
        .await?;
        Ok(target)
    }

    pub async fn create_file(&self, path: String) -> Result<String, SshNativeError> {
        let target = self.resolve(&path)?;
        self.run(&format!("create file {target}"), |session| {
            let target = target.clone();
            Box::pin(async move { session.create(target).await.map(|_| ()) })
        })
        .await?;
        Ok(target)
    }

    pub async fn rename(&self, from: String, to: String) -> Result<String, SshNativeError> {
        let source = self.resolve(&from)?;
        let destination = self.resolve(&to)?;
        self.run(&format!("rename {source}"), |session| {
            let source = source.clone();
            let destination = destination.clone();
            Box::pin(async move { session.rename(source, destination).await })
        })
        .await?;
        Ok(destination)
    }

    pub async fn read_text(&self, path: String) -> Result<String, SshNativeError> {
        let bytes = self.read_bytes(path, MAX_TEXT_BYTES).await?;
        String::from_utf8(bytes).map_err(|_| {
            SshNativeError::new(
                SshErrorCode::Protocol,
                "binary_file: file is not valid UTF-8",
            )
        })
    }

    /// Reads a whole file with an explicit ceiling. The size is checked before
    /// the read so a huge file is refused instead of buffered.
    pub async fn read_bytes(&self, path: String, limit: usize) -> Result<Vec<u8>, SshNativeError> {
        let target = self.resolve(&path)?;
        let stat = self.stat(target.clone()).await?;
        if !stat.exists {
            return Err(SshNativeError::new(
                SshErrorCode::Protocol,
                format!("no such file: {target}"),
            ));
        }
        if stat.size as usize > limit {
            return Err(SshNativeError::new(
                SshErrorCode::Config,
                format!(
                    "{target} is {} bytes, over the {limit} byte limit",
                    stat.size
                ),
            ));
        }

        let bytes = self
            .run(&format!("read {target}"), |session| {
                let target = target.clone();
                Box::pin(async move { session.read(target).await })
            })
            .await?;
        if bytes.len() > limit {
            return Err(SshNativeError::new(
                SshErrorCode::Config,
                format!("{target} grew past the {limit} byte limit while being read"),
            ));
        }
        Ok(bytes)
    }

    pub async fn write_bytes(&self, path: String, data: Vec<u8>) -> Result<String, SshNativeError> {
        let target = self.resolve(&path)?;
        if data.len() > MAX_BINARY_BYTES {
            return Err(SshNativeError::new(
                SshErrorCode::Config,
                format!("refusing to write more than {MAX_BINARY_BYTES} bytes"),
            ));
        }
        let payload = Arc::new(data);
        self.run(&format!("write {target}"), |session| {
            let target = target.clone();
            let payload = Arc::clone(&payload);
            Box::pin(async move { session.write(target, &payload).await })
        })
        .await?;
        Ok(target)
    }

    /// Delete a file, or a directory and everything under it. Bounded in both
    /// depth and total entries so a symlink loop cannot spin forever.
    pub async fn remove(&self, path: String) -> Result<u64, SshNativeError> {
        let target = self.resolve(&path)?;
        let stat = self.stat(target.clone()).await?;
        if !stat.exists {
            return Err(SshNativeError::new(
                SshErrorCode::Protocol,
                format!("no such path: {target}"),
            ));
        }

        // A symlink is unlinked, never followed: following it would delete the
        // target's contents, which is not what deleting a link means.
        if !stat.is_dir || stat.is_symlink {
            self.remove_file(target).await?;
            return Ok(1);
        }

        let mut removed = 0u64;
        let mut pending = vec![(target.clone(), 0usize)];
        let mut directories: Vec<String> = Vec::new();

        while let Some((directory, depth)) = pending.pop() {
            if depth > MAX_DELETE_DEPTH {
                return Err(SshNativeError::new(
                    SshErrorCode::Config,
                    format!("{target} is deeper than {MAX_DELETE_DEPTH} levels"),
                ));
            }
            directories.push(directory.clone());

            for entry in self.list_dir(directory).await? {
                if removed >= MAX_DELETE_ENTRIES as u64 {
                    return Err(SshNativeError::new(
                        SshErrorCode::Config,
                        format!("{target} holds more than {MAX_DELETE_ENTRIES} entries"),
                    ));
                }
                if entry.is_dir && !entry.is_symlink {
                    pending.push((entry.path, depth + 1));
                } else {
                    self.remove_file(entry.path).await?;
                    removed += 1;
                }
            }
        }

        // Deepest first, since a directory must be empty before it goes.
        for directory in directories.into_iter().rev() {
            self.remove_dir(directory).await?;
            removed += 1;
        }
        Ok(removed)
    }

    async fn remove_file(&self, target: String) -> Result<(), SshNativeError> {
        self.run(&format!("remove {target}"), |session| {
            let target = target.clone();
            Box::pin(async move { session.remove_file(target).await })
        })
        .await
    }

    async fn remove_dir(&self, target: String) -> Result<(), SshNativeError> {
        self.run(&format!("remove directory {target}"), |session| {
            let target = target.clone();
            Box::pin(async move { session.remove_dir(target).await })
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attrs(permissions: u32, size: u64, mtime: Option<u32>) -> FileAttributes {
        FileAttributes {
            size: Some(size),
            permissions: Some(permissions),
            mtime,
            ..Default::default()
        }
    }

    /// POSIX mode bits: directory, regular file, symlink.
    const DIR: u32 = 0o040_755;
    const FILE: u32 = 0o100_644;
    const LINK: u32 = 0o120_777;

    #[test]
    fn an_entry_carries_kind_size_and_mode() {
        let entry = entry_from("/srv/app".into(), "app".into(), &attrs(DIR, 4096, Some(10)));
        assert!(entry.is_dir);
        assert!(!entry.is_symlink);
        assert_eq!(entry.size, 4096);
        assert_eq!(entry.mode, Some(DIR));
        assert_eq!(entry.modified_ms, Some(10_000));
    }

    #[test]
    fn a_symlink_is_reported_as_a_link() {
        let entry = entry_from("/srv/l".into(), "l".into(), &attrs(LINK, 12, None));
        assert!(entry.is_symlink);
        assert!(!entry.is_dir);
        assert_eq!(entry.modified_ms, None);
    }

    #[test]
    fn a_regular_file_is_neither_directory_nor_link() {
        let entry = entry_from("/srv/f".into(), "f".into(), &attrs(FILE, 7, Some(1)));
        assert!(!entry.is_dir);
        assert!(!entry.is_symlink);
        assert_eq!(entry.size, 7);
    }

    #[test]
    fn missing_attributes_degrade_instead_of_failing() {
        let entry = entry_from("/srv/x".into(), "x".into(), &FileAttributes::default());
        assert_eq!(entry.size, 0);
        assert_eq!(entry.mode, None);
        assert_eq!(entry.modified_ms, None);
        assert!(!entry.is_dir);
    }

    #[test]
    fn the_binary_ceiling_stays_under_the_remote_frame_limit() {
        // The helper's Base64 envelope has to fit a 64 MiB frame.
        const { assert!(MAX_BINARY_BYTES * 4 / 3 < 64 * 1024 * 1024) };
        const { assert!(MAX_TEXT_BYTES <= MAX_BINARY_BYTES) };
    }
}
