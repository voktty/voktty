use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::Emitter;
use voktty_workspace_edit::{
    apply_text_edits, apply_transaction, preview_text_edits, preview_transaction, ApplyOutcome,
    DiskFile, ReplacePreview, ReplaceSpec, ReplaceTarget, WorkspaceEditFs,
    WorkspaceTextDocumentEdit, WorkspaceTextEditOutcome, WorkspaceTextEditPreview,
    WorkspaceTextEditTarget,
};

use super::file::{mtime_millis, write_atomic, FileWrittenEvent};
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

#[derive(Default)]
pub struct WorkspaceReplaceState(Mutex<()>);

struct LocalWorkspaceEdit {
    root: PathBuf,
}

impl LocalWorkspaceEdit {
    fn new(root: PathBuf, registry: &WorkspaceRegistry) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
        if !root.is_dir() {
            return Err("replacement root is not a directory".to_string());
        }
        if !registry.is_authorized(&root) {
            return Err("replacement root is outside the authorized workspace".to_string());
        }
        Ok(Self { root })
    }

    fn resolve_file(&self, relative: &str) -> Result<PathBuf, String> {
        let relative = safe_relative_path(relative)?;
        let candidate = self.root.join(relative);
        let link_metadata = fs::symlink_metadata(&candidate).map_err(|error| error.to_string())?;
        if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
            return Err("replacement target must be a regular file".to_string());
        }
        let candidate = fs::canonicalize(candidate).map_err(|error| error.to_string())?;
        if !candidate.starts_with(&self.root) {
            return Err("replacement target escapes the workspace".to_string());
        }
        Ok(candidate)
    }
}

impl WorkspaceEditFs for LocalWorkspaceEdit {
    fn read(&mut self, path: &str) -> Result<DiskFile, String> {
        let path = self.resolve_file(path)?;
        let before = fs::metadata(&path).map_err(|error| error.to_string())?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let after = fs::metadata(&path).map_err(|error| error.to_string())?;
        if before.len() != after.len() || mtime_millis(&before) != mtime_millis(&after) {
            return Err("replacement target changed while it was read".to_string());
        }
        let content = String::from_utf8(bytes)
            .map_err(|_| "replacement target is not valid UTF-8".to_string())?;
        Ok(DiskFile {
            content,
            mtime: mtime_millis(&after),
        })
    }

    fn write_atomic(&mut self, path: &str, content: &str) -> Result<(), String> {
        let path = self.resolve_file(path)?;
        write_atomic(&path, content.as_bytes()).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn fs_replace_preview(
    root: String,
    spec: ReplaceSpec,
    paths: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, WorkspaceReplaceState>,
) -> Result<ReplacePreview, String> {
    let _transaction = state
        .0
        .lock()
        .map_err(|_| "workspace replacement state is poisoned".to_string())?;
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    let mut filesystem = LocalWorkspaceEdit::new(root_path, &registry)?;
    preview_transaction(&mut filesystem, &spec, &paths)
}

#[tauri::command]
pub fn fs_replace_apply(
    root: String,
    spec: ReplaceSpec,
    targets: Vec<ReplaceTarget>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, WorkspaceReplaceState>,
    app: tauri::AppHandle,
) -> Result<ApplyOutcome, String> {
    let _transaction = state
        .0
        .lock()
        .map_err(|_| "workspace replacement state is poisoned".to_string())?;
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    let mut filesystem = LocalWorkspaceEdit::new(root_path, &registry)?;
    let outcome = apply_transaction(&mut filesystem, &spec, &targets);
    if matches!(outcome, ApplyOutcome::Applied { .. }) {
        for target in &targets {
            let _ = app.emit(
                "fs:file-written",
                FileWrittenEvent {
                    path: display_path(&root, &target.path),
                    source: Some("workspace-replace".to_string()),
                },
            );
        }
    }
    Ok(outcome)
}

#[tauri::command]
pub fn fs_workspace_edit_preview(
    root: String,
    documents: Vec<WorkspaceTextDocumentEdit>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, WorkspaceReplaceState>,
) -> Result<WorkspaceTextEditPreview, String> {
    let _transaction = state
        .0
        .lock()
        .map_err(|_| "workspace edit state is poisoned".to_string())?;
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    let mut filesystem = LocalWorkspaceEdit::new(root_path, &registry)?;
    preview_text_edits(&mut filesystem, &documents)
}

#[tauri::command]
pub fn fs_workspace_edit_apply(
    root: String,
    targets: Vec<WorkspaceTextEditTarget>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, WorkspaceReplaceState>,
    app: tauri::AppHandle,
) -> Result<WorkspaceTextEditOutcome, String> {
    let _transaction = state
        .0
        .lock()
        .map_err(|_| "workspace edit state is poisoned".to_string())?;
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    let mut filesystem = LocalWorkspaceEdit::new(root_path, &registry)?;
    let outcome = apply_text_edits(&mut filesystem, &targets);
    if matches!(outcome, WorkspaceTextEditOutcome::Applied { .. }) {
        for target in &targets {
            let _ = app.emit(
                "fs:file-written",
                FileWrittenEvent {
                    path: display_path(&root, &target.path),
                    source: Some("workspace-edit".to_string()),
                },
            );
        }
    }
    Ok(outcome)
}

fn safe_relative_path(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.contains('\0') || path.contains('\\') || path.contains(':') {
        return Err("invalid replacement path".to_string());
    }
    let path = Path::new(path);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("replacement path must be relative to the workspace".to_string());
    }
    Ok(path.to_path_buf())
}

fn display_path(root: &str, relative: &str) -> String {
    format!(
        "{}/{}",
        root.trim_end_matches(['/', '\\']),
        relative.trim_start_matches('/')
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_reject_traversal_and_windows_separators() {
        assert!(safe_relative_path("src/main.rs").is_ok());
        assert!(safe_relative_path("../outside").is_err());
        assert!(safe_relative_path("src\\main.rs").is_err());
        assert!(safe_relative_path("C:/outside").is_err());
        assert!(safe_relative_path("C:outside").is_err());
        assert!(safe_relative_path("src/main.rs:stream").is_err());
    }

    #[test]
    fn local_adapter_applies_only_a_previewed_file_version() {
        let directory = tempfile::tempdir().expect("temp directory");
        fs::write(directory.path().join("note.txt"), "foo foo").expect("test file");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(directory.path())
            .expect("authorize root");
        let mut filesystem =
            LocalWorkspaceEdit::new(directory.path().to_path_buf(), &registry).expect("adapter");
        let spec = ReplaceSpec {
            pattern: "foo".to_string(),
            replacement: "bar".to_string(),
            regex: false,
            case_sensitive: true,
            whole_word: false,
        };
        let preview = preview_transaction(&mut filesystem, &spec, &["note.txt".to_string()])
            .expect("preview");
        let file = &preview.files[0];
        let outcome = apply_transaction(
            &mut filesystem,
            &spec,
            &[ReplaceTarget {
                path: file.path.clone(),
                expected_mtime: file.mtime,
                expected_hash: file.hash.clone(),
                expected_replacements: file.replacements,
            }],
        );

        assert!(matches!(outcome, ApplyOutcome::Applied { .. }));
        assert_eq!(
            fs::read_to_string(directory.path().join("note.txt")).unwrap(),
            "bar bar"
        );
    }
}
