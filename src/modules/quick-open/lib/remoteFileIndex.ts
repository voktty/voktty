import type { RemoteDirEntry } from "@/modules/remote";

const PRUNE_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".jj",
  "node_modules",
  "bower_components",
  ".pnpm-store",
  ".yarn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".vite",
  ".turbo",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  ".idea",
]);

type RemoteDirectoryReader = (path: string) => Promise<RemoteDirEntry[]>;

type RemoteFileIndexOptions = {
  limit?: number;
  maxDepth?: number;
  showHidden?: boolean;
  concurrency?: number;
};

export type RemoteFileIndex = {
  files: string[];
  truncated: boolean;
};

type PendingDirectory = {
  path: string;
  relative: string;
  depth: number;
};

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/$/, "")}/${name}`;
}

export async function indexRemoteFiles(
  root: string,
  readDirectory: RemoteDirectoryReader,
  options: RemoteFileIndexOptions = {},
): Promise<RemoteFileIndex> {
  const limit = Math.max(1, Math.min(options.limit ?? 10_000, 10_000));
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 16, 16));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, 12));
  const showHidden = options.showHidden ?? false;
  const queue: PendingDirectory[] = [{ path: root, relative: "", depth: 0 }];
  const files: string[] = [];
  let truncated = false;

  while (queue.length > 0 && files.length < limit) {
    const batch = queue.splice(0, concurrency);
    const listings = await Promise.all(
      batch.map(async (directory) => {
        try {
          return { directory, entries: await readDirectory(directory.path) };
        } catch (error) {
          if (directory.depth === 0) throw error;
          return { directory, entries: [], incomplete: true };
        }
      }),
    );

    for (const { directory, entries, incomplete } of listings) {
      if (incomplete) truncated = true;
      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith(".")) continue;
        const relative = directory.relative
          ? `${directory.relative}/${entry.name}`
          : entry.name;
        if (entry.kind === "file") {
          files.push(relative);
          if (files.length >= limit) {
            truncated = true;
            break;
          }
        } else if (entry.kind === "dir" && !PRUNE_DIRECTORIES.has(entry.name)) {
          if (directory.depth < maxDepth) {
            queue.push({
              path: joinPath(directory.path, entry.name),
              relative,
              depth: directory.depth + 1,
            });
          } else {
            truncated = true;
          }
        }
      }
      if (files.length >= limit) break;
    }
  }

  if (queue.length > 0) truncated = true;
  files.sort((left, right) => left.localeCompare(right));
  return { files, truncated };
}
