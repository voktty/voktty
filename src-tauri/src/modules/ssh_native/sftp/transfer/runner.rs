//! Executing a planned transfer.
//!
//! Orchestration is shared by both directions; only opening a source and a
//! destination differs, so the conflict rules and the progress accounting have
//! exactly one implementation.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;
use tokio::io::AsyncSeekExt;

use super::super::super::types::{SshErrorCode, SshNativeError};
use super::super::session::NativeSftp;
use super::engine::{copy_stream, walk_local, Cancel};
use super::job::JobDirection;
use super::plan::{
    plan_steps, resolve_conflict, total_bytes, ConflictOutcome, ConflictPolicy, ExistingFile,
    TransferStep, WalkEntry,
};
use super::progress::{ProgressTracker, TransferProgress};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub direction: JobDirection,
    /// Root on the machine the files come from.
    pub source_root: String,
    /// Root on the machine they land on.
    pub destination_root: String,
    /// Names relative to `source_root`. Empty means the whole root.
    #[serde(default)]
    pub items: Vec<String>,
    #[serde(default)]
    pub policy: ConflictPolicy,
}

/// Why a transfer stopped short of moving everything.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Interruption {
    /// A conflict needs the user under the `Ask` policy.
    NeedsDecision { step: Box<TransferStep> },
}

pub struct TransferOutcome {
    pub progress: TransferProgress,
    pub skipped: u64,
    pub interruption: Option<Interruption>,
    /// The step to carry on from. Answering a conflict resumes here rather
    /// than replaying everything already copied.
    pub next_index: usize,
}

/// Expand the request into the ordered steps it will perform.
pub async fn plan(
    sftp: &NativeSftp,
    request: &TransferRequest,
) -> Result<Vec<TransferStep>, SshNativeError> {
    let entries = match request.direction {
        JobDirection::Download => collect_remote(sftp, request).await?,
        JobDirection::Upload => collect_local(request)?,
    };
    Ok(plan_steps(
        &request.source_root,
        &request.destination_root,
        &entries,
    ))
}

async fn collect_remote(
    sftp: &NativeSftp,
    request: &TransferRequest,
) -> Result<Vec<WalkEntry>, SshNativeError> {
    if request.items.is_empty() {
        return sftp.walk(request.source_root.clone()).await;
    }

    let mut entries = Vec::new();
    for item in &request.items {
        let path = format!("{}/{item}", request.source_root.trim_end_matches('/'));
        let stat = sftp.stat(path.clone()).await?;
        if !stat.exists {
            return Err(missing(item));
        }
        entries.push(WalkEntry {
            relative: item.clone(),
            is_dir: stat.is_dir && !stat.is_symlink,
            size: if stat.is_dir { 0 } else { stat.size },
            modified_ms: stat.modified_ms,
        });
        if stat.is_dir && !stat.is_symlink {
            for nested in sftp.walk(path).await? {
                entries.push(WalkEntry {
                    relative: format!("{item}/{}", nested.relative),
                    ..nested
                });
            }
        }
    }
    Ok(entries)
}

fn collect_local(request: &TransferRequest) -> Result<Vec<WalkEntry>, SshNativeError> {
    let root = Path::new(&request.source_root);
    if request.items.is_empty() {
        return walk_local(root);
    }

    let mut entries = Vec::new();
    for item in &request.items {
        let path = root.join(item);
        let meta = std::fs::symlink_metadata(&path).map_err(|_| missing(item))?;
        let is_dir = meta.is_dir() && !meta.file_type().is_symlink();
        entries.push(WalkEntry {
            relative: item.clone(),
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            modified_ms: local_modified_ms(&meta),
        });
        if is_dir {
            for nested in walk_local(&path)? {
                entries.push(WalkEntry {
                    relative: format!("{item}/{}", nested.relative),
                    ..nested
                });
            }
        }
    }
    Ok(entries)
}

/// Run the planned steps, reporting progress as bytes land.
///
/// Returns early with `NeedsDecision` when the `Ask` policy meets an occupied
/// destination: nothing is written for that step until the user answers.
pub async fn execute(
    sftp: Arc<NativeSftp>,
    request: &TransferRequest,
    steps: &[TransferStep],
    from: usize,
    cancel: &Cancel,
    on_progress: &mut impl FnMut(TransferProgress),
) -> Result<TransferOutcome, SshNativeError> {
    let files = steps.iter().filter(|step| !step.is_dir).count() as u64;
    let mut tracker = ProgressTracker::new(total_bytes(steps), files);
    let mut claimed: HashSet<String> = HashSet::new();
    let mut skipped = 0u64;
    let mut done = 0u64;
    let mut index = from;

    for step in steps.iter().skip(from) {
        if cancel.is_cancelled() {
            return Err(super::engine::cancelled());
        }
        index += 1;
        if step.is_dir {
            ensure_directory(&sftp, request.direction, &step.destination).await?;
            continue;
        }

        let existing = destination_state(&sftp, request.direction, &step.destination).await?;
        let source_modified = source_modified_ms(&sftp, request.direction, &step.source).await;
        let outcome = resolve_conflict(
            request.policy,
            step,
            source_modified,
            existing.as_ref(),
            &claimed,
        );

        let (destination, offset) = match outcome {
            ConflictOutcome::Skip => {
                skipped += 1;
                tracker.file_finished();
                on_progress(tracker.snapshot());
                continue;
            }
            ConflictOutcome::Ask => {
                return Ok(TransferOutcome {
                    progress: tracker.snapshot(),
                    skipped,
                    interruption: Some(Interruption::NeedsDecision {
                        step: Box::new(step.clone()),
                    }),
                    next_index: index - 1,
                })
            }
            ConflictOutcome::Transfer { destination } => (destination, 0),
            ConflictOutcome::Resume {
                destination,
                offset,
            } => (destination, offset),
        };
        claimed.insert(destination.clone());

        done += offset;
        let moved = copy_one(
            &sftp,
            request.direction,
            &step.source,
            &destination,
            offset,
            cancel,
            &mut |bytes| {
                tracker.observe(now_ms(), done + bytes.saturating_sub(offset));
            },
        )
        .await?;
        done += moved;

        tracker.observe(now_ms(), done);
        tracker.file_finished();
        on_progress(tracker.snapshot());
    }

    Ok(TransferOutcome {
        progress: tracker.snapshot(),
        skipped,
        interruption: None,
        next_index: steps.len(),
    })
}

async fn copy_one(
    sftp: &Arc<NativeSftp>,
    direction: JobDirection,
    source: &str,
    destination: &str,
    offset: u64,
    cancel: &Cancel,
    on_progress: &mut impl FnMut(u64),
) -> Result<u64, SshNativeError> {
    match direction {
        JobDirection::Download => {
            let mut reader = sftp.open_read(source.to_string(), offset).await?;
            let mut writer = open_local_write(Path::new(destination), offset).await?;
            copy_stream(&mut reader, &mut writer, offset, cancel, on_progress).await
        }
        JobDirection::Upload => {
            let mut reader = open_local_read(Path::new(source), offset).await?;
            let mut writer = sftp.open_write(destination.to_string(), offset).await?;
            copy_stream(&mut reader, &mut writer, offset, cancel, on_progress).await
        }
    }
}

async fn open_local_read(path: &Path, offset: u64) -> Result<tokio::fs::File, SshNativeError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| local_error("open", path, error))?;
    if offset > 0 {
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| local_error("seek", path, error))?;
    }
    Ok(file)
}

/// A zero offset truncates, so a restart never leaves a tail of the previous,
/// longer file behind.
async fn open_local_write(path: &Path, offset: u64) -> Result<tokio::fs::File, SshNativeError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| local_error("create directories for", path, error))?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(offset == 0)
        .open(path)
        .await
        .map_err(|error| local_error("open", path, error))?;
    if offset > 0 {
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| local_error("seek", path, error))?;
    }
    Ok(file)
}

async fn ensure_directory(
    sftp: &Arc<NativeSftp>,
    direction: JobDirection,
    destination: &str,
) -> Result<(), SshNativeError> {
    match direction {
        JobDirection::Download => tokio::fs::create_dir_all(destination)
            .await
            .map_err(|error| local_error("create", Path::new(destination), error)),
        JobDirection::Upload => match sftp.create_dir(destination.to_string()).await {
            // An existing directory is the desired state, not a failure.
            Ok(_) => Ok(()),
            Err(error) if error.code == SshErrorCode::Protocol => Ok(()),
            Err(error) => Err(error),
        },
    }
}

async fn destination_state(
    sftp: &Arc<NativeSftp>,
    direction: JobDirection,
    destination: &str,
) -> Result<Option<ExistingFile>, SshNativeError> {
    match direction {
        JobDirection::Download => Ok(std::fs::symlink_metadata(destination)
            .ok()
            .filter(|meta| meta.is_file())
            .map(|meta| ExistingFile {
                size: meta.len(),
                modified_ms: local_modified_ms(&meta),
            })),
        JobDirection::Upload => {
            let stat = sftp.stat(destination.to_string()).await?;
            Ok((stat.exists && !stat.is_dir).then_some(ExistingFile {
                size: stat.size,
                modified_ms: stat.modified_ms,
            }))
        }
    }
}

async fn source_modified_ms(
    sftp: &Arc<NativeSftp>,
    direction: JobDirection,
    source: &str,
) -> Option<u64> {
    match direction {
        JobDirection::Download => sftp
            .stat(source.to_string())
            .await
            .ok()
            .and_then(|stat| stat.modified_ms),
        JobDirection::Upload => std::fs::symlink_metadata(source)
            .ok()
            .and_then(|meta| local_modified_ms(&meta)),
    }
}

fn local_modified_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|elapsed| elapsed.as_millis() as u64)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn missing(item: &str) -> SshNativeError {
    SshNativeError::new(SshErrorCode::NotFound, format!("no such source: {item}"))
}

fn local_error(operation: &str, path: &Path, error: std::io::Error) -> SshNativeError {
    let code = if error.kind() == std::io::ErrorKind::NotFound {
        SshErrorCode::NotFound
    } else {
        SshErrorCode::Config
    };
    SshNativeError::new(
        code,
        format!("cannot {operation} {}: {error}", path.display()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("directories");
        std::fs::File::create(path)
            .expect("file")
            .write_all(bytes)
            .expect("write");
    }

    fn request(root: &Path, items: Vec<String>) -> TransferRequest {
        TransferRequest {
            direction: JobDirection::Upload,
            source_root: root.to_string_lossy().into_owned(),
            destination_root: "/dst".into(),
            items,
            policy: ConflictPolicy::Overwrite,
        }
    }

    #[test]
    fn an_empty_item_list_collects_the_whole_root() {
        let root = tempfile::tempdir().expect("root");
        write(root.path(), "a.txt", b"one");
        write(root.path(), "d/b.txt", b"two");

        let entries = collect_local(&request(root.path(), vec![])).expect("collect");
        let names: Vec<&str> = entries.iter().map(|e| e.relative.as_str()).collect();
        assert_eq!(names, vec!["a.txt", "d", "d/b.txt"]);
    }

    #[test]
    fn naming_a_file_collects_only_that_file() {
        let root = tempfile::tempdir().expect("root");
        write(root.path(), "a.txt", b"one");
        write(root.path(), "b.txt", b"two");

        let entries = collect_local(&request(root.path(), vec!["a.txt".into()])).expect("collect");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].relative, "a.txt");
        assert_eq!(entries[0].size, 3);
    }

    #[test]
    fn naming_a_directory_collects_it_and_its_contents_with_prefixed_names() {
        let root = tempfile::tempdir().expect("root");
        write(root.path(), "d/nested/c.txt", b"three");

        let entries = collect_local(&request(root.path(), vec!["d".into()])).expect("collect");
        let names: Vec<&str> = entries.iter().map(|e| e.relative.as_str()).collect();
        assert_eq!(names, vec!["d", "d/nested", "d/nested/c.txt"]);
    }

    #[test]
    fn a_missing_item_is_reported_as_not_found() {
        let root = tempfile::tempdir().expect("root");
        let error = collect_local(&request(root.path(), vec!["nope".into()])).expect_err("missing");
        assert_eq!(error.code, SshErrorCode::NotFound);
        assert!(error.message.contains("nope"));
    }

    /// `tokio::fs::File` buffers, so a write only reaches disk once flushed.
    /// `copy_stream` always flushes before returning, which is what makes the
    /// bytes on disk match the reported progress.
    async fn write_and_flush(file: &mut tokio::fs::File, bytes: &[u8]) {
        use tokio::io::AsyncWriteExt;
        file.write_all(bytes).await.expect("write");
        file.flush().await.expect("flush");
    }

    #[tokio::test]
    async fn a_local_write_truncates_at_offset_zero_and_appends_otherwise() {
        let root = tempfile::tempdir().expect("root");
        let path = root.path().join("out.bin");
        std::fs::write(&path, b"0123456789").expect("seed");

        // Offset zero must not leave the tail of the longer previous file.
        let mut file = open_local_write(&path, 0).await.expect("truncating open");
        write_and_flush(&mut file, b"abc").await;
        drop(file);
        assert_eq!(std::fs::read(&path).expect("read"), b"abc");

        let mut file = open_local_write(&path, 3).await.expect("appending open");
        write_and_flush(&mut file, b"de").await;
        drop(file);
        assert_eq!(std::fs::read(&path).expect("read"), b"abcde");
    }

    #[tokio::test]
    async fn a_local_write_creates_the_parent_directories_it_needs() {
        let root = tempfile::tempdir().expect("root");
        let path = root.path().join("a/b/c.txt");
        let file = open_local_write(&path, 0).await.expect("open");
        drop(file);
        assert!(path.exists());
    }

    #[tokio::test]
    async fn a_local_read_starts_at_the_requested_offset() {
        let root = tempfile::tempdir().expect("root");
        let path = root.path().join("in.bin");
        std::fs::write(&path, b"0123456789").expect("seed");

        let mut file = open_local_read(&path, 4).await.expect("open");
        let mut rest = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut file, &mut rest)
            .await
            .expect("read");
        assert_eq!(rest, b"456789");
    }

    #[tokio::test]
    async fn reading_a_missing_file_reports_not_found() {
        let root = tempfile::tempdir().expect("root");
        let error = open_local_read(&root.path().join("nope"), 0)
            .await
            .expect_err("missing");
        assert_eq!(error.code, SshErrorCode::NotFound);
    }
}
