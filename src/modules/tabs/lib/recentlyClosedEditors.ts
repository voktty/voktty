import {
  documentWorkspaceKey,
  type WorkspaceEnv,
} from "@/modules/workspace";

export type ClosedEditor = {
  path: string;
  spaceId: string;
  overrideLanguage: string | null;
  workspaceEnv?: WorkspaceEnv;
};

function sameEditor(left: ClosedEditor, right: ClosedEditor): boolean {
  return (
    left.spaceId === right.spaceId &&
    documentWorkspaceKey(left.workspaceEnv, left.path) ===
      documentWorkspaceKey(right.workspaceEnv, right.path)
  );
}

export function pushClosedEditor(
  stack: ClosedEditor[],
  editor: ClosedEditor,
  limit = 20,
): ClosedEditor[] {
  const next = stack.filter((entry) => !sameEditor(entry, editor));
  next.push(editor);
  return next.slice(-Math.max(1, Math.trunc(limit)));
}

export function takeClosedEditor(stack: ClosedEditor[]): {
  stack: ClosedEditor[];
  editor: ClosedEditor | null;
} {
  if (stack.length === 0) return { stack, editor: null };
  return {
    stack: stack.slice(0, -1),
    editor: stack[stack.length - 1] ?? null,
  };
}
