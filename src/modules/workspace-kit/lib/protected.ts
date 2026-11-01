import manifest from "@/../templates/workspace-kit/manifest.json";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { scalarCompare } from "@/modules/workspace-kit/lib/preservation";
import { isUnicodeScalarText } from "@/modules/workspace-kit/lib/validation";

const encoder = new TextEncoder();
const fixedPaths = Object.freeze(
  [
    ...new Set([
      ...manifest.files
        .filter((entry) => entry.kind === "base" || entry.kind === "link")
        .map((entry) =>
          entry.source.startsWith("root/")
            ? entry.source.slice(5)
            : entry.source.replace(/^dot-voktty\//, ".voktty/"),
        ),
      ".voktty/kit.json",
      ".voktty/kit.lock.json",
      ".voktty/team/agents.json",
    ]),
  ].sort(scalarCompare),
);
const required = new Set(fixedPaths);

export type MemoryProtectedFile = Readonly<{
  path: string;
  kind: "file" | "absent";
  sha256: string | null;
  bytes: number | null;
}>;
export type MemoryProtectedSnapshot = Readonly<{
  schema: 1;
  files: readonly MemoryProtectedFile[];
}>;
export type MemoryProtectedComparison = Readonly<{
  changedFiles: readonly string[];
  addedFiles: readonly string[];
  removedFiles: readonly string[];
}>;

export function memoryProtectedPaths(): readonly string[] {
  return fixedPaths;
}

function extraPath(path: string): boolean {
  if (
    path.length > 4096 ||
    !isUnicodeScalarText(path) ||
    encoder.encode(path).length > 4096 ||
    /[\p{Cc}\\:%?#]/u.test(path)
  )
    return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    return false;
  if (
    parts.length === 4 &&
    parts.slice(0, 3).join("/") === ".voktty/team/roles"
  ) {
    return /^[a-z0-9-]+\.md$/.test(parts[3]);
  }
  if (parts.length === 3 && parts[0] === ".voktty") {
    if (parts[1] === "capture") return /^[a-z0-9-]+\.md$/.test(parts[2]);
    return (
      ["plans", "domains", "architecture", "rituals", "external"].includes(
        parts[1],
      ) && ["README.md", "_TEMPLATE.md"].includes(parts[2])
    );
  }
  return false;
}

export function isMemoryProtectedPath(path: string): boolean {
  return required.has(path) || extraPath(path);
}

/** Exact bytes and verified absence only, never parsing or instruction trust. */
export async function snapshotMemoryProtected(
  documents: ReadonlyMap<string, KitPathFact>,
  inventoryComplete: boolean,
): Promise<MemoryProtectedSnapshot> {
  if (!inventoryComplete) throw new Error("KIT_PROTECTED_INCOMPLETE");
  if (documents.size > 128) throw new Error("KIT_PROTECTED_FILE_LIMIT");
  if (fixedPaths.some((path) => !documents.has(path)))
    throw new Error("KIT_PROTECTED_INCOMPLETE");
  let total = 0;
  const captured = [...documents]
    .sort(([a], [b]) => scalarCompare(a, b))
    .map(([path, fact]) => {
      if (!required.has(path) && !extraPath(path))
        throw new Error("KIT_PROTECTED_PATH_INVALID");
      if (fact.kind === "blocked") throw new Error("KIT_PROTECTED_INCOMPLETE");
      if (fact.kind === "absent") return { path, bytes: null };
      if (fact.text.length > 256 * 1024)
        throw new Error("KIT_PROTECTED_BYTE_LIMIT");
      if (!isUnicodeScalarText(fact.text) || fact.text.includes("\0"))
        throw new Error("KIT_PROTECTED_TEXT_INVALID");
      const bytes = encoder.encode(fact.text);
      total += bytes.length;
      if (bytes.length > 256 * 1024 || total > 4 * 1024 * 1024)
        throw new Error("KIT_PROTECTED_BYTE_LIMIT");
      return { path, bytes };
    });
  const files = await Promise.all(
    captured.map(async ({ path, bytes }): Promise<MemoryProtectedFile> => {
      if (bytes === null)
        return Object.freeze({
          path,
          kind: "absent",
          sha256: null,
          bytes: null,
        });
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return Object.freeze({ path, kind: "file", sha256, bytes: bytes.length });
    }),
  );
  return Object.freeze({ schema: 1, files: Object.freeze(files) });
}

/** Every change is a diagnostic, never permission to compact or use instructions. */
export function compareMemoryProtected(
  before: MemoryProtectedSnapshot,
  after: MemoryProtectedSnapshot,
): MemoryProtectedComparison {
  const previous = new Map(
    before.files
      .filter((file) => file.kind === "file")
      .map((file) => [file.path, file]),
  );
  const current = new Map(
    after.files
      .filter((file) => file.kind === "file")
      .map((file) => [file.path, file]),
  );
  const changedFiles: string[] = [],
    removedFiles: string[] = [];
  for (const [path, file] of previous) {
    const now = current.get(path);
    if (!now) removedFiles.push(path);
    else if (file.sha256 !== now.sha256 || file.bytes !== now.bytes)
      changedFiles.push(path);
  }
  const ordered = (paths: string[]) => Object.freeze(paths.sort(scalarCompare));
  return Object.freeze({
    changedFiles: ordered(changedFiles),
    removedFiles: ordered(removedFiles),
    addedFiles: ordered(
      [...current.keys()].filter((path) => !previous.has(path)),
    ),
  });
}
