const stages = new Set([
  "application-parent",
  "private-directory",
  "preferences",
  "windows-token",
  "windows-directory-open",
  "windows-security-query",
  "windows-owner",
  "windows-acl",
  "windows-grant",
]);

export function parseMemoryStorageDiagnostic(
  error: unknown,
): { stage: string; windowsError: number | null } | undefined {
  if (!error || typeof error !== "object" || !("storage" in error)) return;
  const storage = error.storage;
  if (
    !storage ||
    typeof storage !== "object" ||
    !("stage" in storage) ||
    typeof storage.stage !== "string" ||
    !stages.has(storage.stage)
  )
    return;
  const code = "windowsError" in storage ? storage.windowsError : null;
  if (code === null || code === undefined)
    return { stage: storage.stage, windowsError: null };
  if (
    typeof code !== "number" ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 0xffffffff
  )
    return;
  return { stage: storage.stage, windowsError: code };
}

export function memoryStorageDiagnostic(error: unknown): string | undefined {
  const diagnostic = parseMemoryStorageDiagnostic(error);
  if (!diagnostic) return;
  return diagnostic.windowsError === null
    ? diagnostic.stage
    : `${diagnostic.stage}:${diagnostic.windowsError}`;
}
