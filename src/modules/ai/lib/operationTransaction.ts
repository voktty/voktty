import type { WorkspaceEnv } from "@/modules/workspace";

export type OperationEntry = {
  id: string;
  kind: "write_file" | "edit" | "multi_edit" | "create_directory";
  path: string;
  originalContent: string;
  proposedContent: string;
  isNewFile: boolean;
  description?: string;
  workspaceEnv?: WorkspaceEnv;
};

export type OperationInspection =
  | { kind: "file"; content: string }
  | { kind: "directory"; empty: boolean }
  | null;

export type OperationAdapter = {
  inspect: (
    path: string,
    workspace?: WorkspaceEnv,
  ) => Promise<OperationInspection>;
  writeFile: (
    path: string,
    content: string,
    expectedContent: string | null,
    workspace?: WorkspaceEnv,
  ) => Promise<void>;
  createDirectory: (path: string, workspace?: WorkspaceEnv) => Promise<void>;
  removeFile: (
    path: string,
    expectedContent: string,
    workspace?: WorkspaceEnv,
  ) => Promise<void>;
  removeEmptyDirectory: (
    path: string,
    workspace?: WorkspaceEnv,
  ) => Promise<void>;
};

export type AppliedOperation = {
  entries: OperationEntry[];
  appliedAt: number;
};

export type OperationResult =
  | { ok: true; operation: AppliedOperation }
  | { ok: false; error: string; rollbackErrors?: string[] };

export const OPERATION_LIMITS = {
  files: 50,
  fileBytes: 4 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
} as const;

function operationPathKey(entry: OperationEntry): string {
  const native = /^[a-zA-Z]:[/\\]|^[/\\]{2}/.test(entry.path);
  const path = native
    ? entry.path.replace(/\\/g, "/").toLowerCase()
    : entry.path;
  const workspace = entry.workspaceEnv;
  const scope =
    native || !workspace || workspace.kind === "local"
      ? ["local"]
      : workspace.kind === "wsl"
        ? ["wsl", workspace.distro]
        : workspace.kind === "ssh"
          ? [
              "ssh",
              workspace.connection.host,
              workspace.connection.user ?? "",
              workspace.connection.port ?? 22,
              workspace.connection.identityFile ?? "",
              workspace.connection.extraArgs ?? "",
            ]
          : workspace;
  return JSON.stringify([scope, path]);
}

function snapshotEntries(entries: readonly OperationEntry[]): OperationEntry[] {
  return entries.map((entry) => ({
    ...entry,
    ...(entry.workspaceEnv
      ? { workspaceEnv: structuredClone(entry.workspaceEnv) }
      : {}),
  }));
}

export function validateOperationEntries(
  entries: readonly OperationEntry[],
): string | null {
  if (entries.length === 0) return "operation has no changes";
  if (entries.length > OPERATION_LIMITS.files)
    return "operation exceeds file limit";
  const paths = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const key = operationPathKey(entry);
    if (paths.has(key))
      return `operation contains duplicate path: ${entry.path}`;
    paths.add(key);
    const size = new TextEncoder().encode(entry.proposedContent).length;
    if (size > OPERATION_LIMITS.fileBytes)
      return `file exceeds operation limit: ${entry.path}`;
    total += size;
  }
  return total > OPERATION_LIMITS.totalBytes
    ? "operation exceeds total size limit"
    : null;
}

async function preflightApply(
  entries: readonly OperationEntry[],
  adapter: OperationAdapter,
): Promise<string | null> {
  for (const entry of entries) {
    const current = await adapter.inspect(entry.path, entry.workspaceEnv);
    if (entry.kind === "create_directory" || entry.isNewFile) {
      if (current !== null) return `path already exists: ${entry.path}`;
    } else if (
      current?.kind !== "file" ||
      current.content !== entry.originalContent
    ) {
      return `file changed since review: ${entry.path}`;
    }
  }
  return null;
}

async function undoEntry(
  entry: OperationEntry,
  adapter: OperationAdapter,
): Promise<void> {
  if (entry.kind === "create_directory") {
    await adapter.removeEmptyDirectory(entry.path, entry.workspaceEnv);
  } else if (entry.isNewFile) {
    await adapter.removeFile(
      entry.path,
      entry.proposedContent,
      entry.workspaceEnv,
    );
  } else {
    await adapter.writeFile(
      entry.path,
      entry.originalContent,
      entry.proposedContent,
      entry.workspaceEnv,
    );
  }
}

async function redoEntry(
  entry: OperationEntry,
  adapter: OperationAdapter,
): Promise<void> {
  if (entry.kind === "create_directory")
    await adapter.createDirectory(entry.path, entry.workspaceEnv);
  else {
    await adapter.writeFile(
      entry.path,
      entry.proposedContent,
      entry.isNewFile ? null : entry.originalContent,
      entry.workspaceEnv,
    );
  }
}

export async function applyOperation(
  entries: readonly OperationEntry[],
  adapter: OperationAdapter,
): Promise<OperationResult> {
  const validation = validateOperationEntries(entries);
  if (validation) return { ok: false, error: validation };
  entries = snapshotEntries(entries);
  try {
    const conflict = await preflightApply(entries, adapter);
    if (conflict) return { ok: false, error: conflict };
  } catch (error) {
    return { ok: false, error: `preflight failed: ${String(error)}` };
  }

  const applied: OperationEntry[] = [];
  try {
    for (const entry of entries) {
      await redoEntry(entry, adapter);
      applied.push(entry);
    }
    return {
      ok: true,
      operation: {
        entries: entries.map((entry) => ({ ...entry })),
        appliedAt: Date.now(),
      },
    };
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const entry of applied.reverse()) {
      try {
        await undoEntry(entry, adapter);
      } catch (rollbackError) {
        rollbackErrors.push(`${entry.path}: ${String(rollbackError)}`);
      }
    }
    return {
      ok: false,
      error: `apply failed: ${String(error)}`,
      ...(rollbackErrors.length > 0 ? { rollbackErrors } : {}),
    };
  }
}

export async function revertOperation(
  operation: AppliedOperation,
  adapter: OperationAdapter,
): Promise<OperationResult> {
  const validation = validateOperationEntries(operation.entries);
  if (validation) return { ok: false, error: validation };
  operation = { ...operation, entries: snapshotEntries(operation.entries) };
  try {
    for (const entry of operation.entries) {
      const current = await adapter.inspect(entry.path, entry.workspaceEnv);
      if (entry.kind === "create_directory") {
        if (current?.kind !== "directory" || !current.empty) {
          return {
            ok: false,
            error: `directory changed since apply: ${entry.path}`,
          };
        }
      } else if (
        current?.kind !== "file" ||
        current.content !== entry.proposedContent
      ) {
        return { ok: false, error: `file changed since apply: ${entry.path}` };
      }
    }
  } catch (error) {
    return { ok: false, error: `revert preflight failed: ${String(error)}` };
  }

  const reverted: OperationEntry[] = [];
  try {
    for (const entry of [...operation.entries].reverse()) {
      await undoEntry(entry, adapter);
      reverted.push(entry);
    }
    return { ok: true, operation };
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const entry of reverted.reverse()) {
      try {
        await redoEntry(entry, adapter);
      } catch (rollbackError) {
        rollbackErrors.push(`${entry.path}: ${String(rollbackError)}`);
      }
    }
    return {
      ok: false,
      error: `revert failed: ${String(error)}`,
      ...(rollbackErrors.length > 0 ? { rollbackErrors } : {}),
    };
  }
}
