import type { SourceControlFileEntry } from "../useSourceControlPanel";

export type SourceControlTreeRow =
  | {
      kind: "folder";
      key: string;
      path: string;
      name: string;
      depth: number;
      expanded: boolean;
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
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function createFolder(name: string, path: string): FolderNode {
  return { name, path, folders: new Map(), entries: [] };
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
    for (const part of parts) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let child = folder.folders.get(part);
      if (!child) {
        child = createFolder(part, path);
        folder.folders.set(part, child);
      }
      folder = child;
    }
    folder.entries.push(entry);
  }
  return root;
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
