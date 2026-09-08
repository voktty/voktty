mod common;

use common::GitRepoFixture;
use std::sync::Mutex;
use tempfile::TempDir;
use voktty_lib::modules::fs::to_canon;
use voktty_lib::modules::git::operations;

fn git_available() -> bool {
    common::git_available()
}

fn skip_if_no_git() -> bool {
    if !git_available() {
        eprintln!("skipping: git not on PATH");
        return true;
    }
    false
}

/// `VOKTTY_WORKTREES_DIR` is process-global; serialize every test that
/// touches it so parallel `cargo test` runs don't race on the same env var.
static WORKTREES_DIR_LOCK: Mutex<()> = Mutex::new(());

struct WorktreesDirGuard {
    _tmp: TempDir,
    _guard: std::sync::MutexGuard<'static, ()>,
}

fn with_scratch_worktrees_dir() -> WorktreesDirGuard {
    let guard = WORKTREES_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = TempDir::new().expect("tempdir");
    // SAFETY: serialized by WORKTREES_DIR_LOCK for the guard's lifetime.
    unsafe {
        std::env::set_var("VOKTTY_WORKTREES_DIR", tmp.path());
    }
    WorktreesDirGuard {
        _tmp: tmp,
        _guard: guard,
    }
}

impl Drop for WorktreesDirGuard {
    fn drop(&mut self) {
        // SAFETY: still serialized by the held lock.
        unsafe {
            std::env::remove_var("VOKTTY_WORKTREES_DIR");
        }
    }
}

#[test]
fn worktree_add_creates_an_isolated_checkout_on_its_own_branch() {
    if skip_if_no_git() {
        return;
    }
    let _scratch = with_scratch_worktrees_dir();
    let fx = GitRepoFixture::new();
    fx.write_file("seed.txt", "seed\n");
    fx.run_git(&["add", "seed.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let path = operations::worktree_add(&fx.registry, &fx.repo_str(), "session-1", &fx.workspace)
        .expect("worktree_add");
    let worktree_path = std::path::PathBuf::from(&path);

    assert!(worktree_path.is_dir());
    assert!(worktree_path.join("seed.txt").is_file());
    assert_ne!(to_canon(&worktree_path), fx.repo_str());

    let branch =
        operations::resolve_repo(&fx.registry, &path, &fx.workspace).expect("resolve_repo");
    assert_eq!(branch.expect("repo").branch, "voktty/session-1");
}

#[test]
fn worktree_add_rejects_an_unsafe_session_id() {
    if skip_if_no_git() {
        return;
    }
    let _scratch = with_scratch_worktrees_dir();
    let fx = GitRepoFixture::new();
    fx.run_git(&["commit", "-q", "--allow-empty", "-m", "seed"]);

    let err = operations::worktree_add(&fx.registry, &fx.repo_str(), "../escape", &fx.workspace)
        .unwrap_err();
    assert!(matches!(
        err,
        voktty_lib::modules::git::errors::GitError::InvalidPath(_)
    ));
}

#[test]
fn worktree_add_refuses_a_second_worktree_for_the_same_session() {
    if skip_if_no_git() {
        return;
    }
    let _scratch = with_scratch_worktrees_dir();
    let fx = GitRepoFixture::new();
    fx.run_git(&["commit", "-q", "--allow-empty", "-m", "seed"]);

    operations::worktree_add(&fx.registry, &fx.repo_str(), "session-1", &fx.workspace)
        .expect("first worktree_add");
    let err = operations::worktree_add(&fx.registry, &fx.repo_str(), "session-1", &fx.workspace)
        .unwrap_err();
    assert!(err.to_string().contains("already exists"));
}

#[test]
fn worktree_remove_deletes_a_clean_worktree_and_its_branch() {
    if skip_if_no_git() {
        return;
    }
    let _scratch = with_scratch_worktrees_dir();
    let fx = GitRepoFixture::new();
    fx.run_git(&["commit", "-q", "--allow-empty", "-m", "seed"]);

    let path = operations::worktree_add(&fx.registry, &fx.repo_str(), "session-1", &fx.workspace)
        .expect("worktree_add");

    let outcome = operations::worktree_remove(&fx.registry, &path, false, &fx.workspace)
        .expect("worktree_remove");
    assert!(outcome.removed);
    assert!(outcome.reason.is_none());
    assert!(!std::path::Path::new(&path).exists());

    let branches = fx.run_git_output(&["branch", "--list", "voktty/session-1"]);
    assert!(
        branches.trim().is_empty(),
        "branch should be deleted: {branches:?}"
    );
}

#[test]
fn worktree_remove_refuses_a_dirty_worktree_without_force() {
    if skip_if_no_git() {
        return;
    }
    let _scratch = with_scratch_worktrees_dir();
    let fx = GitRepoFixture::new();
    fx.run_git(&["commit", "-q", "--allow-empty", "-m", "seed"]);

    let path = operations::worktree_add(&fx.registry, &fx.repo_str(), "session-1", &fx.workspace)
        .expect("worktree_add");
    std::fs::write(
        std::path::Path::new(&path).join("dirty.txt"),
        "uncommitted\n",
    )
    .expect("write dirty file");

    let outcome = operations::worktree_remove(&fx.registry, &path, false, &fx.workspace)
        .expect("worktree_remove");
    assert!(!outcome.removed);
    assert_eq!(outcome.reason.as_deref(), Some("uncommitted changes"));
    assert!(std::path::Path::new(&path).is_dir());

    let forced = operations::worktree_remove(&fx.registry, &path, true, &fx.workspace)
        .expect("forced worktree_remove");
    assert!(forced.removed);
    assert!(!std::path::Path::new(&path).exists());
}

#[test]
fn worktree_remove_refuses_a_path_outside_the_voktty_worktrees_dir() {
    if skip_if_no_git() {
        return;
    }
    let _scratch = with_scratch_worktrees_dir();
    let fx = GitRepoFixture::new();
    fx.run_git(&["commit", "-q", "--allow-empty", "-m", "seed"]);

    // The repo root itself is authorized but was never created by
    // worktree_add — must never be treated as a removable worktree.
    let err =
        operations::worktree_remove(&fx.registry, &fx.repo_str(), true, &fx.workspace).unwrap_err();
    assert!(err.to_string().contains("not a Voktty-managed worktree"));
}
