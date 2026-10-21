import type { DirEntry } from "./useFileTree";

type ProjectListing = {
  name: string;
  isDir: boolean;
  ignored: boolean;
}[];

/** A folder of a project that lives on another machine, addressed as
 * `remote://<environment>/<path>` by the Harness. */
export function isRemoteProjectUri(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith("remote://");
}

export function toDirEntries(
  listing: ProjectListing,
  showHidden: boolean,
): DirEntry[] {
  return listing
    .filter((entry) => showHidden || !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDir ? ("dir" as const) : ("file" as const),
      size: 0,
      mtime: 0,
      gitignored: entry.ignored,
    }));
}

/** Lists a remote project folder through the same router the Harness uses, so
 * the app explorer and the Harness agree on what is on the host. Loaded on
 * demand: local-only use never pulls the remote machinery in. */
export async function remoteProjectReadDir(
  path: string,
  showHidden: boolean,
): Promise<DirEntry[]> {
  const { invokeWorkspace } = await import("@/modules/harness/lib/fs");
  const listing = await invokeWorkspace<ProjectListing>("list_dir", { path });
  return toDirEntries(listing, showHidden);
}
