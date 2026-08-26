# Git change review

Voktty exposes working-tree changes in two coordinated surfaces:

- The Source Control sidebar owns repository-wide status, staging, commits and remote actions.
- A compact review queue appears on the right of each working-tree diff tab. It keeps the current file visible while the user navigates the remaining changes.

Both surfaces derive their rows from the same `GitStatusSnapshot.changedFiles` data and open the same `git-diff` editor tabs. The queue does not run a second status scanner or maintain a private repository model.

## Review actions

Selecting a row opens its unstaged diff when one exists, otherwise its staged diff. The primary action stages the current on-disk change, or unstages an already staged change. Discard is available only for unstaged content and always requires confirmation.

After an action, Voktty invalidates both staged and unstaged diff cache entries and refreshes repository status. Selection remains on the same path while that path still exists. If a discarded path disappears, the next surviving queue entry is opened. Rename metadata, deletes, untracked files and conflict status codes remain attached to the queue row; binary and oversized content continue through the existing patch fallback in `GitDiffPane`.

## Unsaved-buffer safety

Git actions operate on filesystem state, not on CodeMirror memory. Before any discard, both the sidebar and review queue compare the target path and rename source path with all dirty editor tabs. A match blocks the operation before Rust receives it. The check runs again after the confirmation dialog to close the race where a buffer becomes dirty while the dialog is open.

Staging a file with an unsaved editor is allowed because it does not destroy the in-memory buffer. Only the current on-disk version is staged.

## Trust boundary

React coordinates selection, confirmation and cache invalidation. Rust remains the only owner of Git process execution and workspace authorization through `git_stage`, `git_unstage`, `git_discard`, `git_status` and `git_diff_content`. Paths are always interpreted relative to the repository already authorized by the workspace registry.

Accepting Git's dubious-ownership exception writes only the explicit `safe.directory` value and does not canonicalize the repository a second time. The action resolves as soon as that configuration succeeds; status refresh continues independently so a slow SMB or mapped-network share cannot hold the trust control hostage. The first status pass uses Git's `--untracked-files=normal` directory-level enumeration instead of recursively materializing every untracked descendant. Tracked changes remain exact, and an untracked directory can still be staged as a path.

## Manual smoke

1. Modify two text files and one binary file in the same repository.
2. Open Source Control, select a file and confirm that its diff opens with the queue on the right.
3. Navigate between queue rows and verify the count and active row.
4. Stage and unstage a file from the queue.
5. Open another changed file in the editor, leave it unsaved and verify that discard is blocked from both Git surfaces.
6. Save it, discard with confirmation and verify that the queue advances without closing unrelated editor tabs.
