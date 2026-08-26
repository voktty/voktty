export type OperationEntry = {
  id: string;
  kind: "write_file" | "edit" | "multi_edit" | "create_directory";
  path: string;
  originalContent: string;
  proposedContent: string;
  isNewFile: boolean;
  description?: string;
};

export type OperationInspection =
  | { kind: "file"; content: string }
  | { kind: "directory"; empty: boolean }
  | null;

export type OperationAdapter = {
  inspect: (path: string) => Promise<OperationInspection>;
  writeFile: (
    path: string,
    content: string,
    expectedContent: string | null,
  ) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  removeFile: (path: string, expectedContent: string) => Promise<void>;
  removeEmptyDirectory: (path: string) => Promise<void>;
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

export function validateOperationEntries(
  entries: readonly OperationEntry[],
): string | null {
  if (entries.length === 0) return "operation has no changes";
  if (entries.length > OPERATION_LIMITS.files)
    return "operation exceeds file limit";
  const paths = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    if (paths.has(entry.path))
      return `operation contains duplicate path: ${entry.path}`;
    paths.add(entry.path);
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
    const current = await adapter.inspect(entry.path);
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
    await adapter.removeEmptyDirectory(entry.path);
  } else if (entry.isNewFile) {
    await adapter.removeFile(entry.path, entry.proposedContent);
  } else {
    await adapter.writeFile(
      entry.path,
      entry.originalContent,
      entry.proposedContent,
    );
  }
}

async function redoEntry(
  entry: OperationEntry,
  adapter: OperationAdapter,
): Promise<void> {
  if (entry.kind === "create_directory")
    await adapter.createDirectory(entry.path);
  else {
    await adapter.writeFile(
      entry.path,
      entry.proposedContent,
      entry.isNewFile ? null : entry.originalContent,
    );
  }
}

export async function applyOperation(
  entries: readonly OperationEntry[],
  adapter: OperationAdapter,
): Promise<OperationResult> {
  const validation = validateOperationEntries(entries);
  if (validation) return { ok: false, error: validation };
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
  try {
    for (const entry of operation.entries) {
      const current = await adapter.inspect(entry.path);
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
