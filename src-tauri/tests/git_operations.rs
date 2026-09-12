mod common;

use common::{git_available, GitRepoFixture};
use tempfile::TempDir;
use voktty_lib::modules::fs::to_canon;
use voktty_lib::modules::git::errors::GitError;
use voktty_lib::modules::git::operations;
use voktty_lib::modules::git::types::DiscardEntry;
use voktty_lib::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

fn skip_if_no_git() -> bool {
    if !git_available() {
        eprintln!("skipping: git not on PATH");
        return true;
    }
    false
}

#[test]
fn resolve_repo_returns_none_outside_repo() {
    if skip_if_no_git() {
        return;
    }
    let tmp = TempDir::new().unwrap();
    let canonical = std::fs::canonicalize(tmp.path()).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(&canonical).unwrap();

    let info = operations::resolve_repo(&registry, &to_canon(&canonical), &WorkspaceEnv::Local)
        .expect("resolve_repo");
    assert!(info.is_none());
}

#[test]
fn resolve_repo_returns_branch_for_real_repo() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("seed.txt", "seed\n");
    fx.run_git(&["add", "seed.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let info = operations::resolve_repo(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("resolve_repo")
        .expect("repo present");
    assert_eq!(info.branch, "main");
    assert!(info.upstream.is_none());
    assert!(!info.is_detached);
}

#[test]
fn resolve_repo_returns_branch_for_unborn_head() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let info = operations::resolve_repo(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("resolve_repo")
        .expect("repo present even without commits");
    assert_eq!(info.branch, "main");
    assert!(info.upstream.is_none());
    assert!(!info.is_detached);
}

#[test]
fn status_on_empty_repo_has_no_files() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).expect("status");
    assert_eq!(snap.branch, "main");
    assert!(snap.changed_files.is_empty());
    assert_eq!(snap.ahead, 0);
    assert_eq!(snap.behind, 0);
}

#[test]
fn status_lists_untracked_file() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("hello.txt", "hi\n");
    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).expect("status");
    let entry = snap
        .changed_files
        .iter()
        .find(|f| f.path == "hello.txt")
        .expect("hello.txt in changed_files");
    assert!(entry.untracked);
    assert!(!entry.staged);
}

#[test]
fn stage_then_commit_produces_log_entry() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    operations::stage(
        &fx.registry,
        &fx.repo_str(),
        &["a.txt".into()],
        &fx.workspace,
    )
    .expect("stage");

    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    let entry = snap
        .changed_files
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt staged");
    assert!(entry.staged);
    assert!(!entry.untracked);

    let commit =
        operations::commit(&fx.registry, &fx.repo_str(), "add a", &fx.workspace).expect("commit");
    assert_eq!(commit.summary, "add a");
    assert_eq!(commit.commit_sha.len(), 40);

    let entries =
        operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).expect("log");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].sha, commit.commit_sha);
    assert_eq!(entries[0].subject, "add a");
}

#[test]
fn log_all_refs_includes_side_branch_and_uses_offset_pagination() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("base.txt", "base\n");
    fx.run_git(&["add", "base.txt"]);
    fx.run_git(&["commit", "-q", "-m", "base"]);
    fx.run_git(&["checkout", "-q", "-b", "side"]);
    fx.write_file("side.txt", "side\n");
    fx.run_git(&["add", "side.txt"]);
    fx.run_git(&["commit", "-q", "-m", "side commit"]);
    fx.run_git(&["checkout", "-q", "main"]);
    fx.write_file("main.txt", "main\n");
    fx.run_git(&["add", "main.txt"]);
    fx.run_git(&["commit", "-q", "-m", "main commit"]);

    let current = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace)
        .expect("current log");
    assert!(current.iter().all(|entry| entry.subject != "side commit"));
    assert!(current.iter().all(|entry| entry.files_changed == 0));

    let all = operations::log_with_options(
        &fx.registry,
        &fx.repo_str(),
        10,
        None,
        true,
        0,
        &fx.workspace,
    )
    .expect("all-ref log");
    assert!(all.iter().any(|entry| entry.subject == "side commit"));

    let first = operations::log_with_options(
        &fx.registry,
        &fx.repo_str(),
        1,
        None,
        true,
        0,
        &fx.workspace,
    )
    .expect("first page");
    let second = operations::log_with_options(
        &fx.registry,
        &fx.repo_str(),
        1,
        None,
        true,
        1,
        &fx.workspace,
    )
    .expect("second page");
    assert_ne!(first[0].sha, second[0].sha);
}

#[test]
fn unstage_clears_index_entry() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "beta\n");
    operations::stage(
        &fx.registry,
        &fx.repo_str(),
        &["a.txt".into()],
        &fx.workspace,
    )
    .unwrap();

    operations::unstage(
        &fx.registry,
        &fx.repo_str(),
        &["a.txt".into()],
        &fx.workspace,
    )
    .expect("unstage");

    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    let entry = snap
        .changed_files
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt present");
    assert!(!entry.staged);
    assert!(entry.unstaged);
}

#[test]
fn stage_contents_stages_partial_changes_leaving_the_working_tree_alone() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "one\ntwo\nthree\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    // The working tree changes two lines; only one is reconstructed as the
    // partial content to stage, simulating "stage just this hunk".
    fx.write_file("a.txt", "ONE\ntwo\nTHREE\n");

    operations::stage_contents(
        &fx.registry,
        &fx.repo_str(),
        "a.txt",
        b"ONE\ntwo\nthree\n",
        &fx.workspace,
    )
    .expect("stage_contents");

    let show_output = std::process::Command::new("git")
        .args(["show", ":a.txt"])
        .current_dir(&fx.repo_path)
        .output()
        .expect("git show :a.txt");
    assert_eq!(
        String::from_utf8_lossy(&show_output.stdout),
        "ONE\ntwo\nthree\n"
    );

    let snap = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    let entry = snap
        .changed_files
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt present");
    assert!(entry.staged);
    assert!(entry.unstaged, "the other hunk is still unstaged");

    let worktree = std::fs::read_to_string(fx.repo_path.join("a.txt")).expect("read worktree");
    assert_eq!(
        worktree, "ONE\ntwo\nTHREE\n",
        "staging via the index must not touch the working tree file"
    );
}

#[test]
fn stage_contents_rejects_content_over_the_size_limit() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);

    let oversized = vec![b'a'; 3 * 1024 * 1024];
    match operations::stage_contents(
        &fx.registry,
        &fx.repo_str(),
        "a.txt",
        &oversized,
        &fx.workspace,
    ) {
        Err(GitError::FileTooLarge { .. }) => {}
        Err(other) => panic!("expected FileTooLarge, got {other}"),
        Ok(_) => panic!("expected error for oversized content"),
    }
}

#[test]
fn commit_with_empty_message_is_rejected() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);

    match operations::commit(&fx.registry, &fx.repo_str(), "   ", &fx.workspace) {
        Err(GitError::EmptyCommitMessage) => {}
        Err(other) => panic!("expected EmptyCommitMessage, got {other}"),
        Ok(_) => panic!("expected error for empty message"),
    }
}

#[test]
fn log_on_empty_repo_returns_empty_list() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let entries =
        operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).expect("log");
    assert!(entries.is_empty());
}

#[test]
fn diff_shows_worktree_change() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "alpha\nbeta\n");

    let diff =
        operations::diff(&fx.registry, &fx.repo_str(), None, false, &fx.workspace).expect("diff");
    assert!(diff.diff_text.contains("+beta"));
}

#[test]
fn diff_staged_only_shows_index_change() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "alpha\nbeta\n");
    fx.run_git(&["add", "a.txt"]);
    fx.write_file("a.txt", "alpha\nbeta\ngamma\n");

    let staged = operations::diff(&fx.registry, &fx.repo_str(), None, true, &fx.workspace)
        .expect("staged diff");
    assert!(staged.diff_text.contains("+beta"));
    assert!(!staged.diff_text.contains("+gamma"));
}

#[test]
fn discard_tracked_restores_worktree() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.write_file("a.txt", "tampered\n");

    operations::discard(
        &fx.registry,
        &fx.repo_str(),
        &[DiscardEntry {
            path: "a.txt".into(),
            untracked: false,
        }],
        &fx.workspace,
    )
    .expect("discard");

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "alpha\n");
}

#[test]
fn discard_untracked_removes_file() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("garbage.txt", "junk\n");

    operations::discard(
        &fx.registry,
        &fx.repo_str(),
        &[DiscardEntry {
            path: "garbage.txt".into(),
            untracked: true,
        }],
        &fx.workspace,
    )
    .expect("discard");

    assert!(!fx.repo_path.join("garbage.txt").exists());
}

#[test]
fn panel_snapshot_returns_repo_and_status_after_commit() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("b.txt", "beta\n");

    let snap = operations::panel_snapshot(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("panel_snapshot");
    let repo = snap.repo.expect("repo present");
    assert_eq!(repo.branch, "main");
    let status = snap.status.expect("status present");
    assert!(status.changed_files.iter().any(|f| f.path == "b.txt"));
}

#[test]
fn history_metadata_returns_branches_repo_and_status_from_one_authorized_root() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.run_git(&["branch", "feature"]);
    fx.write_file("b.txt", "beta\n");

    let metadata = operations::history_metadata(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("history_metadata");

    assert_eq!(metadata.repo.repo_root, fx.repo_str());
    assert_eq!(metadata.repo.branch, "main");
    assert_eq!(metadata.status.branch, "main");
    assert!(metadata
        .status
        .changed_files
        .iter()
        .any(|file| file.path == "b.txt"));
    assert!(metadata
        .branches
        .iter()
        .any(|branch| branch.name == "feature"));
}

#[test]
fn panel_snapshot_outside_repo_is_empty() {
    if skip_if_no_git() {
        return;
    }
    let tmp = TempDir::new().unwrap();
    let canonical = std::fs::canonicalize(tmp.path()).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(&canonical).unwrap();

    let snap = operations::panel_snapshot(&registry, &to_canon(&canonical), &WorkspaceEnv::Local)
        .expect("panel_snapshot");
    assert!(snap.repo.is_none());
    assert!(snap.status.is_none());
}

#[test]
fn show_commit_diff_returns_patch_for_known_sha() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let sha = &entries[0].sha;

    let diff = operations::show_commit_diff(&fx.registry, &fx.repo_str(), sha, &fx.workspace)
        .expect("show_commit_diff");
    assert!(diff.diff_text.contains("a.txt"));
    assert!(diff.diff_text.contains("+alpha"));
}

#[test]
fn show_commit_diff_rejects_invalid_sha() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    match operations::show_commit_diff(&fx.registry, &fx.repo_str(), "not-a-sha", &fx.workspace) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for invalid sha"),
    }
}

#[test]
fn revert_commit_creates_new_commit_and_restores_content() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add a"]);

    fx.write_file("a.txt", "alpha\nbeta\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add beta line"]);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let beta_sha = &entries[0].sha;

    let new_sha = operations::revert_commit(&fx.registry, &fx.repo_str(), beta_sha, &fx.workspace)
        .expect("revert_commit");
    assert_eq!(new_sha.len(), 40);
    assert_ne!(&new_sha, beta_sha);

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "alpha\n");

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].sha, new_sha);
}

#[test]
fn revert_commit_rejects_invalid_sha() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    match operations::revert_commit(&fx.registry, &fx.repo_str(), "not-a-sha", &fx.workspace) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for invalid sha"),
    }
}

#[test]
fn revert_commit_leaves_conflict_in_progress_for_resolution() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "X\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "c1"]);

    fx.write_file("a.txt", "Y\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "c2"]);

    fx.write_file("a.txt", "Z\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "c3"]);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let c2_sha = &entries[1].sha;

    let result = operations::revert_commit(&fx.registry, &fx.repo_str(), c2_sha, &fx.workspace);
    assert!(result.is_err(), "expected a conflicting revert to fail");

    // Left in progress, not auto-aborted: a real conflict-resolution UI can
    // now take over instead of the repo just snapping back to normal.
    assert!(fx.repo_path.join(".git/REVERT_HEAD").exists());
    let status = operations::operation_status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(status.kind, "revert");
    let snapshot = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert!(snapshot.changed_files.iter().any(|f| f.conflicted));

    // Resolve to something that actually differs from HEAD ("Z"), or the
    // completion commit would have nothing to record.
    fx.write_file("a.txt", "Z-resolved\n");
    fx.run_git(&["add", "a.txt"]);
    operations::operation_continue(&fx.registry, &fx.repo_str(), "revert", &fx.workspace)
        .expect("operation_continue");

    let status = operations::operation_status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(status.kind, "none");
    assert!(!fx.repo_path.join(".git/REVERT_HEAD").exists());
    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    assert_eq!(entries.len(), 4, "the completed revert adds a new commit");
}

#[test]
fn revert_commit_conflict_can_be_aborted_instead() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "X\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "c1"]);
    fx.write_file("a.txt", "Y\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "c2"]);
    fx.write_file("a.txt", "Z\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "c3"]);
    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let c2_sha = &entries[1].sha;
    operations::revert_commit(&fx.registry, &fx.repo_str(), c2_sha, &fx.workspace).unwrap_err();

    operations::operation_abort(&fx.registry, &fx.repo_str(), "revert", &fx.workspace)
        .expect("operation_abort");

    assert!(!fx.repo_path.join(".git/REVERT_HEAD").exists());
    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "Z\n", "abort restores the pre-revert content");
    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    assert_eq!(entries.len(), 3, "abort must not add a commit");
}

#[test]
fn operation_status_is_none_outside_any_sequencer_operation() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    let status = operations::operation_status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(status.kind, "none");
}

#[test]
fn operation_status_detects_merge_conflict_and_continue_completes_it() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "base\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "base"]);
    fx.run_git(&["checkout", "-q", "-b", "feature"]);
    fx.write_file("a.txt", "feature change\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "feature change"]);
    fx.run_git(&["checkout", "-q", "main"]);
    fx.write_file("a.txt", "main change\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "main change"]);

    // Deliberately not fx.run_git: that helper asserts success, but this
    // merge is *expected* to conflict. Merge itself is out of Voktty's own
    // command surface for now — only operation_status/abort/continue react
    // to it once it exists (e.g. from a merge started in a real terminal).
    let merge_output = std::process::Command::new("git")
        .args(["merge", "feature", "-q", "-m", "merge attempt"])
        .current_dir(&fx.repo_path)
        .output()
        .expect("run git merge");
    assert!(
        !merge_output.status.success(),
        "expected the merge to conflict"
    );

    let status = operations::operation_status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(status.kind, "merge");
    let snapshot = operations::status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert!(snapshot.changed_files.iter().any(|f| f.conflicted));

    fx.write_file("a.txt", "resolved\n");
    fx.run_git(&["add", "a.txt"]);
    operations::operation_continue(&fx.registry, &fx.repo_str(), "merge", &fx.workspace)
        .expect("operation_continue");

    let status = operations::operation_status(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(status.kind, "none");
    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "resolved\n");
}

#[test]
fn operation_abort_rejects_unknown_kind() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    match operations::operation_abort(&fx.registry, &fx.repo_str(), "bogus", &fx.workspace) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for unknown operation kind"),
    }
}

#[test]
fn log_paginates_with_before_sha_cursor() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    for i in 0..3 {
        fx.write_file(&format!("f{i}.txt"), &format!("v{i}\n"));
        fx.run_git(&["add", &format!("f{i}.txt")]);
        fx.run_git(&["commit", "-q", "-m", &format!("c{i}")]);
    }

    let first_page = operations::log(&fx.registry, &fx.repo_str(), 1, None, &fx.workspace).unwrap();
    assert_eq!(first_page.len(), 1);
    let cursor = first_page[0].sha.clone();

    let second_page = operations::log(
        &fx.registry,
        &fx.repo_str(),
        10,
        Some(&cursor),
        &fx.workspace,
    )
    .unwrap();
    assert!(second_page.iter().all(|e| e.sha != cursor));
    assert_eq!(second_page.len(), 2);
}

#[test]
fn log_with_invalid_cursor_sha_errors() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "x\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    match operations::log(
        &fx.registry,
        &fx.repo_str(),
        10,
        Some("not-hex"),
        &fx.workspace,
    ) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for bad cursor"),
    }
}

#[test]
fn commit_files_reports_added_and_modified() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.write_file("b.txt", "beta\n");
    fx.run_git(&["add", "a.txt", "b.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("a.txt", "alpha2\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "modify"]);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let head = &entries[0].sha;

    let files =
        operations::commit_files(&fx.registry, &fx.repo_str(), head, &fx.workspace).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "a.txt");
    assert_eq!(files[0].status, "M");
    assert_eq!(files[0].status_label, "Modified");
}

#[test]
fn commit_file_diff_returns_original_and_modified_text() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "v1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "v1"]);
    fx.write_file("a.txt", "v2\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "v2"]);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let head = &entries[0].sha;

    let diff = operations::commit_file_diff(
        &fx.registry,
        &fx.repo_str(),
        head,
        "a.txt",
        None,
        &fx.workspace,
    )
    .unwrap();
    assert_eq!(diff.original_content, "v1\n");
    assert_eq!(diff.modified_content, "v2\n");
    assert!(!diff.is_binary);
}

#[test]
fn remote_url_returns_none_for_missing_remote() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let url =
        operations::remote_url(&fx.registry, &fx.repo_str(), "origin", &fx.workspace).unwrap();
    assert!(url.is_none());
}

#[test]
fn remote_url_returns_configured_url() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.run_git(&["remote", "add", "origin", "https://example.com/x.git"]);

    let url =
        operations::remote_url(&fx.registry, &fx.repo_str(), "origin", &fx.workspace).unwrap();
    assert_eq!(url.as_deref(), Some("https://example.com/x.git"));
}

#[test]
fn remote_url_rejects_unsafe_remote_name() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    let url = operations::remote_url(
        &fx.registry,
        &fx.repo_str(),
        "name with space",
        &fx.workspace,
    )
    .unwrap();
    assert!(url.is_none());
}

#[test]
fn unauthorized_path_is_rejected() {
    if skip_if_no_git() {
        return;
    }
    let tmp = TempDir::new().unwrap();
    let canonical = std::fs::canonicalize(tmp.path()).unwrap();
    let registry = WorkspaceRegistry::default();

    match operations::status(&registry, &to_canon(&canonical), &WorkspaceEnv::Local) {
        Err(GitError::PathOutsideWorkspace(_)) => {}
        Err(other) => panic!("expected PathOutsideWorkspace, got {other}"),
        Ok(_) => panic!("expected error for unauthorized dir"),
    }
}

#[test]
fn checkout_branch_rejects_unsafe_names() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();

    let err_empty =
        operations::checkout_branch(&fx.registry, &fx.repo_str(), "", &fx.workspace).unwrap_err();
    assert!(matches!(err_empty, GitError::InvalidPath(p) if p.is_empty()));

    let err_dash =
        operations::checkout_branch(&fx.registry, &fx.repo_str(), "-f", &fx.workspace).unwrap_err();
    assert!(matches!(err_dash, GitError::InvalidPath(p) if p == "-f"));

    let err_dash_long =
        operations::checkout_branch(&fx.registry, &fx.repo_str(), "--detach", &fx.workspace)
            .unwrap_err();
    assert!(matches!(err_dash_long, GitError::InvalidPath(p) if p == "--detach"));
}

#[test]
fn list_branches_keeps_current_branch_local_and_surfaces_worktrees() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "a\n");
    fx.run_git(&["add", "."]);
    fx.run_git(&["commit", "-q", "-m", "init"]);
    fx.run_git(&["branch", "feature"]);

    let wt = TempDir::new().unwrap();
    let wt_path = wt.path().join("linked");
    fx.run_git(&[
        "worktree",
        "add",
        "-q",
        wt_path.to_str().unwrap(),
        "feature",
    ]);

    let result = operations::list_branches(&fx.registry, &fx.repo_str(), &fx.workspace)
        .expect("list_branches");

    // current branch stays local+head despite the main worktree being listed
    let main = result
        .branches
        .iter()
        .find(|b| b.name == "main")
        .expect("main branch present");
    assert_eq!(main.kind, "local");
    assert!(main.is_head);
    assert!(main.worktree_path.is_none());

    let feature: Vec<_> = result
        .branches
        .iter()
        .filter(|b| b.name == "feature")
        .collect();
    assert_eq!(feature.len(), 1);
    assert_eq!(feature[0].kind, "worktree");
    assert!(!feature[0].is_head);
    assert!(feature[0].worktree_path.is_some());
}

#[test]
fn stash_save_lists_entry_and_restores_worktree() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("a.txt", "2\n");

    operations::stash_save(
        &fx.registry,
        &fx.repo_str(),
        Some("wip"),
        false,
        &fx.workspace,
    )
    .expect("stash_save");

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "1\n", "stash should restore the committed content");

    let entries = operations::stash_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].index, 0);
    assert!(entries[0].message.contains("wip"));
}

#[test]
fn stash_apply_restores_changes_and_keeps_stash() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("a.txt", "2\n");
    operations::stash_save(&fx.registry, &fx.repo_str(), None, false, &fx.workspace).unwrap();

    operations::stash_apply(&fx.registry, &fx.repo_str(), 0, &fx.workspace).expect("stash_apply");

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "2\n");
    let entries = operations::stash_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(entries.len(), 1, "apply must not remove the stash entry");
}

#[test]
fn stash_pop_restores_changes_and_removes_stash() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("a.txt", "2\n");
    operations::stash_save(&fx.registry, &fx.repo_str(), None, false, &fx.workspace).unwrap();

    operations::stash_pop(&fx.registry, &fx.repo_str(), 0, &fx.workspace).expect("stash_pop");

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "2\n");
    let entries = operations::stash_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert!(entries.is_empty(), "pop must remove the stash entry");
}

#[test]
fn stash_drop_removes_without_restoring_worktree() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("a.txt", "2\n");
    operations::stash_save(&fx.registry, &fx.repo_str(), None, false, &fx.workspace).unwrap();

    operations::stash_drop(&fx.registry, &fx.repo_str(), 0, &fx.workspace).expect("stash_drop");

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "1\n", "drop must not touch the worktree");
    let entries = operations::stash_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn stash_save_can_include_untracked_files() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    fx.write_file("untracked.txt", "new\n");

    operations::stash_save(&fx.registry, &fx.repo_str(), None, true, &fx.workspace)
        .expect("stash_save with untracked");

    assert!(!fx.repo_path.join("untracked.txt").exists());
    let entries = operations::stash_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(entries.len(), 1);
}

#[test]
fn tag_create_lightweight_points_at_commit() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let head = entries[0].sha.clone();

    operations::tag_create(
        &fx.registry,
        &fx.repo_str(),
        "v1",
        None,
        None,
        &fx.workspace,
    )
    .expect("tag_create");

    let tags = operations::tag_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "v1");
    assert_eq!(tags[0].sha, head);
    assert!(!tags[0].annotated);
    assert!(tags[0].message.is_none());
}

#[test]
fn tag_create_annotated_has_message_and_peeled_sha() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let head = entries[0].sha.clone();

    operations::tag_create(
        &fx.registry,
        &fx.repo_str(),
        "v2",
        None,
        Some("release notes"),
        &fx.workspace,
    )
    .expect("tag_create annotated");

    let tags = operations::tag_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert_eq!(tags.len(), 1);
    assert!(tags[0].annotated);
    assert_eq!(tags[0].message.as_deref(), Some("release notes"));
    assert_eq!(
        tags[0].sha, head,
        "sha must be the peeled commit, not the tag object"
    );
}

#[test]
fn tag_delete_removes_it() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);
    operations::tag_create(
        &fx.registry,
        &fx.repo_str(),
        "v1",
        None,
        None,
        &fx.workspace,
    )
    .unwrap();

    operations::tag_delete(&fx.registry, &fx.repo_str(), "v1", &fx.workspace).expect("tag_delete");

    let tags = operations::tag_list(&fx.registry, &fx.repo_str(), &fx.workspace).unwrap();
    assert!(tags.is_empty());
}

#[test]
fn tag_create_rejects_unsafe_names() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "1\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    match operations::tag_create(
        &fx.registry,
        &fx.repo_str(),
        "-x",
        None,
        None,
        &fx.workspace,
    ) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for unsafe tag name"),
    }

    match operations::tag_create(&fx.registry, &fx.repo_str(), "", None, None, &fx.workspace) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for empty tag name"),
    }
}

#[test]
fn blame_attributes_each_line_to_the_commit_that_introduced_it() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "line one\nline two\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "first commit"]);
    let first_sha = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap()
        [0]
    .sha
    .clone();

    fx.write_file("a.txt", "line one\nline two\nline three\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "second commit"]);
    let second_sha = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace)
        .unwrap()[0]
        .sha
        .clone();

    let lines =
        operations::blame(&fx.registry, &fx.repo_str(), "a.txt", &fx.workspace).expect("blame");
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0].sha, first_sha);
    assert_eq!(lines[0].content, "line one");
    assert_eq!(lines[0].summary, "first commit");
    assert_eq!(lines[1].sha, first_sha);
    assert_eq!(lines[2].sha, second_sha);
    assert_eq!(lines[2].content, "line three");
    assert_eq!(lines[2].summary, "second commit");
    assert_eq!(lines[2].line_number, 3);
}

#[test]
fn blame_rejects_path_outside_the_repository() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "x\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    assert!(operations::blame(
        &fx.registry,
        &fx.repo_str(),
        "../outside.txt",
        &fx.workspace
    )
    .is_err());
}

#[test]
fn compare_branches_reports_ahead_behind_and_files_relative_to_merge_base() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("base.txt", "base\n");
    fx.run_git(&["add", "base.txt"]);
    fx.run_git(&["commit", "-q", "-m", "common ancestor"]);

    fx.run_git(&["checkout", "-q", "-b", "feature"]);
    fx.write_file("feature.txt", "feature\n");
    fx.run_git(&["add", "feature.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add feature file"]);
    let feature_sha = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace)
        .unwrap()[0]
        .sha
        .clone();

    fx.run_git(&["checkout", "-q", "main"]);
    fx.write_file("main-only.txt", "main only\n");
    fx.run_git(&["add", "main-only.txt"]);
    fx.run_git(&["commit", "-q", "-m", "advance main"]);
    let main_sha = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap()
        [0]
    .sha
    .clone();

    let comparison = operations::compare_branches(
        &fx.registry,
        &fx.repo_str(),
        "main",
        "feature",
        &fx.workspace,
    )
    .expect("compare_branches");

    assert_eq!(comparison.ahead.len(), 1);
    assert_eq!(comparison.ahead[0].sha, feature_sha);
    assert_eq!(comparison.behind.len(), 1);
    assert_eq!(comparison.behind[0].sha, main_sha);

    // Three-dot semantics: only feature's own change vs. the merge base,
    // not main's unrelated "advance main" commit.
    assert_eq!(comparison.files.len(), 1);
    assert_eq!(comparison.files[0].path, "feature.txt");
    assert_eq!(comparison.files[0].status, "A");
}

#[test]
fn compare_branches_rejects_unsafe_ref_names() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "x\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "seed"]);

    match operations::compare_branches(&fx.registry, &fx.repo_str(), "-x", "main", &fx.workspace) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for unsafe base ref"),
    }
    match operations::compare_branches(&fx.registry, &fx.repo_str(), "main", "", &fx.workspace) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for empty compare ref"),
    }
}

#[test]
fn branch_from_commit_starts_at_that_commit_and_checks_it_out() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add a"]);

    fx.write_file("a.txt", "alpha\nbeta\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add beta line"]);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let first_sha = entries[1].sha.clone();

    operations::branch_from_commit(
        &fx.registry,
        &fx.repo_str(),
        "from-first",
        &first_sha,
        &fx.workspace,
    )
    .expect("branch_from_commit");

    let resolved = operations::resolve_repo(&fx.registry, &fx.repo_str(), &fx.workspace)
        .unwrap()
        .expect("repo");
    assert_eq!(resolved.branch, "from-first");

    let content = std::fs::read_to_string(fx.repo_path.join("a.txt")).unwrap();
    assert_eq!(content, "alpha\n");
}

#[test]
fn branch_from_commit_rejects_an_unsafe_name() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add a"]);

    let entries = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap();
    let sha = entries[0].sha.clone();

    for name in ["--track", "a..b", "has space", ""] {
        match operations::branch_from_commit(
            &fx.registry,
            &fx.repo_str(),
            name,
            &sha,
            &fx.workspace,
        ) {
            Err(GitError::CommandFailed { .. }) => {}
            Err(other) => panic!("expected CommandFailed for {name:?}, got {other}"),
            Ok(()) => panic!("expected error for branch name {name:?}"),
        }
    }
}

#[test]
fn cherry_pick_commit_applies_the_change_onto_the_current_branch() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    fx.write_file("a.txt", "alpha\n");
    fx.run_git(&["add", "a.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add a"]);
    let base = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap()[0]
        .sha
        .clone();

    // A commit that only exists on a side branch.
    fx.run_git(&["checkout", "-q", "-b", "side"]);
    fx.write_file("b.txt", "beta\n");
    fx.run_git(&["add", "b.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add b"]);
    let side_sha = operations::log(&fx.registry, &fx.repo_str(), 10, None, &fx.workspace).unwrap()
        [0]
    .sha
    .clone();

    operations::branch_from_commit(&fx.registry, &fx.repo_str(), "target", &base, &fx.workspace)
        .unwrap();
    assert!(!fx.repo_path.join("b.txt").exists());

    // Diverge target from base so the cherry-picked commit gets a different
    // parent (and tree) than the original: otherwise, when target's HEAD is
    // an unmodified `base`, cherry-picking `side`'s commit reproduces the
    // exact same tree/parent/message/author as `side_sha`, and on a fast
    // CI runner the author/committer timestamps (1s git granularity) can
    // coincide too, making the two commits byte-identical objects with the
    // same hash. Committing a change on target first guarantees a distinct
    // parent regardless of timing.
    fx.write_file("c.txt", "gamma\n");
    fx.run_git(&["add", "c.txt"]);
    fx.run_git(&["commit", "-q", "-m", "add c on target"]);

    let new_sha =
        operations::cherry_pick_commit(&fx.registry, &fx.repo_str(), &side_sha, &fx.workspace)
            .expect("cherry_pick_commit");
    assert_eq!(new_sha.len(), 40);
    assert_ne!(new_sha, side_sha);

    let content = std::fs::read_to_string(fx.repo_path.join("b.txt")).unwrap();
    assert_eq!(content, "beta\n");
}

#[test]
fn cherry_pick_commit_rejects_invalid_sha() {
    if skip_if_no_git() {
        return;
    }
    let fx = GitRepoFixture::new();
    match operations::cherry_pick_commit(&fx.registry, &fx.repo_str(), "not-a-sha", &fx.workspace) {
        Err(GitError::CommandFailed { .. }) => {}
        Err(other) => panic!("expected CommandFailed, got {other}"),
        Ok(_) => panic!("expected error for invalid sha"),
    }
}
