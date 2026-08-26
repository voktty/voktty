use serde::Serialize;
use tauri::State;

use super::file::write_atomic;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

const OPERATION_FILE_LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OperationPathInspection {
    File { content: String },
    Directory { empty: bool },
}

fn authorized_operation_path(
    path: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
    allow_missing: bool,
) -> Result<std::path::PathBuf, String> {
    let resolved = resolve_path(path, workspace);
    let canonical = if resolved.exists() {
        std::fs::canonicalize(&resolved).map_err(|error| error.to_string())?
    } else if allow_missing {
        let parent = resolved
            .parent()
            .ok_or_else(|| "operation path has no parent".to_string())?;
        let canonical_parent = std::fs::canonicalize(parent).map_err(|error| error.to_string())?;
        canonical_parent.join(
            resolved
                .file_name()
                .ok_or_else(|| "operation path has no file name".to_string())?,
        )
    } else {
        return Err(format!("not found: {}", resolved.display()));
    };
    if !registry.is_authorized(&canonical) {
        return Err("operation path is outside the authorized workspace".to_string());
    }
    Ok(canonical)
}

fn inspect_operation_path(
    path: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<Option<OperationPathInspection>, String> {
    let resolved = resolve_path(path, workspace);
    if !resolved.exists() {
        let _ = authorized_operation_path(path, workspace, registry, true)?;
        return Ok(None);
    }
    let target = authorized_operation_path(path, workspace, registry, false)?;
    let metadata = std::fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("operation targets cannot be symbolic links".to_string());
    }
    if metadata.is_dir() {
        let empty = std::fs::read_dir(&target)
            .map_err(|error| error.to_string())?
            .next()
            .is_none();
        return Ok(Some(OperationPathInspection::Directory { empty }));
    }
    if !metadata.is_file() {
        return Err("operation target must be a regular file or directory".to_string());
    }
    if metadata.len() > OPERATION_FILE_LIMIT {
        return Err("operation target exceeds the 4 MiB limit".to_string());
    }
    let content = std::fs::read_to_string(&target).map_err(|error| error.to_string())?;
    Ok(Some(OperationPathInspection::File { content }))
}

#[tauri::command]
pub fn fs_inspect_operation_path(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<Option<OperationPathInspection>, String> {
    inspect_operation_path(&path, &WorkspaceEnv::from_option(workspace), &registry)
}

fn write_operation_file(
    path: &str,
    content: &str,
    expected_content: Option<&str>,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let target = authorized_operation_path(path, workspace, registry, true)?;
    match (std::fs::symlink_metadata(&target), expected_content) {
        (Ok(metadata), Some(expected)) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("operation target is not a regular file".to_string());
            }
            if metadata.len() > OPERATION_FILE_LIMIT {
                return Err("operation target exceeds the 4 MiB limit".to_string());
            }
            let current = std::fs::read_to_string(&target).map_err(|error| error.to_string())?;
            if current != expected {
                return Err("operation target changed before write".to_string());
            }
        }
        (Ok(_), None) => return Err("operation target was created concurrently".to_string()),
        (Err(error), Some(_)) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("operation target disappeared before write".to_string())
        }
        (Err(error), None) if error.kind() == std::io::ErrorKind::NotFound => {}
        (Err(error), _) => return Err(error.to_string()),
    }
    write_atomic(&target, content.as_bytes()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_write_operation_file(
    path: String,
    content: String,
    expected_content: Option<String>,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    write_operation_file(
        &path,
        &content,
        expected_content.as_deref(),
        &WorkspaceEnv::from_option(workspace),
        &registry,
    )
}

fn remove_operation_file(
    path: &str,
    expected_content: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let target = authorized_operation_path(path, workspace, registry, false)?;
    let metadata = std::fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("operation target is not a regular file".to_string());
    }
    if metadata.len() > OPERATION_FILE_LIMIT {
        return Err("operation target exceeds the 4 MiB limit".to_string());
    }
    let current = std::fs::read_to_string(&target).map_err(|error| error.to_string())?;
    if current != expected_content {
        return Err("operation target changed before removal".to_string());
    }
    std::fs::remove_file(&target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_remove_operation_file(
    path: String,
    expected_content: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    remove_operation_file(
        &path,
        &expected_content,
        &WorkspaceEnv::from_option(workspace),
        &registry,
    )
}

fn remove_empty_operation_directory(
    path: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let target = authorized_operation_path(path, workspace, registry, false)?;
    let metadata = std::fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("operation target is not a regular directory".to_string());
    }
    std::fs::remove_dir(&target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_remove_empty_operation_directory(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    remove_empty_operation_directory(&path, &WorkspaceEnv::from_option(workspace), &registry)
}

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(&p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub fn fs_create_dir(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn fs_rename(from: String, to: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::rename(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let result = if meta.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };

    result.map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })
}

fn copy_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// Copies external files/dirs into a destination directory, recursively for
/// dirs. Sources are absolute OS paths (from a drag-drop); only the destination
/// is workspace-resolved. Refuses to overwrite existing entries.
#[tauri::command]
pub fn fs_copy(
    sources: Vec<String>,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let dest = resolve_path(&dest_dir, &workspace);
    for source in &sources {
        let src = std::path::PathBuf::from(source);
        let name = src
            .file_name()
            .ok_or_else(|| format!("invalid source: {source}"))?;
        let target = dest.join(name);
        if target.exists() {
            return Err(format!("already exists: {}", target.display()));
        }
        copy_recursive(&src, &target).map_err(|e| {
            log::warn!(
                "fs_copy({} -> {}) failed: {e}",
                src.display(),
                target.display()
            );
            e.to_string()
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn operation_paths_require_authorized_workspace_and_exact_content() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(root.path()).unwrap();
        let workspace = WorkspaceEnv::from_option(None);
        let file = root.path().join("agent.txt");
        std::fs::write(&file, "reviewed").unwrap();

        match inspect_operation_path(&s(file.clone()), &workspace, &registry).unwrap() {
            Some(OperationPathInspection::File { content }) => {
                assert_eq!(content, "reviewed")
            }
            _ => panic!("expected regular file inspection"),
        }
        write_operation_file(
            &s(file.clone()),
            "updated",
            Some("reviewed"),
            &workspace,
            &registry,
        )
        .unwrap();
        std::fs::write(&file, "concurrent").unwrap();
        let error = write_operation_file(
            &s(file.clone()),
            "should-not-land",
            Some("updated"),
            &workspace,
            &registry,
        )
        .unwrap_err();
        assert!(error.contains("changed before write"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "concurrent");
        let outside_file = outside.path().join("outside.txt");
        std::fs::write(&outside_file, "outside").unwrap();
        let error = inspect_operation_path(&s(outside_file), &workspace, &registry).unwrap_err();
        assert!(error.contains("outside the authorized workspace"));

        let error =
            remove_operation_file(&s(file.clone()), "stale", &workspace, &registry).unwrap_err();
        assert!(error.contains("changed before removal"));
        assert!(file.exists());
        remove_operation_file(&s(file.clone()), "concurrent", &workspace, &registry).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn operation_directory_removal_is_never_recursive() {
        let root = tempfile::tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(root.path()).unwrap();
        let workspace = WorkspaceEnv::from_option(None);
        let directory = root.path().join("generated");
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("concurrent.txt"), "keep").unwrap();

        assert!(
            remove_empty_operation_directory(&s(directory.clone()), &workspace, &registry).is_err()
        );
        assert!(directory.join("concurrent.txt").exists());
        std::fs::remove_file(directory.join("concurrent.txt")).unwrap();
        remove_empty_operation_directory(&s(directory.clone()), &workspace, &registry).unwrap();
        assert!(!directory.exists());
    }

    #[test]
    fn create_file_makes_empty_and_refuses_to_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("new.txt");
        fs_create_file(s(f.clone()), None).expect("create");
        assert!(f.exists());
        assert_eq!(std::fs::read(&f).unwrap(), b"");

        // A second create must error, not truncate existing content.
        std::fs::write(&f, b"data").unwrap();
        let err = fs_create_file(s(f.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"data");
    }

    #[test]
    fn create_dir_builds_nested_chain_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a/b/c");
        fs_create_dir(s(nested.clone()), None).expect("create dir");
        assert!(nested.is_dir());
        let err = fs_create_dir(s(nested), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn rename_moves_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        std::fs::write(&from, b"payload").unwrap();

        fs_rename(s(from.clone()), s(to.clone()), None).expect("rename");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");

        // Missing source is reported, not silently ignored.
        let err = fs_rename(s(from), s(dir.path().join("c.txt")), None).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");

        // Refusing to overwrite an existing target is the data-loss guard.
        let occupied = dir.path().join("keep.txt");
        std::fs::write(&occupied, b"keep").unwrap();
        let err = fs_rename(s(to.clone()), s(occupied.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
        assert!(to.exists());
    }

    #[test]
    fn copy_brings_file_and_dir_in_and_refuses_clobber() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"payload").unwrap();
        std::fs::create_dir_all(src.path().join("d/inner")).unwrap();
        std::fs::write(src.path().join("d/inner/y.txt"), b"y").unwrap();

        fs_copy(
            vec![s(src.path().join("a.txt")), s(src.path().join("d"))],
            s(dest.path().to_path_buf()),
            None,
        )
        .expect("copy");

        assert_eq!(
            std::fs::read(dest.path().join("a.txt")).unwrap(),
            b"payload"
        );
        assert_eq!(
            std::fs::read(dest.path().join("d/inner/y.txt")).unwrap(),
            b"y"
        );
        // copy, not move: the source survives.
        assert!(src.path().join("a.txt").exists());

        let err = fs_copy(
            vec![s(src.path().join("a.txt"))],
            s(dest.path().to_path_buf()),
            None,
        )
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn delete_removes_file_then_dir_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        fs_delete(s(f.clone()), None).expect("delete file");
        assert!(!f.exists());

        let sub = dir.path().join("sub");
        std::fs::create_dir_all(sub.join("inner")).unwrap();
        std::fs::write(sub.join("inner/y.txt"), b"y").unwrap();
        fs_delete(s(sub.clone()), None).expect("delete dir");
        assert!(!sub.exists());

        let err = fs_delete(s(dir.path().join("missing")), None).unwrap_err();
        assert!(!err.is_empty());
    }

    // Deleting a symlink that points at a directory must remove only the link,
    // never recurse through it and wipe the target's contents.
    #[cfg(unix)]
    #[test]
    fn delete_does_not_follow_symlink_into_target() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::write(real.join("keep.txt"), b"keep").unwrap();

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        fs_delete(s(link.clone()), None).expect("delete symlink");
        assert!(!link.exists(), "symlink itself should be gone");
        assert!(real.is_dir(), "target dir must survive");
        assert_eq!(std::fs::read(real.join("keep.txt")).unwrap(), b"keep");
    }
}
