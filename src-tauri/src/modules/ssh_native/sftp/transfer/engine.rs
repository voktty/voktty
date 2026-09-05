//! Walking a tree and moving its bytes.
//!
//! The copy loop is generic over the streams so it can be exercised with
//! in-memory buffers; only the code that opens a remote file needs a server.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::super::super::types::{SshErrorCode, SshNativeError};
use super::plan::WalkEntry;

/// Large enough to keep the link busy, small enough that cancelling feels
/// immediate and a stalled transfer does not sit on megabytes of buffer.
pub const CHUNK_BYTES: usize = 64 * 1024;
/// A tree past this is not something a user meant to drag.
pub const MAX_WALK_ENTRIES: usize = 50_000;
const MAX_WALK_DEPTH: usize = 64;
/// The remote walk shares the bound so both sides of a transfer agree.
pub const MAX_WALK_DEPTH_REMOTE: usize = MAX_WALK_DEPTH;

/// A cancellation flag shared with whoever can press stop.
#[derive(Clone, Debug, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

pub fn cancelled() -> SshNativeError {
    SshNativeError::new(SshErrorCode::Cancelled, "the transfer was cancelled")
}

/// Copy until the reader is exhausted, reporting cumulative bytes as it goes.
///
/// `already_done` seeds the reported figure so a resumed copy continues the
/// count instead of restarting it. Cancellation is checked between chunks, so
/// stopping never leaves a half-written chunk behind.
pub async fn copy_stream<R, W>(
    reader: &mut R,
    writer: &mut W,
    already_done: u64,
    cancel: &Cancel,
    on_progress: &mut impl FnMut(u64),
) -> Result<u64, SshNativeError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buffer = vec![0u8; CHUNK_BYTES];
    let mut copied = 0u64;

    loop {
        if cancel.is_cancelled() {
            // Flushed first so the partial file on disk matches what was
            // reported, which is what makes a later resume safe.
            let _ = writer.flush().await;
            return Err(cancelled());
        }

        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| io_error("read", error))?;
        if read == 0 {
            break;
        }

        writer
            .write_all(&buffer[..read])
            .await
            .map_err(|error| io_error("write", error))?;
        copied += read as u64;
        on_progress(already_done + copied);
    }

    writer
        .flush()
        .await
        .map_err(|error| io_error("flush", error))?;
    Ok(copied)
}

fn io_error(operation: &str, error: std::io::Error) -> SshNativeError {
    SshNativeError::new(
        SshErrorCode::Unreachable,
        format!("transfer {operation} failed: {error}"),
    )
}

/// List everything under a local directory, relative to it.
///
/// Symlinks are recorded but never followed, so a link loop cannot turn a
/// finite tree into an endless walk.
pub fn walk_local(root: &Path) -> Result<Vec<WalkEntry>, SshNativeError> {
    let mut entries = Vec::new();
    let mut pending: Vec<(PathBuf, String, usize)> = vec![(root.to_path_buf(), String::new(), 0)];

    while let Some((directory, prefix, depth)) = pending.pop() {
        if depth > MAX_WALK_DEPTH {
            return Err(too_large(format!("deeper than {MAX_WALK_DEPTH} levels")));
        }

        let listing = std::fs::read_dir(&directory)
            .map_err(|error| io_error(&format!("listing {}", directory.display()), error))?;

        for item in listing {
            let item = item.map_err(|error| io_error("listing", error))?;
            if entries.len() >= MAX_WALK_ENTRIES {
                return Err(too_large(format!("more than {MAX_WALK_ENTRIES} entries")));
            }

            let name = item.file_name().to_string_lossy().into_owned();
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let meta = item
                .metadata()
                .map_err(|error| io_error(&format!("reading {relative}"), error))?;
            let symlink = item
                .file_type()
                .map(|kind| kind.is_symlink())
                .unwrap_or(false);
            let is_dir = meta.is_dir() && !symlink;

            entries.push(WalkEntry {
                relative: relative.clone(),
                is_dir,
                size: if is_dir { 0 } else { meta.len() },
                modified_ms: modified_ms(&meta),
            });

            if is_dir {
                pending.push((item.path(), relative, depth + 1));
            }
        }
    }

    entries.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok(entries)
}

fn modified_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|elapsed| elapsed.as_millis() as u64)
}

fn too_large(detail: String) -> SshNativeError {
    SshNativeError::new(
        SshErrorCode::Config,
        format!("refusing to transfer a tree {detail}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn progress_sink() -> (Vec<u64>, impl FnMut(u64)) {
        (Vec::new(), |_| {})
    }

    #[tokio::test]
    async fn a_copy_moves_every_byte_and_reports_as_it_goes() {
        let payload: Vec<u8> = (0..(CHUNK_BYTES * 2 + 7) as u32)
            .map(|index| index as u8)
            .collect();
        let mut source = payload.as_slice();
        let mut destination: Vec<u8> = Vec::new();
        let mut seen: Vec<u64> = Vec::new();

        let copied = copy_stream(
            &mut source,
            &mut destination,
            0,
            &Cancel::new(),
            &mut |done| seen.push(done),
        )
        .await
        .expect("copy succeeds");

        assert_eq!(copied, payload.len() as u64);
        assert_eq!(destination, payload);
        assert_eq!(seen.last().copied(), Some(payload.len() as u64));
        assert!(seen.len() >= 3, "progress is reported per chunk");
        assert!(seen.windows(2).all(|w| w[0] < w[1]), "progress only grows");
    }

    #[tokio::test]
    async fn a_resumed_copy_continues_the_reported_count() {
        let payload = vec![7u8; 10];
        let mut source = payload.as_slice();
        let mut destination: Vec<u8> = Vec::new();
        let mut seen: Vec<u64> = Vec::new();

        copy_stream(
            &mut source,
            &mut destination,
            1_000,
            &Cancel::new(),
            &mut |done| seen.push(done),
        )
        .await
        .expect("copy succeeds");

        assert_eq!(seen, vec![1_010]);
    }

    #[tokio::test]
    async fn an_empty_source_copies_nothing_and_still_succeeds() {
        let mut source: &[u8] = &[];
        let mut destination: Vec<u8> = Vec::new();
        let (_, mut sink) = progress_sink();

        let copied = copy_stream(&mut source, &mut destination, 0, &Cancel::new(), &mut sink)
            .await
            .expect("copy succeeds");
        assert_eq!(copied, 0);
        assert!(destination.is_empty());
    }

    #[tokio::test]
    async fn a_cancelled_copy_stops_before_reading_anything() {
        let payload = vec![1u8; CHUNK_BYTES * 4];
        let mut source = payload.as_slice();
        let mut destination: Vec<u8> = Vec::new();
        let cancel = Cancel::new();
        cancel.cancel();
        let (_, mut sink) = progress_sink();

        let error = copy_stream(&mut source, &mut destination, 0, &cancel, &mut sink)
            .await
            .expect_err("cancelled");
        assert_eq!(error.code, SshErrorCode::Cancelled);
        assert!(destination.is_empty());
    }

    #[tokio::test]
    async fn cancelling_midway_keeps_what_was_already_written() {
        let payload = vec![3u8; CHUNK_BYTES * 4];
        let mut source = payload.as_slice();
        let mut destination: Vec<u8> = Vec::new();
        let cancel = Cancel::new();
        let stopper = cancel.clone();

        let error = copy_stream(&mut source, &mut destination, 0, &cancel, &mut |done| {
            if done >= CHUNK_BYTES as u64 {
                stopper.cancel();
            }
        })
        .await
        .expect_err("cancelled");

        assert_eq!(error.code, SshErrorCode::Cancelled);
        // Whole chunks only: a partial chunk is never left behind.
        assert_eq!(destination.len(), CHUNK_BYTES);
    }

    #[test]
    fn a_cancel_token_is_shared_by_its_clones() {
        let cancel = Cancel::new();
        let clone = cancel.clone();
        assert!(!cancel.is_cancelled());
        clone.cancel();
        assert!(cancel.is_cancelled());
    }

    fn write_file(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("directories");
        let mut file = std::fs::File::create(path).expect("file");
        file.write_all(bytes).expect("write");
    }

    #[test]
    fn a_local_walk_reports_every_file_relative_to_the_root() {
        let root = tempfile::tempdir().expect("root");
        write_file(root.path(), "a.txt", b"hello");
        write_file(root.path(), "nested/deep/b.bin", b"12345");

        let entries = walk_local(root.path()).expect("walk");
        let names: Vec<&str> = entries.iter().map(|e| e.relative.as_str()).collect();
        assert_eq!(
            names,
            vec!["a.txt", "nested", "nested/deep", "nested/deep/b.bin"]
        );

        let file = entries
            .iter()
            .find(|e| e.relative == "a.txt")
            .expect("a.txt");
        assert!(!file.is_dir);
        assert_eq!(file.size, 5);
        assert!(file.modified_ms.is_some());
    }

    #[test]
    fn a_directory_carries_no_size() {
        let root = tempfile::tempdir().expect("root");
        write_file(root.path(), "d/child", b"x");
        let entries = walk_local(root.path()).expect("walk");
        let directory = entries.iter().find(|e| e.relative == "d").expect("d");
        assert!(directory.is_dir);
        assert_eq!(directory.size, 0);
    }

    #[test]
    fn an_empty_directory_walks_to_nothing() {
        let root = tempfile::tempdir().expect("root");
        assert!(walk_local(root.path()).expect("walk").is_empty());
    }

    #[test]
    fn walking_a_missing_directory_is_an_error_not_an_empty_list() {
        let root = tempfile::tempdir().expect("root");
        let missing = root.path().join("nope");
        assert!(walk_local(&missing).is_err());
    }
}
