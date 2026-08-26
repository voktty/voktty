import { requestRemoteResult } from "@/modules/remote";
import type { WorkspaceEnv } from "@/modules/workspace";
import type {
  WorkspaceReplaceOutcome,
  WorkspaceReplacePreview,
  WorkspaceReplaceSpec,
  WorkspaceReplaceTarget,
  WorkspaceSearchRequest,
  WorkspaceSearchResponse,
} from "@/modules/workspace-search/types";
import { invoke } from "@tauri-apps/api/core";

const REMOTE_GREP = "fs.grep";
const REMOTE_GREP_CANCEL = "fs.grepCancel";
const REMOTE_REPLACE_PREVIEW = "fs.replacePreview";
const REMOTE_REPLACE_APPLY = "fs.replaceApply";

type NativeWorkspaceSearchResponse = {
  hits: Array<{
    path: string;
    rel: string;
    line: number;
    column: number;
    match_length: number;
    preview_column: number;
    text: string;
  }>;
  truncated: boolean;
  files_scanned: number;
};

export function normalizeWorkspaceSearchResponse(
  response: NativeWorkspaceSearchResponse,
): WorkspaceSearchResponse {
  return {
    hits: response.hits.map((hit) => ({
      path: hit.path,
      rel: hit.rel,
      line: hit.line,
      column: hit.column,
      matchLength: hit.match_length,
      previewColumn: hit.preview_column,
      text: hit.text,
    })),
    truncated: response.truncated,
    filesScanned: response.files_scanned,
  };
}

export async function searchWorkspace(
  request: WorkspaceSearchRequest,
): Promise<WorkspaceSearchResponse> {
  const response =
    request.workspace.kind === "ssh"
      ? await requestRemoteResult<NativeWorkspaceSearchResponse>(
          requireRemoteSession(request.workspace),
          REMOTE_GREP,
          {
            pattern: request.pattern,
            include: request.include,
            exclude: request.exclude,
            caseSensitive: request.caseSensitive,
            regex: request.regex,
            wholeWord: request.wholeWord,
            showHidden: request.showHidden,
            maxResults: request.maxResults,
          },
        )
      : await invoke<NativeWorkspaceSearchResponse>("fs_grep_workspace", {
          ...request,
        });
  return normalizeWorkspaceSearchResponse(response);
}

export async function cancelWorkspaceSearch(
  workspace: WorkspaceEnv,
): Promise<void> {
  if (workspace.kind === "ssh") {
    if (workspace.sessionId === undefined) return;
    await requestRemoteResult(workspace.sessionId, REMOTE_GREP_CANCEL);
    return;
  }
  if (workspace.kind === "local" || workspace.kind === "wsl") {
    await invoke("fs_grep_workspace_cancel");
  }
}

export async function previewWorkspaceReplace(
  root: string,
  workspace: WorkspaceEnv,
  spec: WorkspaceReplaceSpec,
  paths: string[],
): Promise<WorkspaceReplacePreview> {
  if (workspace.kind === "ssh") {
    return requestRemoteResult<WorkspaceReplacePreview>(
      requireRemoteSession(workspace),
      REMOTE_REPLACE_PREVIEW,
      { spec, paths },
    );
  }
  return invoke<WorkspaceReplacePreview>("fs_replace_preview", {
    root,
    workspace,
    spec,
    paths,
  });
}

export async function applyWorkspaceReplace(
  root: string,
  workspace: WorkspaceEnv,
  spec: WorkspaceReplaceSpec,
  targets: WorkspaceReplaceTarget[],
): Promise<WorkspaceReplaceOutcome> {
  if (workspace.kind === "ssh") {
    return requestRemoteResult<WorkspaceReplaceOutcome>(
      requireRemoteSession(workspace),
      REMOTE_REPLACE_APPLY,
      { spec, targets },
    );
  }
  return invoke<WorkspaceReplaceOutcome>("fs_replace_apply", {
    root,
    workspace,
    spec,
    targets,
  });
}

function requireRemoteSession(
  workspace: Extract<WorkspaceEnv, { kind: "ssh" }>,
): number {
  if (workspace.sessionId === undefined) {
    throw new Error("remote workspace is not connected");
  }
  return workspace.sessionId;
}
