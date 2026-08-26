import { requestRemoteResult } from "@/modules/remote";
import { workspaceRelativePath } from "@/modules/quick-open";
import type { WorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceTextDocumentEdit,
  WorkspaceTextEditFilePreview,
  WorkspaceTextEditOutcome,
  WorkspaceTextEditPreview,
  WorkspaceTextEditTarget,
} from "../types";

const REMOTE_WORKSPACE_EDIT_PREVIEW = "fs.workspaceEditPreview";
const REMOTE_WORKSPACE_EDIT_APPLY = "fs.workspaceEditApply";

export async function previewWorkspaceTextEdit(
  root: string,
  workspace: WorkspaceEnv,
  documents: WorkspaceTextDocumentEdit[],
): Promise<WorkspaceTextEditPreview> {
  if (workspace.kind === "ssh") {
    return requestRemoteResult<WorkspaceTextEditPreview>(
      requireRemoteSession(workspace),
      REMOTE_WORKSPACE_EDIT_PREVIEW,
      { documents },
    );
  }
  return invoke<WorkspaceTextEditPreview>("fs_workspace_edit_preview", {
    root,
    workspace,
    documents,
  });
}

export async function applyWorkspaceTextEdit(
  root: string,
  workspace: WorkspaceEnv,
  targets: WorkspaceTextEditTarget[],
): Promise<WorkspaceTextEditOutcome> {
  if (workspace.kind === "ssh") {
    return requestRemoteResult<WorkspaceTextEditOutcome>(
      requireRemoteSession(workspace),
      REMOTE_WORKSPACE_EDIT_APPLY,
      { targets },
    );
  }
  return invoke<WorkspaceTextEditOutcome>("fs_workspace_edit_apply", {
    root,
    workspace,
    targets,
  });
}

export function workspaceTextEditTargets(
  previews: WorkspaceTextEditFilePreview[],
  documents: WorkspaceTextDocumentEdit[],
  selectedPaths: ReadonlySet<string>,
): WorkspaceTextEditTarget[] {
  const editsByPath = new Map(
    documents.map((document) => [document.path, document.edits]),
  );
  return previews.flatMap((preview) => {
    if (!selectedPaths.has(preview.path)) return [];
    const edits = editsByPath.get(preview.path);
    if (!edits || edits.length !== preview.edits) return [];
    return [
      {
        path: preview.path,
        edits,
        expectedMtime: preview.mtime,
        expectedHash: preview.hash,
        expectedResultHash: preview.resultHash,
        expectedEdits: preview.edits,
      },
    ];
  });
}

export function dirtyWorkspaceTextEditPaths(
  root: string,
  documents: WorkspaceTextDocumentEdit[],
  dirtyPaths: string[],
): string[] {
  const requested = new Set(documents.map((document) => document.path));
  return dirtyPaths.flatMap((path) => {
    const relative = workspaceRelativePath(root, path);
    return relative && requested.has(relative) ? [relative] : [];
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
