use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::fs::expand_home;

const MAX_LOGO_BYTES: u64 = 2 * 1024 * 1024;
const ALLOWED_EXT: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
const MAX_STEM_CHARS: usize = 96;
const HASH_CHARS: usize = 17; // '-' plus 16 hex chars

fn fnv1a_64(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn project_logos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("project-logos");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sanitize_project_key(project: &str) -> String {
    let trimmed = project.trim();
    let hash = format!("-{:016x}", fnv1a_64(trimmed));
    if trimmed.is_empty() {
        return format!("project{hash}");
    }
    let max_safe = MAX_STEM_CHARS.saturating_sub(HASH_CHARS).max(1);
    let safe: String = trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .take(max_safe)
        .collect();
    let safe = safe.trim_matches('-');
    let stem = if safe.is_empty() { "project" } else { safe };
    format!("{stem}{hash}")
}

fn logo_stem(project: &str) -> String {
    sanitize_project_key(project)
}

fn remove_existing_logos(dir: &Path, project: &str) -> Result<(), String> {
    let stem = logo_stem(project);
    let prefix = format!("{stem}.");
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name == stem || name.starts_with(&prefix) {
            std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn forget_logo_file_sync(app: &AppHandle, logo_path: &str) -> Result<(), String> {
    let dir = project_logos_dir(app)?;
    let target = Path::new(logo_path);
    if let (Ok(target_canon), Ok(dir_canon)) = (target.canonicalize(), dir.canonicalize()) {
        if target_canon.parent() == Some(&dir_canon) && target_canon.is_file() {
            let _ = std::fs::remove_file(target_canon);
        }
    }
    Ok(())
}

fn save_project_logo_sync(
    app: &AppHandle,
    project: &str,
    source_path: &str,
) -> Result<String, String> {
    let source = expand_home(source_path);
    let meta = std::fs::metadata(&source).map_err(|e| format!("{}: {e}", source.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_LOGO_BYTES {
        return Err(format!(
            "Logo is too large (maximum {} MB).",
            MAX_LOGO_BYTES / 1024 / 1024
        ));
    }

    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err("Logo must be a PNG, JPG, GIF, WebP, or SVG image.".into());
    }

    let dir = project_logos_dir(app)?;
    let stem = logo_stem(project);
    let dest = dir.join(format!("{stem}.{ext}"));
    let temp = dir.join(format!(".{stem}-upload"));

    // Copy before removing the old logo so re-selecting the saved file still works.
    std::fs::copy(&source, &temp).map_err(|e| format!("{}: {e}", temp.display()))?;
    remove_existing_logos(&dir, project)?;
    std::fs::rename(&temp, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    Ok(dest.to_string_lossy().into_owned())
}

fn remove_project_logo_sync(app: &AppHandle, project: &str) -> Result<(), String> {
    let dir = project_logos_dir(app)?;
    remove_existing_logos(&dir, project)
}

#[tauri::command]
pub async fn save_project_logo(
    app: AppHandle,
    project: String,
    source_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_project_logo_sync(&app, &project, &source_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_project_logo(app: AppHandle, project: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_project_logo_sync(&app, &project))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn forget_logo_file(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || forget_logo_file_sync(&app, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_project_key_replaces_unsafe_characters() {
        let key = sanitize_project_key("agent-terminal");
        assert!(key.starts_with("agent-terminal-"));
        assert_eq!(key.len(), "agent-terminal-".len() + 16);

        let key = sanitize_project_key("foo/bar");
        assert!(key.starts_with("foo-bar-"));

        let key = sanitize_project_key("  ");
        assert!(key.starts_with("project-"));
    }

    #[test]
    fn sanitize_project_key_is_deterministic_and_unique() {
        assert_eq!(
            sanitize_project_key("/repo/foo"),
            sanitize_project_key("/repo/foo")
        );
        assert_ne!(
            sanitize_project_key("/repo/foo"),
            sanitize_project_key("/other/foo")
        );
    }
}
