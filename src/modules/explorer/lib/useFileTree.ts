import {
  isPathInWorkspace,
  remoteCreateDir,
  remoteCreateFile,
  remoteDelete,
  remoteReadDir,
  remoteRename,
} from "@/modules/remote";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  currentWorkspaceEnv,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isNetworkFilesystemPath,
  listenFsChanged,
  watchAdd,
  watchRemove,
} from "./watch";
import { parentPath as pathParent } from "./path";

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  gitignored: boolean;
};

type ChildrenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; entries: DirEntry[] }
  | { status: "error"; message: string };

type TreeState = Record<string, ChildrenState>;

export type PendingCreate = {
  parentPath: string;
  kind: "file" | "dir";
};

export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function dirname(path: string): string {
  return pathParent(path);
}

const EXPANSION_CACHE_LIMIT = 8;
const expansionCache = new Map<string, string[]>();

function rememberExpansion(root: string, expanded: Set<string>): void {
  expansionCache.delete(root);
  if (expanded.size > 0) expansionCache.set(root, [...expanded]);
  while (expansionCache.size > EXPANSION_CACHE_LIMIT) {
    const oldest = expansionCache.keys().next().value;
    if (oldest === undefined) break;
    expansionCache.delete(oldest);
  }
}

function recallExpansion(root: string): string[] {
  const v = expansionCache.get(root);
  if (!v) return [];
  expansionCache.delete(root);
  expansionCache.set(root, v);
  return v;
}

function isUnder(key: string, root: string): boolean {
  return key === root || key.startsWith(`${root}/`);
}

// mtime/size are ignored on purpose: the tree never renders them, so a watcher
// refetch that only bumps mtime (saving a file) must not count as a change.
function sameDirListing(a: DirEntry[], b: DirEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].kind !== b[i].kind ||
      a[i].gitignored !== b[i].gitignored
    )
      return false;
  }
  return true;
}

type Options = {
  /**
   * Changes when the backing local/WSL/SSH workspace changes. The explorer
   * must re-read the same root when only the server changes.
   */
  workspaceKey?: string;
  workspace?: WorkspaceEnv;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
};

export function pathAncestorsWithinRoot(
  rootPath: string,
  targetPath: string,
): string[] | null {
  const normalize = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  };
  const root = normalize(rootPath);
  const target = normalize(targetPath);
  const caseInsensitive = /^[a-z]:/i.test(root) || root.startsWith("//");
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root;
  const comparableTarget = caseInsensitive ? target.toLowerCase() : target;
  if (
    comparableTarget !== comparableRoot &&
    !comparableTarget.startsWith(`${comparableRoot}/`)
  ) {
    return null;
  }

  const parent = target.slice(0, target.lastIndexOf("/"));
  if (!parent || parent.length <= root.length) return [];
  const relative = parent.slice(root.length).replace(/^\/+/, "");
  if (!relative) return [];
  const ancestors: string[] = [];
  let current = root;
  for (const segment of relative.split("/")) {
    current = current === "/" ? `/${segment}` : `${current}/${segment}`;
    ancestors.push(current);
  }
  return ancestors;
}

export function useFileTree(rootPath: string | null, options?: Options) {
  const workspace = options?.workspace ?? currentWorkspaceEnv();
  const workspaceKey = options?.workspaceKey ?? workspaceScopeKey(workspace);
  const activeWorkspaceKeyRef = useRef(workspaceKey);
  activeWorkspaceKeyRef.current = workspaceKey;
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const showHiddenRef = useRef(showHidden);
  const gitDecorations = usePreferencesStore((s) => s.explorerGitDecorations);
  const gitDecorationsRef = useRef(gitDecorations);
  const [nodes, setNodes] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);

  const expandedRef = useRef(expanded);
  const nodesRef = useRef(nodes);
  const watchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    showHiddenRef.current = showHidden;
  }, [showHidden]);

  useEffect(() => {
    gitDecorationsRef.current = gitDecorations;
  }, [gitDecorations]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const addWatch = useCallback(
    (path: string) => {
      if (watchedRef.current.has(path)) return;
      watchedRef.current.add(path);
      watchAdd([path], workspace);
    },
    [workspace],
  );

  const removeWatch = useCallback(
    (path: string) => {
      if (!watchedRef.current.delete(path)) return;
      watchRemove([path], workspace);
    },
    [workspace],
  );

  const fetchChildren = useCallback(
    async (path: string) => {
      const isWorkspacePath = isPathInWorkspace(workspace, path);
      const requestWorkspace = isWorkspacePath ? workspace : LOCAL_WORKSPACE;
      const requestWorkspaceKey = workspaceScopeKey(requestWorkspace);
      // A space can change before its environment switch finishes. Do not send
      // a request for the new root through the previous server.
      if (isWorkspacePath && requestWorkspaceKey !== workspaceKey) return;

      if (nodesRef.current[path]?.status !== "loaded") {
        setNodes((s) => ({ ...s, [path]: { status: "loading" } }));
      }
      try {
        const entries =
          requestWorkspace.kind === "ssh"
            ? (await remoteReadDir(requestWorkspace, path))
                .filter(
                  (entry) =>
                    showHiddenRef.current || !entry.name.startsWith("."),
                )
                .map((entry) => ({ ...entry, gitignored: false }))
            : await invoke<DirEntry[]>("fs_read_dir", {
                path,
                showHidden: showHiddenRef.current,
                gitDecorations: gitDecorationsRef.current,
                workspace: requestWorkspace,
              });

        // Ignore replies from a workspace that was replaced while the request
        // was in flight. Otherwise a slow first server can repopulate the tree
        // after the user has already switched to another one.
        if (
          isWorkspacePath &&
          activeWorkspaceKeyRef.current !== requestWorkspaceKey
        ) {
          return;
        }

        const prev = nodesRef.current[path];
        if (
          prev?.status === "loaded" &&
          sameDirListing(prev.entries, entries)
        ) {
          return;
        }

        const liveDirs = new Set(
          entries
            .filter((e) => e.kind === "dir")
            .map((e) => joinPath(path, e.name)),
        );
        const removedRoots: string[] = [];
        for (const key of Object.keys(nodesRef.current)) {
          if (dirname(key) === path && !liveDirs.has(key))
            removedRoots.push(key);
        }
        const dead = new Set<string>();
        if (removedRoots.length > 0) {
          const candidates = new Set<string>([
            ...Object.keys(nodesRef.current),
            ...expandedRef.current,
            ...watchedRef.current,
          ]);
          for (const k of candidates) {
            if (removedRoots.some((r) => isUnder(k, r))) dead.add(k);
          }
        }

        setNodes((s) => {
          const next: TreeState = {};
          for (const [k, v] of Object.entries(s)) if (!dead.has(k)) next[k] = v;
          next[path] = { status: "loaded", entries };
          return next;
        });

        if (dead.size > 0) {
          setExpanded((c) => {
            let changed = false;
            const n = new Set(c);
            for (const d of dead) if (n.delete(d)) changed = true;
            return changed ? n : c;
          });
          const toUnwatch: string[] = [];
          for (const d of dead)
            if (watchedRef.current.delete(d)) toUnwatch.push(d);
          watchRemove(toUnwatch, requestWorkspace);
        }
      } catch (e) {
        if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) {
          return;
        }
        setNodes((s) => ({
          ...s,
          [path]: { status: "error", message: String(e) },
        }));
      }
    },
    [workspace, workspaceKey],
  );

  // Root change → restore the cached expansion for this root, re-scope watches,
  // and persist the outgoing root's expansion on the way out.
  useEffect(() => {
    if (!rootPath) {
      setNodes({});
      setExpanded(new Set());
      setPendingCreate(null);
      setRenaming(null);
      return;
    }
    setPendingCreate(null);
    setRenaming(null);
    let disposed = false;
    let networkRoot = false;
    setExpanded(new Set());
    setNodes({});
    // Sync the ref synchronously: nodesRef only updates after the next render,
    // so without this a fast (cached) fetchChildren below would read the stale
    // pre-clear "loaded" node, hit the sameDirListing early-return, and skip
    // re-populating — leaving a valid root with an empty tree when rootPath
    // changes rapidly (e.g. switching folders in quick succession).
    nodesRef.current = {};

    void (async () => {
      networkRoot =
        workspace.kind === "local" &&
        (isNetworkFilesystemPath(rootPath) ||
          (await invoke<boolean>("fs_is_network_path", {
            path: rootPath,
            workspace,
          }).catch(() => false)));
      if (disposed) return;
      const restored = networkRoot ? [] : recallExpansion(rootPath);
      setExpanded(new Set(restored));
      const toWatch = [rootPath, ...restored];
      void fetchChildren(rootPath);
      for (const directory of restored) void fetchChildren(directory);
      for (const path of toWatch) watchedRef.current.add(path);
      watchAdd(toWatch, workspace);
    })();

    return () => {
      disposed = true;
      if (!networkRoot) rememberExpansion(rootPath, expandedRef.current);
      if (watchedRef.current.size > 0) {
        watchRemove([...watchedRef.current], workspace);
        watchedRef.current.clear();
      }
    };
  }, [rootPath, fetchChildren, workspace]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listenFsChanged(
      (paths) => {
        const current = nodesRef.current;
        const dirs = new Set<string>();
        for (const p of paths) {
          const parent = dirname(p);
          if (current[parent]?.status === "loaded") dirs.add(parent);
          if (current[p]?.status === "loaded") dirs.add(p);
        }
        for (const d of dirs) void fetchChildren(d);
      },
      workspace,
    ).then((un) => {
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [fetchChildren, workspace]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(showHidden): preference changes intentionally trigger a relist
  // biome-ignore lint/correctness/useExhaustiveDependencies(gitDecorations): preference changes intentionally trigger a relist
  useEffect(() => {
    if (!rootPath) return;
    const loadedPaths = Object.entries(nodesRef.current)
      .filter(([, state]) => state.status === "loaded")
      .map(([path]) => path);
    for (const path of loadedPaths) void fetchChildren(path);
    // Re-list loaded directories when visibility or git-decoration prefs change.
  }, [showHidden, gitDecorations, rootPath, fetchChildren]);

  const toggle = useCallback(
    (path: string) => {
      if (expandedRef.current.has(path)) {
        setExpanded((curr) => {
          const next = new Set(curr);
          next.delete(path);
          return next;
        });
        removeWatch(path);
      } else {
        setExpanded((curr) => {
          const next = new Set(curr);
          next.add(path);
          return next;
        });
        addWatch(path);
        void fetchChildren(path);
      }
    },
    [fetchChildren, addWatch, removeWatch],
  );

  const expand = useCallback(
    (path: string) => {
      if (expandedRef.current.has(path)) return;
      setExpanded((curr) => {
        const next = new Set(curr);
        next.add(path);
        return next;
      });
      addWatch(path);
      void fetchChildren(path);
    },
    [fetchChildren, addWatch],
  );

  const reveal = useCallback(
    async (path: string): Promise<boolean> => {
      if (!rootPath) return false;
      const ancestors = pathAncestorsWithinRoot(rootPath, path);
      if (ancestors === null) return false;
      if (ancestors.length > 0) {
        setExpanded((current) => {
          const next = new Set(current);
          for (const directory of ancestors) next.add(directory);
          return next;
        });
        for (const directory of ancestors) addWatch(directory);
        await Promise.all(ancestors.map(fetchChildren));
      }
      return true;
    },
    [rootPath, addWatch, fetchChildren],
  );

  const refresh = useCallback(
    (path: string) => {
      void fetchChildren(path);
    },
    [fetchChildren],
  );

  // --- mutations ---

  const beginCreate = useCallback(
    (parentPath: string, kind: "file" | "dir") => {
      setRenaming(null);
      setPendingCreate({ parentPath, kind });
      // Ensure the parent is expanded so the input row is visible.
      if (rootPath && parentPath !== rootPath) {
        setExpanded((curr) => {
          if (curr.has(parentPath)) return curr;
          const next = new Set(curr);
          next.add(parentPath);
          return next;
        });
        addWatch(parentPath);
      }
      setNodes((curr) => {
        if (!curr[parentPath]) void fetchChildren(parentPath);
        return curr;
      });
    },
    [rootPath, fetchChildren, addWatch],
  );

  const cancelCreate = useCallback(() => setPendingCreate(null), []);

  const commitCreate = useCallback(
    async (name: string) => {
      if (!pendingCreate) return;
      const trimmed = name.trim();
      if (!trimmed) {
        setPendingCreate(null);
        return;
      }
      const path = joinPath(pendingCreate.parentPath, trimmed);
      try {
        const isWorkspacePath = isPathInWorkspace(workspace, path);
        const operationWorkspace = isWorkspacePath
          ? workspace
          : LOCAL_WORKSPACE;
        if (operationWorkspace.kind === "ssh") {
          if (pendingCreate.kind === "dir") {
            await remoteCreateDir(operationWorkspace, path);
          } else {
            await remoteCreateFile(operationWorkspace, path);
          }
        } else {
          const cmd =
            pendingCreate.kind === "dir" ? "fs_create_dir" : "fs_create_file";
          await invoke(cmd, { path, workspace: operationWorkspace });
        }
        await fetchChildren(pendingCreate.parentPath);
      } catch (e) {
        console.error("create failed:", e);
      } finally {
        setPendingCreate(null);
      }
    },
    [pendingCreate, fetchChildren, workspace],
  );

  const beginRename = useCallback((path: string) => {
    setPendingCreate(null);
    setRenaming(path);
  }, []);

  const cancelRename = useCallback(() => setRenaming(null), []);

  const commitRename = useCallback(
    async (newName: string) => {
      if (!renaming) return;
      const trimmed = newName.trim();
      const parent = dirname(renaming);
      const oldName = renaming.slice(parent === "/" ? 1 : parent.length + 1);
      if (!trimmed || trimmed === oldName) {
        setRenaming(null);
        return;
      }
      const to = joinPath(parent, trimmed);
      try {
        const isWorkspacePath = isPathInWorkspace(workspace, renaming);
        const operationWorkspace = isWorkspacePath
          ? workspace
          : LOCAL_WORKSPACE;
        if (operationWorkspace.kind === "ssh") {
          await remoteRename(operationWorkspace, renaming, to);
        } else {
          await invoke("fs_rename", {
            from: renaming,
            to,
            workspace: operationWorkspace,
          });
        }
        options?.onPathRenamed?.(renaming, to);
        await fetchChildren(parent);
      } catch (e) {
        console.error("fs_rename failed:", e);
      } finally {
        setRenaming(null);
      }
    },
    [renaming, fetchChildren, options, workspace],
  );

  const deletePath = useCallback(
    async (path: string) => {
      try {
        const isWorkspacePath = isPathInWorkspace(workspace, path);
        const operationWorkspace = isWorkspacePath
          ? workspace
          : LOCAL_WORKSPACE;
        if (operationWorkspace.kind === "ssh") {
          await remoteDelete(operationWorkspace, path);
        } else {
          await invoke("fs_delete", { path, workspace: operationWorkspace });
        }
        options?.onPathDeleted?.(path);
        await fetchChildren(dirname(path));
      } catch (e) {
        console.error("fs_delete failed:", e);
      }
    },
    [fetchChildren, options, workspace],
  );

  const deletePaths = useCallback(
    async (paths: string[]) => {
      const parentDirsToRefresh = new Set<string>();
      for (const path of paths) {
        try {
          const isWorkspacePath = isPathInWorkspace(workspace, path);
          const operationWorkspace = isWorkspacePath
            ? workspace
            : LOCAL_WORKSPACE;
          if (operationWorkspace.kind === "ssh") {
            await remoteDelete(operationWorkspace, path);
          } else {
            await invoke("fs_delete", { path, workspace: operationWorkspace });
          }
          options?.onPathDeleted?.(path);
          parentDirsToRefresh.add(dirname(path));
        } catch (e) {
          console.error("fs_delete failed:", e);
        }
      }
      await Promise.all(
        Array.from(parentDirsToRefresh).map((dir) => fetchChildren(dir)),
      );
    },
    [fetchChildren, options, workspace],
  );

  const movePath = useCallback(
    async (from: string, toDir: string) => {
      const name = from.slice(from.lastIndexOf("/") + 1);
      const to = joinPath(toDir, name);
      if (to === from) return;
      const target = nodesRef.current[toDir];
      if (
        target?.status === "loaded" &&
        target.entries.some((e) => e.name === name)
      ) {
        console.warn(`move skipped: "${name}" already exists in ${toDir}`);
        return;
      }
      try {
        const isWorkspacePath = isPathInWorkspace(workspace, from);
        const operationWorkspace = isWorkspacePath
          ? workspace
          : LOCAL_WORKSPACE;
        if (operationWorkspace.kind === "ssh") {
          await remoteRename(operationWorkspace, from, to);
        } else {
          await invoke("fs_rename", {
            from,
            to,
            workspace: operationWorkspace,
          });
        }
        options?.onPathRenamed?.(from, to);
        await Promise.all([fetchChildren(dirname(from)), fetchChildren(toDir)]);
      } catch (e) {
        console.error("fs_rename (move) failed:", e);
      }
    },
    [fetchChildren, options, workspace],
  );

  return {
    nodes,
    expanded,
    pendingCreate,
    renaming,
    toggle,
    expand,
    reveal,
    refresh,
    beginCreate,
    cancelCreate,
    commitCreate,
    beginRename,
    cancelRename,
    commitRename,
    deletePath,
    deletePaths,
    movePath,
    joinPath,
  };
}
