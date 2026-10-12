use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

#[derive(Clone, Debug)]
pub struct ResolvedGitDirectory {
    pub workspace: WorkspaceEnv,
    pub git_path: String,
    pub local_path: PathBuf,
}

pub fn split_upstream(upstream: &str) -> (Option<String>, Option<String>) {
    match upstream.split_once('/') {
        Some((remote, branch)) => (Some(remote.to_string()), Some(branch.to_string())),
        None => (None, Some(upstream.to_string())),
    }
}

pub fn display_path(path: &Path) -> String {
    crate::modules::fs::to_canon(path)
}

fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub fn canonical_dir(
    registry: &WorkspaceRegistry,
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<ResolvedGitDirectory> {
    if workspace.is_remote() {
        let clean = normalize_git_path(path.trim());
        let git_path = if clean.is_empty() {
            ".".to_string()
        } else {
            clean
        };
        let local_path = PathBuf::from(&git_path);
        return Ok(ResolvedGitDirectory {
            workspace: workspace.clone(),
            git_path,
            local_path,
        });
    }

    let candidate = resolve_path(path, workspace);
    let (candidate, effective_workspace) = if !candidate.is_dir() {
        let local = PathBuf::from(path);
        if local.is_dir() {
            (local, WorkspaceEnv::Local)
        } else {
            return Err(GitError::NotADirectory(path.to_string()));
        }
    } else {
        (candidate, workspace.clone())
    };
    let local_path = registry
        .canonicalize_cached(&candidate)
        .map_err(GitError::Io)?;
    let git_path = if effective_workspace.is_wsl() {
        normalize_git_path(path)
    } else {
        display_path(&local_path)
    };
    Ok(ResolvedGitDirectory {
        workspace: effective_workspace,
        git_path,
        local_path,
    })
}

pub fn authorized_repo_root(
    registry: &WorkspaceRegistry,
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<ResolvedGitDirectory> {
    let canonical = canonical_dir(registry, path, workspace)?;
    if !workspace.is_remote() && !registry.is_authorized(&canonical.local_path) {
        return Err(GitError::PathOutsideWorkspace(canonical.local_path));
    }
    Ok(canonical)
}

pub fn resolve_within_repo(repo_root: &Path, rel: &str) -> Result<PathBuf> {
    resolve_within_repo_impl(repo_root, rel, false)
}

pub fn resolve_literal_within_repo(repo_root: &Path, rel: &str) -> Result<PathBuf> {
    resolve_within_repo_impl(repo_root, rel, true)
}

fn resolve_within_repo_impl(repo_root: &Path, rel: &str, allow_colon: bool) -> Result<PathBuf> {
    let rel_norm = rel.replace('\\', "/");
    let repo_norm = repo_root.to_string_lossy().replace('\\', "/");
    let repo_clean = repo_norm
        .trim_start_matches("//?/")
        .trim_start_matches(r"\\?\")
        .trim_end_matches('/');
    let rel_clean = rel_norm
        .trim_start_matches("//?/")
        .trim_start_matches(r"\\?\");

    let repo_prefix = format!("{repo_clean}/");
    let (stripped_rel, input_matches_repo_root) = if rel_clean.len() >= repo_prefix.len()
        && rel_clean[..repo_prefix.len()].eq_ignore_ascii_case(&repo_prefix)
    {
        (&rel_clean[repo_prefix.len()..], true)
    } else if rel_clean.eq_ignore_ascii_case(repo_clean) {
        ("", true)
    } else {
        (rel.trim_start_matches(['/', '\\']), false)
    };

    let clean_rel = stripped_rel.replace('\\', "/");
    let clean_rel = clean_rel.trim_start_matches('/');
    let unmatched_absolute = !input_matches_repo_root && Path::new(&rel_clean).is_absolute();

    if !unmatched_absolute && !is_safe_path(clean_rel, allow_colon) {
        return Err(GitError::InvalidPath(clean_rel.into()));
    }
    if unmatched_absolute
        && (rel_clean.contains('\0') || rel_clean.chars().any(|c| (c as u32) < 0x20))
    {
        return Err(GitError::InvalidPath(rel_clean.into()));
    }
    if !repo_root.exists() {
        if unmatched_absolute {
            return Err(GitError::InvalidPath(rel_clean.into()));
        }
        return Ok(repo_root.join(clean_rel));
    }
    let canonical_repo_root = std::fs::canonicalize(repo_root).map_err(GitError::Io)?;
    let input_path = Path::new(&rel_clean);
    if unmatched_absolute {
        return match std::fs::canonicalize(input_path) {
            Ok(canonical) if path_is_within(&canonical_repo_root, &canonical) => Ok(canonical),
            Ok(canonical) => Err(GitError::PathOutsideWorkspace(canonical)),
            // Deleted paths are validated through their nearest existing ancestor.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                resolve_deleted_within_repo(&canonical_repo_root, input_path, rel_clean)
            }
            Err(e) => Err(GitError::Io(e)),
        };
    }
    let joined = if !input_matches_repo_root && input_path.is_absolute() {
        input_path.to_path_buf()
    } else {
        canonical_repo_root.join(clean_rel)
    };
    match std::fs::canonicalize(&joined) {
        Ok(canonical) if path_is_within(&canonical_repo_root, &canonical) => Ok(canonical),
        Ok(canonical) => Err(GitError::PathOutsideWorkspace(canonical)),
        // Deleted path (staging a removal): validate via nearest existing ancestor.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            resolve_deleted_within_repo(&canonical_repo_root, &joined, clean_rel)
        }
        Err(e) => Err(GitError::Io(e)),
    }
}

fn path_is_within(root: &Path, candidate: &Path) -> bool {
    #[cfg(windows)]
    {
        let mut candidate_components = candidate.components();
        root.components().all(|root_component| {
            candidate_components
                .next()
                .is_some_and(|candidate_component| {
                    root_component
                        .as_os_str()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&candidate_component.as_os_str().to_string_lossy())
                })
        })
    }
    #[cfg(not(windows))]
    {
        candidate.starts_with(root)
    }
}

pub fn is_safe_pathspec(rel: &str) -> bool {
    is_safe_path(rel, false)
}

fn is_safe_path(rel: &str, allow_colon: bool) -> bool {
    if rel.is_empty() || (!allow_colon && rel.contains(':')) || rel.contains('\0') {
        return false;
    }
    if rel.chars().any(|c| (c as u32) < 0x20) {
        return false;
    }
    // Reject `.`/`..` so the deleted-path branch can't be used to escape the repo.
    !rel.split(['/', '\\']).any(|c| c == "." || c == "..")
}

fn resolve_deleted_within_repo(repo_root: &Path, joined: &Path, rel: &str) -> Result<PathBuf> {
    let mut tail: Vec<&OsStr> = Vec::new();
    let mut cursor = joined;
    loop {
        let name = cursor
            .file_name()
            .ok_or_else(|| GitError::InvalidPath(rel.into()))?;
        let parent = cursor
            .parent()
            .ok_or_else(|| GitError::InvalidPath(rel.into()))?;
        tail.push(name);
        match std::fs::canonicalize(parent) {
            Ok(canonical_parent) => {
                if !path_is_within(repo_root, &canonical_parent) {
                    return Err(GitError::PathOutsideWorkspace(canonical_parent));
                }
                let mut resolved = canonical_parent;
                for component in tail.iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                cursor = parent;
            }
            Err(e) => return Err(GitError::Io(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_upstream_separates_remote_and_branch() {
        assert_eq!(
            split_upstream("origin/main"),
            (Some("origin".to_string()), Some("main".to_string()))
        );
    }

    #[test]
    fn split_upstream_splits_on_the_first_slash_only() {
        assert_eq!(
            split_upstream("origin/feature/x"),
            (Some("origin".to_string()), Some("feature/x".to_string()))
        );
    }

    #[test]
    fn split_upstream_without_slash_yields_branch_only() {
        assert_eq!(split_upstream("main"), (None, Some("main".to_string())));
    }

    #[test]
    fn normalize_git_path_converts_backslashes_to_slashes() {
        assert_eq!(normalize_git_path("a\\b\\c"), "a/b/c");
        assert_eq!(normalize_git_path("a/b"), "a/b");
    }

    #[test]
    fn safe_pathspec_accepts_normal_paths() {
        assert!(is_safe_pathspec("src/main.rs"));
        assert!(is_safe_pathspec("a/b/c-d_e.txt"));
        assert!(is_safe_pathspec("folder with spaces/file.md"));
        assert!(is_safe_pathspec("file.with.dots"));
    }

    #[test]
    fn safe_pathspec_rejects_colon() {
        assert!(!is_safe_pathspec("evil:path"));
        assert!(!is_safe_pathspec(":head"));
        assert!(!is_safe_pathspec("a/b:c"));
    }

    #[test]
    fn safe_pathspec_rejects_nul_and_control() {
        assert!(!is_safe_pathspec("foo\0bar"));
        assert!(!is_safe_pathspec("foo\nbar"));
        assert!(!is_safe_pathspec("foo\rbar"));
        assert!(!is_safe_pathspec("foo\tbar"));
    }

    #[test]
    fn safe_pathspec_rejects_empty() {
        assert!(!is_safe_pathspec(""));
    }

    #[test]
    fn resolve_within_repo_rejects_colon_path() {
        let tmp = std::env::temp_dir();
        let err = resolve_within_repo(&tmp, "evil:path");
        assert!(matches!(err, Err(GitError::InvalidPath(_))));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_literal_within_repo_accepts_colon_directory_without_allowing_escape() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(":(glob)*");
        std::fs::create_dir(&path).unwrap();
        assert_eq!(
            resolve_literal_within_repo(root.path(), ":(glob)*").unwrap(),
            path.canonicalize().unwrap()
        );
        assert!(matches!(
            resolve_literal_within_repo(root.path(), "../outside"),
            Err(GitError::InvalidPath(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_within_repo_accepts_absolute_paths_through_a_repo_alias() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let repo = parent.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        let file = repo.join("file.txt");
        std::fs::write(&file, "contents").unwrap();
        let alias = parent.path().join("repo-alias");
        symlink(&repo, &alias).unwrap();

        let resolved = resolve_within_repo(
            &repo.canonicalize().unwrap(),
            alias.join("file.txt").to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(resolved, file.canonicalize().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_within_repo_rejects_symlinks_to_sibling_prefixes() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let repo = parent.path().join("repo");
        let sibling = parent.path().join("repo-outside");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        std::fs::write(sibling.join("secret.txt"), "outside").unwrap();
        symlink(&sibling, repo.join("linked")).unwrap();

        let result = resolve_within_repo(&repo.canonicalize().unwrap(), "linked/secret.txt");

        assert!(matches!(result, Err(GitError::PathOutsideWorkspace(_))));
    }

    #[test]
    fn resolve_within_repo_rejects_nul_path() {
        let tmp = std::env::temp_dir();
        let err = resolve_within_repo(&tmp, "evil\0path");
        assert!(matches!(err, Err(GitError::InvalidPath(_))));
    }

    #[test]
    fn safe_pathspec_rejects_dot_components() {
        assert!(!is_safe_pathspec("../escape"));
        assert!(!is_safe_pathspec("a/../b"));
        assert!(!is_safe_pathspec("./a"));
        assert!(!is_safe_pathspec("a/."));
        assert!(!is_safe_pathspec(".."));
    }

    #[test]
    fn resolve_within_repo_handles_deleted_directory() {
        let base = std::env::temp_dir().join("voktty_git_deleted_dir_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("envs/__pycache__")).unwrap();
        let repo_root = std::fs::canonicalize(&base).unwrap();
        std::fs::remove_dir_all(repo_root.join("envs")).unwrap();
        let resolved =
            resolve_within_repo(&repo_root, "envs/__pycache__/g1.pyc").expect("deleted path");
        assert_eq!(resolved, repo_root.join("envs/__pycache__/g1.pyc"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_within_repo_rejects_deleted_escape() {
        let tmp = std::env::temp_dir();
        let err = resolve_within_repo(&tmp, "../outside.txt");
        assert!(matches!(err, Err(GitError::InvalidPath(_))));
    }
}
