import type { SourceControlFileEntry } from "../useSourceControlPanel";

export type SourceControlTreeRow =
  | {
      kind: "folder";
      key: string;
      path: string;
      name: string;
      depth: number;
      expanded: boolean;
      checkState: SourceControlFileEntry["checkState"];
    }
  | {
      kind: "entry";
      key: string;
      entry: SourceControlFileEntry;
      depth: number;
    };

type FolderNode = {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  entries: SourceControlFileEntry[];
  entryCount: number;
  checkedCount: number;
  stagedCount: number;
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function createFolder(name: string, path: string): FolderNode {
  return {
    name,
    path,
    folders: new Map(),
    entries: [],
    entryCount: 0,
    checkedCount: 0,
    stagedCount: 0,
  };
}

function buildTree(entries: readonly SourceControlFileEntry[]): FolderNode {
  const root = createFolder("", "");
  for (const entry of entries) {
    const parts = normalizePath(entry.path).split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      root.entries.push(entry);
      continue;
    }

    let folder = root;
    const ancestors: FolderNode[] = [];
    for (const part of parts) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let child = folder.folders.get(part);
      if (!child) {
        child = createFolder(part, path);
        folder.folders.set(part, child);
      }
      folder = child;
      ancestors.push(folder);
    }
    folder.entries.push(entry);
    for (const ancestor of ancestors) {
      ancestor.entryCount += 1;
      if (entry.checkState === "checked") ancestor.checkedCount += 1;
      if (entry.staged) ancestor.stagedCount += 1;
    }
  }
  return root;
}

function folderCheckState(
  folder: FolderNode,
): SourceControlFileEntry["checkState"] {
  if (folder.checkedCount === folder.entryCount) return "checked";
  if (folder.stagedCount > 0) return "indeterminate";
  return "unchecked";
}

export function sourceControlFolderPaths(
  entries: readonly SourceControlFileEntry[],
  folderPath: string,
  action: "stage" | "unstage",
): string[] {
  const folder = normalizePath(folderPath).replace(/\/+$/, "");
  if (
    !folder ||
    folder.startsWith("/") ||
    /^[A-Za-z]:/.test(folder) ||
    folder.split("/").includes("..")
  ) {
    return [];
  }
  const prefix = `${folder}/`;
  return entries
    .filter((entry) => {
      const path = normalizePath(entry.path);
      return (
        path.startsWith(prefix) &&
        (action === "stage" ? entry.unstaged : entry.staged)
      );
    })
    .map((entry) => entry.path);
}

function flattenFolder(
  folder: FolderNode,
  depth: number,
  collapsedFolders: ReadonlySet<string>,
  rows: SourceControlTreeRow[],
): void {
  const folders = [...folder.folders.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const child of folders) {
    const expanded = !collapsedFolders.has(child.path);
    rows.push({
      kind: "folder",
      key: `folder:${child.path}`,
      path: child.path,
      name: child.name,
      depth,
      expanded,
      checkState: folderCheckState(child),
    });
    if (expanded) {
      flattenFolder(child, depth + 1, collapsedFolders, rows);
    }
  }

  const entries = [...folder.entries].sort((a, b) =>
    normalizePath(a.path).localeCompare(normalizePath(b.path)),
  );
  for (const entry of entries) {
    rows.push({ kind: "entry", key: entry.key, entry, depth });
  }
}

export function flattenSourceControlTree(
  entries: readonly SourceControlFileEntry[],
  collapsedFolders: ReadonlySet<string>,
): SourceControlTreeRow[] {
  const rows: SourceControlTreeRow[] = [];
  flattenFolder(buildTree(entries), 0, collapsedFolders, rows);
  return rows;
}
