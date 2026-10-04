import { readTextFile, writeTextFile } from "./fs";

export class EditorSaveConflictError extends Error {}

export function diskContentChanged(
  current: string,
  saved: string | null,
): boolean {
  return saved !== null && current !== saved;
}

export async function saveEditorFile(
  path: string,
  content: string,
  expectedContent: string,
): Promise<void> {
  const remote = path.startsWith("remote://");
  if (remote) {
    const current = await readTextFile(path);
    if (diskContentChanged(current, expectedContent)) {
      throw new EditorSaveConflictError("File changed on disk");
    }
  }
  try {
    await writeTextFile(path, content, remote ? undefined : expectedContent);
  } catch (error) {
    if (String(error).includes("File changed on disk")) {
      throw new EditorSaveConflictError("File changed on disk");
    }
    throw error;
  }
}
