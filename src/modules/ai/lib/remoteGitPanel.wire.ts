import { invokeWorkspace } from "@/modules/harness/lib/fs";
import { createRemoteGitPanel } from "./remoteGitPanel";

/** Source Control for a project on an SSH host: every call goes to the host's
 * Git through the shared helper session instead of the local Git commands. */
export const remoteGitPanel = createRemoteGitPanel({
  index: (cwd) => invokeWorkspace("git_diff_index", { cwd }),
  fileDiff: (cwd, relative, staged) =>
    invokeWorkspace("git_file_diff", { cwd, relative, staged }),
  patch: (cwd, relative, staged) =>
    invokeWorkspace("git_patch", { cwd, relative, staged }),
  stage: (cwd, relative) => invokeWorkspace("git_stage_file", { cwd, relative }),
  unstage: (cwd, relative) =>
    invokeWorkspace("git_unstage_file", { cwd, relative }),
  discard: (cwd, relative) =>
    invokeWorkspace("git_discard_file", { cwd, relative }),
  stageContents: (cwd, relative, contents) =>
    invokeWorkspace("git_stage_contents", { cwd, relative, contents }),
  init: (cwd) => invokeWorkspace("git_init", { cwd }),
});
