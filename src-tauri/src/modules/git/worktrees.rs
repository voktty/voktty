use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::modules::git::errors::{GitError, Result as GitResult};
use crate::modules::git::process::{ensure_git_available, ensure_success, run_git};
use crate::modules::git::utils::authorized_repo_root;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry, resolve_path};

const MAX_WORKTREES: usize = 128;
const WORKTREE_STATUS_BUDGET: Duration = Duration::from_secs(15);
const WORKTREE_STATUS_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    path: String,
    branch: Option<String>,
    head: String,
    is_main: bool,
    locked: bool,
    prunable: bool,
    missing: bool,
    dirty: Option<bool>,
    unpushed: Option<u32>,
    session_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktrees {
    worktrees: Vec<Worktree>,
    default_root: String,
}

#[derive(Default)]
struct RawWorktree {
    path: String,
    branch: Option<String>,
    head: String,
    bare: bool,
    locked: bool,
    prunable: bool,
}

async fn blocking<F, T>(app: AppHandle, operation: F) -> std::result::Result<T, String>
where
    F: FnOnce(&WorkspaceRegistry) -> GitResult<T> + Send + 'static,
    T: Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        operation(&registry).map_err(Into::into)
    })
    .await
    .map_err(|error| error.to_string())?;
    result
}

#[tauri::command]
pub async fn git_worktrees(
    cwd: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> std::result::Result<Worktrees, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |registry| {
        list_worktrees(registry, &cwd, &workspace)
    })
    .await
}

#[tauri::command]
pub async fn git_worktree_create(
    cwd: String,
    branch: String,
    base: String,
    existing: bool,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> std::result::Result<Worktree, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |registry| {
        create_worktree(registry, &cwd, &branch, &base, existing, &workspace)
    })
    .await
}

fn list_worktrees(
    registry: &WorkspaceRegistry,
    cwd: &str,
    workspace: &WorkspaceEnv,
) -> GitResult<Worktrees> {
    ensure_supported_workspace(workspace)?;
    let repo = authorized_repo_root(registry, cwd, workspace)?;
    ensure_git_available(&repo.workspace)?;

    let output = run_git(
        &repo.workspace,
        Some(&repo.git_path),
        ["worktree", "list", "--porcelain", "-z"],
        30,
    )?;
    ensure_success(&output, "git worktree list failed")?;
    if output.truncated {
        return Err(GitError::command(
            "git worktree list",
            "the repository has too many worktrees to list safely",
        ));
    }
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|error| GitError::command("git worktree list", error.to_string()))?;
    let raw = parse_worktrees(text);
    if raw.is_empty() {
        return Err(GitError::command(
            "git worktree list",
            "no working copies found",
        ));
    }
    if raw.len() > MAX_WORKTREES {
        return Err(GitError::command(
            "git worktree list",
            "the repository exceeds the worktree limit",
        ));
    }

    let default_root = path_parent(&raw[0].path, &repo.workspace)?;
    let mut worktrees = Vec::with_capacity(raw.len());
    let status_started = Instant::now();
    for (index, entry) in raw.into_iter().enumerate() {
        let mut missing = entry.prunable;
        if !repo.workspace.is_remote() && !missing {
            let local_path = resolve_path(&entry.path, &repo.workspace);
            match std::fs::symlink_metadata(&local_path) {
                Ok(metadata) if metadata.file_type().is_symlink() => missing = true,
                Ok(metadata) if metadata.is_dir() => {
                    registry.authorize(&local_path)?;
                }
                _ => missing = true,
            }
        }
        let status_timeout_secs = worktree_status_timeout_secs(status_started.elapsed());
        let (dirty, unpushed) = if missing || status_timeout_secs == 0 {
            (None, None)
        } else {
            worktree_status(&repo.workspace, &entry.path, status_timeout_secs)
        };
        worktrees.push(Worktree {
            path: entry.path,
            branch: entry.branch,
            head: entry.head,
            is_main: index == 0,
            locked: entry.locked,
            prunable: entry.prunable,
            missing,
            dirty,
            unpushed,
            session_ids: Vec::new(),
        });
    }

    Ok(Worktrees {
        worktrees,
        default_root,
    })
}

fn worktree_status(
    workspace: &WorkspaceEnv,
    path: &str,
    timeout_secs: u64,
) -> (Option<bool>, Option<u32>) {
    let Ok(output) = run_git(
        workspace,
        Some(path),
        [
            "status",
            "--porcelain=v2",
            "--branch",
            "--ahead-behind",
            "--untracked-files=normal",
        ],
        timeout_secs,
    ) else {
        return (None, None);
    };
    if output.exit_code != Some(0) || output.timed_out || output.truncated {
        return (None, None);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let (dirty, unpushed) = parse_worktree_status(&text);
    (Some(dirty), unpushed)
}

fn worktree_status_timeout_secs(elapsed: Duration) -> u64 {
    WORKTREE_STATUS_BUDGET
        .saturating_sub(elapsed)
        .as_secs()
        .min(WORKTREE_STATUS_TIMEOUT_SECS)
}

fn parse_worktree_status(output: &str) -> (bool, Option<u32>) {
    let dirty = output
        .lines()
        .any(|line| !line.is_empty() && !line.starts_with('#'));
    let unpushed = output.lines().find_map(|line| {
        let ahead_behind = line.strip_prefix("# branch.ab ")?;
        ahead_behind
            .split_whitespace()
            .next()?
            .strip_prefix('+')?
            .parse::<u32>()
            .ok()
    });
    (dirty, unpushed)
}

fn create_worktree(
    registry: &WorkspaceRegistry,
    cwd: &str,
    branch: &str,
    base: &str,
    existing: bool,
    workspace: &WorkspaceEnv,
) -> GitResult<Worktree> {
    ensure_supported_workspace(workspace)?;
    validate_branch_name(branch)?;
    if base.is_empty() || base.len() > 255 || base.chars().any(char::is_control) {
        return Err(GitError::InvalidPath(base.to_string()));
    }

    let repo = authorized_repo_root(registry, cwd, workspace)?;
    ensure_git_available(&repo.workspace)?;
    let branch_check = run_git(
        &repo.workspace,
        Some(&repo.git_path),
        ["check-ref-format", "--branch", branch],
        30,
    )?;
    ensure_success(&branch_check, "invalid branch name")?;
    let listed = list_worktrees(registry, cwd, workspace)?;
    if listed
        .worktrees
        .iter()
        .any(|tree| tree.branch.as_deref() == Some(branch))
    {
        return Err(GitError::command(
            "git worktree add",
            "this branch already has a working copy",
        ));
    }

    let refs = crate::modules::git::process::git_stdout_lines(
        &repo.workspace,
        &repo.git_path,
        [
            "for-each-ref",
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let local_ref = format!("refs/heads/{branch}");
    let source = if existing {
        if !refs.iter().any(|name| name == &local_ref) {
            return Err(GitError::command(
                "git worktree add",
                "choose an available local branch",
            ));
        }
        None
    } else {
        if refs.iter().any(|name| name == &local_ref) {
            return Err(GitError::command(
                "git worktree add",
                "this branch already exists; choose it as an existing branch",
            ));
        }
        let source = if base == "HEAD" {
            "HEAD".to_string()
        } else {
            refs.iter()
                .find(|name| {
                    name.strip_prefix("refs/heads/") == Some(base)
                        || name.strip_prefix("refs/remotes/") == Some(base)
                })
                .cloned()
                .ok_or_else(|| {
                    GitError::command("git worktree add", "choose an available base branch")
                })?
        };
        let revision = format!("{source}^{{commit}}");
        let output = run_git(
            &repo.workspace,
            Some(&repo.git_path),
            [
                OsString::from("rev-parse"),
                OsString::from("--verify"),
                OsString::from("--end-of-options"),
                OsString::from(revision),
            ],
            30,
        )?;
        ensure_success(&output, "git worktree base is unavailable")?;
        let commit = std::str::from_utf8(&output.stdout)
            .map_err(|error| GitError::command("git worktree base", error.to_string()))?
            .trim()
            .to_string();
        Some(commit)
    };

    let main = listed
        .worktrees
        .iter()
        .find(|tree| tree.is_main)
        .ok_or_else(|| GitError::command("git worktree add", "main worktree not found"))?;
    let path = new_worktree_path(&listed.default_root, branch, &repo.workspace)?;
    let args = if existing {
        vec![
            OsString::from("worktree"),
            OsString::from("add"),
            OsString::from("--"),
            OsString::from(&path),
            OsString::from(branch),
        ]
    } else {
        vec![
            OsString::from("worktree"),
            OsString::from("add"),
            OsString::from("--no-track"),
            OsString::from("-b"),
            OsString::from(branch),
            OsString::from("--"),
            OsString::from(&path),
            OsString::from(source.expect("new branches have a resolved base")),
        ]
    };
    let output = run_git(&repo.workspace, Some(&repo.git_path), args, 60)?;
    ensure_success(&output, "git worktree add failed")?;

    let created = list_worktrees(registry, &main.path, workspace)?
        .worktrees
        .into_iter()
        .find(|tree| tree.path == path)
        .ok_or_else(|| {
            GitError::command(
                "git worktree add",
                "worktree created but could not be found; refresh the picker",
            )
        })?;
    Ok(created)
}

fn ensure_supported_workspace(workspace: &WorkspaceEnv) -> GitResult<()> {
    if workspace.is_docker() {
        return Err(GitError::command(
            "git worktree",
            "Docker workspaces do not have a native Git execution adapter yet",
        ));
    }
    #[cfg(not(windows))]
    if workspace.is_wsl() {
        return Err(GitError::command(
            "git worktree",
            "WSL workspaces are only available on Windows",
        ));
    }
    Ok(())
}

fn validate_branch_name(branch: &str) -> GitResult<()> {
    if branch.is_empty()
        || branch.len() > 120
        || branch.starts_with('-')
        || branch.starts_with('@')
        || branch.chars().any(char::is_control)
    {
        return Err(GitError::InvalidPath(branch.to_string()));
    }
    Ok(())
}

fn parse_worktrees(text: &str) -> Vec<RawWorktree> {
    let mut entries = Vec::new();
    let mut current: Option<RawWorktree> = None;
    for field in text.split('\0') {
        if let Some(path) = field.strip_prefix("worktree ") {
            if let Some(previous) = current.take() {
                if !previous.bare {
                    entries.push(previous);
                }
            }
            current = Some(RawWorktree {
                path: path.to_string(),
                ..RawWorktree::default()
            });
        } else if let Some(entry) = current.as_mut() {
            if let Some(head) = field.strip_prefix("HEAD ") {
                entry.head = head.to_string();
            } else if let Some(branch) = field.strip_prefix("branch refs/heads/") {
                entry.branch = Some(branch.to_string());
            } else if field == "bare" {
                entry.bare = true;
            } else if field == "locked" || field.starts_with("locked ") {
                entry.locked = true;
            } else if field == "prunable" || field.starts_with("prunable ") {
                entry.prunable = true;
            }
        }
    }
    if let Some(last) = current {
        if !last.bare {
            entries.push(last);
        }
    }
    entries
}

fn path_parent(path: &str, workspace: &WorkspaceEnv) -> GitResult<String> {
    if workspace.is_remote() || workspace.is_wsl() {
        let normalized = path.replace('\\', "/");
        let clean = normalized.trim_end_matches('/');
        let (parent, basename) = clean
            .rsplit_once('/')
            .ok_or_else(|| GitError::InvalidPath(path.to_string()))?;
        if basename.is_empty() {
            return Err(GitError::InvalidPath(path.to_string()));
        }
        return Ok(if parent.is_empty() {
            "/".to_string()
        } else {
            parent.to_string()
        });
    }
    Path::new(path)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| parent.to_string_lossy().into_owned())
        .ok_or_else(|| GitError::InvalidPath(path.to_string()))
}

fn new_worktree_path(
    default_root: &str,
    branch: &str,
    workspace: &WorkspaceEnv,
) -> GitResult<String> {
    let slug = branch
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .take(48)
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let slug = if slug.is_empty() { "branch" } else { &slug };
    let suffix = Uuid::new_v4().simple().to_string();
    let leaf = format!("voktty-{slug}-{suffix}");
    let path = if workspace.is_remote() || workspace.is_wsl() {
        format!("{}/{leaf}", default_root.trim_end_matches('/'))
    } else {
        PathBuf::from(default_root)
            .join(leaf)
            .to_string_lossy()
            .into_owned()
    };
    if path.len() > 4096 {
        return Err(GitError::InvalidPath(path));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Output};

    fn run_git(repo: &Path, args: &[&str]) -> Output {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("git is available");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    fn repository() -> (tempfile::TempDir, PathBuf, WorkspaceRegistry) {
        let parent = tempfile::tempdir().expect("temporary repository parent");
        let repo = parent.path().join("project");
        std::fs::create_dir(&repo).expect("repository directory");
        run_git(&repo, &["init", "-q"]);
        run_git(&repo, &["config", "user.name", "Voktty Test"]);
        run_git(
            &repo,
            &["config", "user.email", "voktty-test@example.invalid"],
        );
        std::fs::write(repo.join("base.txt"), "base\n").expect("initial file");
        run_git(&repo, &["add", "--all"]);
        run_git(&repo, &["commit", "-m", "initial"]);
        let registry = WorkspaceRegistry::default();
        registry.authorize(&repo).expect("authorize repository");
        (parent, repo, registry)
    }

    #[test]
    fn parses_porcelain_nul_fields_and_preserves_path_spaces() {
        let entries = parse_worktrees(
            "worktree /tmp/project\0HEAD abc123\0branch refs/heads/main\0worktree /tmp/feature copy\0HEAD def456\0branch refs/heads/feature/copy\0locked user lock\0prunable missing\0",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].path, "/tmp/feature copy");
        assert_eq!(entries[1].branch.as_deref(), Some("feature/copy"));
        assert!(entries[1].locked);
        assert!(entries[1].prunable);
    }

    #[test]
    fn parses_dirty_and_upstream_ahead_metadata_from_porcelain_v2() {
        assert_eq!(
            parse_worktree_status(
                "# branch.head feature\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 abc abc file.txt\n"
            ),
            (true, Some(2))
        );
        assert_eq!(
            parse_worktree_status("# branch.head feature\n# branch.ab +0 -0\n"),
            (false, Some(0))
        );
        assert_eq!(
            parse_worktree_status("# branch.head feature\n"),
            (false, None)
        );
    }

    #[test]
    fn bounds_worktree_status_queries_by_per_query_and_total_budgets() {
        assert_eq!(worktree_status_timeout_secs(Duration::ZERO), 5);
        assert_eq!(worktree_status_timeout_secs(Duration::from_secs(9)), 5);
        assert_eq!(worktree_status_timeout_secs(Duration::from_secs(10)), 5);
        assert_eq!(worktree_status_timeout_secs(Duration::from_secs(14)), 1);
        assert_eq!(worktree_status_timeout_secs(Duration::from_millis(14_999)), 0);
        assert_eq!(worktree_status_timeout_secs(Duration::from_secs(15)), 0);
    }

    #[test]
    fn lists_main_worktree_and_authorizes_registered_worktrees() {
        let (_parent, repo, registry) = repository();
        let output = run_git(
            &repo,
            &["worktree", "add", "-q", "-b", "feature", "../feature"],
        );
        assert!(output.status.success());

        let listed = list_worktrees(&registry, &repo.to_string_lossy(), &WorkspaceEnv::Local)
            .expect("list worktrees");
        assert_eq!(listed.worktrees.len(), 2);
        assert!(listed.worktrees[0].is_main);
        assert_eq!(listed.worktrees[1].branch.as_deref(), Some("feature"));
        assert!(registry.is_authorized(Path::new(&listed.worktrees[1].path)));
    }

    #[test]
    fn lists_dirty_state_and_unpushed_commits_for_each_worktree() {
        let (parent, repo, registry) = repository();
        run_git(&repo, &["branch", "-M", "main"]);

        let origin = parent.path().join("origin.git");
        let output = Command::new("git")
            .args(["init", "--bare", "--quiet"])
            .arg(&origin)
            .output()
            .expect("git is available");
        assert!(output.status.success());
        run_git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                origin.to_str().expect("utf-8 path"),
            ],
        );
        run_git(&repo, &["push", "--quiet", "-u", "origin", "main"]);

        let feature = parent.path().join("feature");
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "--quiet",
                "-b",
                "feature",
                feature.to_str().unwrap(),
            ],
        );
        run_git(&feature, &["branch", "--set-upstream-to", "origin/main"]);
        std::fs::write(feature.join("feature.txt"), "feature\n").expect("write commit file");
        run_git(&feature, &["add", "feature.txt"]);
        run_git(&feature, &["commit", "--quiet", "-m", "feature"]);
        std::fs::write(feature.join("dirty.txt"), "uncommitted\n").expect("write dirty file");

        let listed = list_worktrees(&registry, &repo.to_string_lossy(), &WorkspaceEnv::Local)
            .expect("list worktrees");
        let main = listed
            .worktrees
            .iter()
            .find(|tree| tree.branch.as_deref() == Some("main"))
            .expect("main worktree");
        assert_eq!(main.dirty, Some(false));
        assert_eq!(main.unpushed, Some(0));

        let feature = listed
            .worktrees
            .iter()
            .find(|tree| tree.branch.as_deref() == Some("feature"))
            .expect("feature worktree");
        assert_eq!(feature.dirty, Some(true));
        assert_eq!(feature.unpushed, Some(1));
    }

    #[test]
    fn creates_new_and_existing_local_branch_worktrees() {
        let (_parent, repo, registry) = repository();
        let created = create_worktree(
            &registry,
            &repo.to_string_lossy(),
            "feature/new-worktree",
            "HEAD",
            false,
            &WorkspaceEnv::Local,
        )
        .expect("create new branch worktree");
        assert_eq!(created.branch.as_deref(), Some("feature/new-worktree"));
        assert!(!created.is_main);
        assert!(Path::new(&created.path).is_dir());
        assert!(registry.is_authorized(Path::new(&created.path)));

        run_git(&repo, &["branch", "existing"]);
        let existing = create_worktree(
            &registry,
            &repo.to_string_lossy(),
            "existing",
            "HEAD",
            true,
            &WorkspaceEnv::Local,
        )
        .expect("create worktree from existing branch");
        assert_eq!(existing.branch.as_deref(), Some("existing"));
        assert!(!existing.is_main);
    }

    #[test]
    fn rejects_invalid_or_already_checked_out_branches() {
        let (_parent, repo, registry) = repository();
        assert!(validate_branch_name("-option").is_err());
        assert!(validate_branch_name("@{upstream}").is_err());

        create_worktree(
            &registry,
            &repo.to_string_lossy(),
            "feature",
            "HEAD",
            false,
            &WorkspaceEnv::Local,
        )
        .expect("first worktree");
        let error = create_worktree(
            &registry,
            &repo.to_string_lossy(),
            "feature",
            "HEAD",
            false,
            &WorkspaceEnv::Local,
        )
        .expect_err("duplicate branch");
        assert!(error.to_string().contains("already has a working copy"));
    }

    #[test]
    fn refuses_docker_workspaces_instead_of_running_git_on_the_host() {
        let workspace = WorkspaceEnv::Docker {
            container_id: "container".into(),
            container_name: None,
            image: None,
            shell: None,
            user: None,
            workdir: None,
        };
        assert!(ensure_supported_workspace(&workspace)
            .unwrap_err()
            .to_string()
            .contains("Docker workspaces"));
    }
}
