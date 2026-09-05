import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  CodeIcon,
  FileAddIcon,
  Folder01Icon,
  FolderAddIcon,
  FolderGitTwoIcon,
  Globe02Icon,
  ArrowUp01Icon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { isWebPreviewablePath } from "@/modules/preview/components/LivePreviewButton";
import { ExplorerSearch, type ExplorerSearchHandle } from "./ExplorerSearch";
import { EntryRow, PendingRow, StatusRow, type RowActions } from "./TreeRow";
import { InlineInput } from "./InlineInput";
import {
  copyToClipboard,
  downloadRemoteFileOrFolder,
  downloadRemoteFilesOrFolders,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import { useExplorerDnd } from "./lib/useExplorerDnd";
import { useExplorerFileDrop } from "./lib/useExplorerFileDrop";
import { useFileTree } from "./lib/useFileTree";
import { useGitStatus } from "./lib/useGitStatus";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { parentPath as pathParent } from "./lib/path";
import { nextVisibleRoot } from "./lib/visibleRoot";
import { useTranslation } from "@/modules/i18n";
import { isPathInWorkspace } from "@/modules/remote";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useGlobalShortcuts } from "@/modules/shortcuts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import type { TerminalPathDropTarget } from "@/modules/terminal";
import type {
  WorkspaceDragSource,
  WorkspaceDropTarget,
} from "@/modules/spaces/lib/workspaceDrag";

export type FileExplorerHandle = {
  focus: () => void;
  isFocused: () => boolean;
  focusSearch: () => void;
  reveal: (path: string) => Promise<boolean>;
};

type Props = {
  rootPath: string | null;
  navigationKey?: string;
  workspaceKey?: string;
  workspaceId?: string;
  workspaceEnv: WorkspaceEnv;
  activeFilePath?: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onOpenFileInEditor?: (path: string, pin?: boolean) => void;
  onOpenPreview?: (path: string) => void;
  isPreviewActive?: boolean;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onOpenInSourceControl?: (path: string) => void;
  onOpenGitHistory?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  /** Kept for the outer workspace integration. Explorer resource drops do not
   * use it: they target terminal paths or AI context explicitly. */
  onWorkspaceDrop?: (
    source: WorkspaceDragSource,
    target: WorkspaceDropTarget,
  ) => void;
  pathDropTarget?: TerminalPathDropTarget;
  gitStatus?: GitStatusSnapshot | null;
  hasGitRepo?: boolean;
  onInitGit?: (path: string) => Promise<void> | void;
  onPrepareNavigationRoot?: (path: string) => Promise<boolean>;
  onSyncToTerminal?: () => Promise<string | null | void> | string | null | void;
};

type Row =
  | {
      kind: "entry";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      isExpanded: boolean;
      depth: number;
      size: number;
      mtime: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
      size: number;
      mtime: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
    }
  | { kind: "pending"; key: string; depth: number; pendingKind: "file" | "dir" }
  | { kind: "status"; key: string; depth: number; tone: "muted" | "error"; message: string };

const ROW_HEIGHT = 22;
const OVERSCAN = 8;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function parentOf(path: string, fallback: string): string {
  const parent = pathParent(path);
  return parent === path ? fallback : parent;
}

function buildRows(
  rootPath: string,
  tree: ReturnType<typeof useFileTree>,
  lookup: (path: string) => GitStatusCode | null,
  loadingMessage: string,
): { rows: Row[]; entryIndexByPath: Map<string, number> } {
  const rows: Row[] = [];
  const entryIndexByPath = new Map<string, number>();

  const walk = (parent: string, depth: number, parentIgnored: boolean) => {
    const node = tree.nodes[parent];
    if (!node || node.status !== "loaded") return;
    for (const entry of node.entries) {
      const path = tree.joinPath(parent, entry.name);
      const isDir = entry.kind === "dir";
      const expanded = isDir && tree.expanded.has(path);
      const isRenaming = tree.renaming === path;
      const gitignored = parentIgnored || entry.gitignored;
      const gitStatusCode = gitignored ? null : lookup(path);
      if (isRenaming) {
        rows.push({
          kind: "rename",
          key: `rename:${path}`,
          path,
          name: entry.name,
          isDir,
          depth,
          size: entry.size,
          mtime: entry.mtime,
          gitignored,
          gitStatusCode,
        });
      } else {
        entryIndexByPath.set(path, rows.length);
        rows.push({
          kind: "entry",
          key: path,
          path,
          name: entry.name,
          isDir,
          isExpanded: expanded,
          depth,
          size: entry.size,
          mtime: entry.mtime,
          gitignored,
          gitStatusCode,
        });
      }
      if (isDir && expanded) {
        const child = tree.nodes[path];
        if (tree.pendingCreate?.parentPath === path) {
          rows.push({
            kind: "pending",
            key: `pending:${path}`,
            depth: depth + 1,
            pendingKind: tree.pendingCreate.kind,
          });
        }
        if (child?.status === "loading") {
          rows.push({
            kind: "status",
            key: `loading:${path}`,
            depth: depth + 1,
            tone: "muted",
            message: loadingMessage,
          });
        } else if (child?.status === "error") {
          rows.push({
            kind: "status",
            key: `error:${path}`,
            depth: depth + 1,
            tone: "error",
            message: child.message,
          });
        } else if (child?.status === "loaded") {
          walk(path, depth + 1, gitignored);
        }
      }
    }
  };

  walk(rootPath, 0, false);
  return { rows, entryIndexByPath };
}

export const FileExplorer = memo(
  forwardRef<FileExplorerHandle, Props>(function FileExplorer(
    {
      rootPath: sourceRootPath,
      navigationKey,
      workspaceKey,
      workspaceEnv,
      activeFilePath,
      onOpenFile,
      onOpenFileInEditor,
      onOpenPreview,
      isPreviewActive,
      onPathRenamed,
      onPathDeleted,
      onRevealInTerminal,
      onOpenInSourceControl,
      onOpenGitHistory,
      onAttachToAgent,
      pathDropTarget,
      gitStatus,
      hasGitRepo,
      onInitGit,
      onPrepareNavigationRoot,
      onSyncToTerminal,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const loadingMessage = t("common.loading");
    const sourceRootIsReachable =
      sourceRootPath === null ||
      isPathInWorkspace(workspaceEnv, sourceRootPath);
    const workspaceRoot =
      workspaceEnv.kind === "ssh" ? workspaceEnv.root : null;
    const [visibleRootPath, setVisibleRootPath] = useState(() =>
      sourceRootIsReachable ? sourceRootPath : workspaceRoot,
    );
    const navigationKeyRef = useRef(navigationKey);
    const sourceRootPathRef = useRef(sourceRootPath);
    const refreshRequestRef = useRef(0);
    const refreshPendingNavigationRef = useRef<string | null | undefined>(null);
    useEffect(() => {
      refreshRequestRef.current += 1;
      const navigationChanged = navigationKeyRef.current !== navigationKey;
      const previousSourceRoot = sourceRootPathRef.current;
      navigationKeyRef.current = navigationKey;
      sourceRootPathRef.current = sourceRootPath;
      setVisibleRootPath((currentVisibleRoot) =>
        nextVisibleRoot({
          currentVisibleRoot,
          previousSourceRoot,
          sourceRoot: sourceRootPath,
          navigationChanged,
          sourceReachable: sourceRootIsReachable,
          workspaceRoot,
        }),
      );
    }, [navigationKey, sourceRootIsReachable, sourceRootPath, workspaceRoot]);
    const rootPath = visibleRootPath;
    const tree = useFileTree(rootPath, {
      workspaceKey,
      workspace: workspaceEnv,
      onPathRenamed,
      onPathDeleted,
    });
    const gitDecorations = usePreferencesStore((s) => s.explorerGitDecorations);
    const { lookup: lookupGitStatus } = useGitStatus(
      rootPath,
      gitDecorations ? gitStatus : null,
      gitDecorations,
    );
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
      () => new Set(),
    );
    const [anchorPath, setAnchorPath] = useState<string | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const searchRef = useRef<ExplorerSearchHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const { rows, entryIndexByPath } = useMemo(() => {
      if (!rootPath) return { rows: [] as Row[], entryIndexByPath: new Map<string, number>() };
      return buildRows(rootPath, tree, lookupGitStatus, loadingMessage);
      // `tree` is intentionally omitted: its identity changes every render, but
      // the listed fields are the only inputs buildRows actually reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      rootPath,
      tree.nodes,
      tree.expanded,
      tree.renaming,
      tree.pendingCreate,
      lookupGitStatus,
      loadingMessage,
    ]);

    const rowActions = useMemo<RowActions>(
      () => ({
        toggle: tree.toggle,
        beginRename: tree.beginRename,
        commitRename: tree.commitRename,
        cancelRename: tree.cancelRename,
      }),
      [tree.toggle, tree.beginRename, tree.commitRename, tree.cancelRename],
    );
    const renameInProgress =
      tree.renaming !== null || tree.pendingCreate !== null;

    const parentPath = rootPath ? pathParent(rootPath) : null;
    const canNavigateToParent =
      parentPath !== null && parentPath !== rootPath;

    const handleNavigateToParent = useCallback(async () => {
      if (!rootPath || !parentPath || parentPath === rootPath) return;
      if (
        workspaceEnv.kind === "ssh" &&
        !isPathInWorkspace(workspaceEnv, parentPath)
      ) {
        try {
          const prepared =
            (await onPrepareNavigationRoot?.(parentPath)) ?? false;
          if (!prepared) {
            toast.error(t("explorer.remoteWorkspaceBoundary"));
            return;
          }
        } catch {
          toast.error(t("feedback.remoteSessionFailed"));
          return;
        }
      }
      setVisibleRootPath(parentPath);
    }, [onPrepareNavigationRoot, parentPath, rootPath, t, workspaceEnv]);

    const handleSyncToTerminal = useCallback(async () => {
      let targetPath = sourceRootPath;
      try {
        const liveCwd = await onSyncToTerminal?.();
        if (liveCwd) targetPath = liveCwd;
      } catch {}
      if (!targetPath) return;
      if (refreshPendingNavigationRef.current === navigationKey) return;
      refreshPendingNavigationRef.current = navigationKey;
      const request = ++refreshRequestRef.current;
      let environmentChanged = false;
      try {
        environmentChanged =
          (await onPrepareNavigationRoot?.(targetPath)) ?? false;
      } catch {
        if (request !== refreshRequestRef.current) return;
        toast.error(t("feedback.remoteSessionFailed"));
        return;
      } finally {
        if (refreshPendingNavigationRef.current === navigationKey) {
          refreshPendingNavigationRef.current = null;
        }
      }
      if (request !== refreshRequestRef.current) return;
      setVisibleRootPath(targetPath);
      if (!environmentChanged) tree.refresh(targetPath);
    }, [
      navigationKey,
      onPrepareNavigationRoot,
      onSyncToTerminal,
      sourceRootPath,
      t,
      tree,
    ]);

    const handleRefreshCurrent = useCallback(() => {
      if (rootPath) tree.refresh(rootPath);
    }, [rootPath, tree.refresh]);

    const [menuTarget, setMenuTarget] = useState<{
      path: string;
      name: string;
      isDir: boolean;
    } | null>(null);
    const [deleteRequest, setDeleteRequest] = useState<{
      paths: string[];
    } | null>(null);
    // Bumped on every right-click so the menu content remounts and the popper
    // re-anchors to the new cursor (floating-ui won't reposition on an anchor
    // change alone, only on scroll/resize).
    const [menuNonce, setMenuNonce] = useState(0);

    const entryPaths = useMemo<string[]>(() => {
      const out: string[] = [];
      for (const row of rows) if (row.kind === "entry") out.push(row.path);
      return out;
    }, [rows]);

    const isDirAt = useCallback(
      (path: string): boolean | undefined => {
        const idx = entryIndexByPath.get(path);
        const row = idx !== undefined ? rows[idx] : undefined;
        return row?.kind === "entry" ? row.isDir : undefined;
      },
      [entryIndexByPath, rows],
    );

    const requestDelete = useCallback((paths: string[]) => {
      const uniquePaths = Array.from(new Set(paths));
      if (uniquePaths.length === 0) return;
      setDeleteRequest({ paths: uniquePaths });
    }, []);

    const confirmDelete = useCallback(() => {
      if (!deleteRequest) return;
      const { paths } = deleteRequest;
      setDeleteRequest(null);
      setSelectedPaths(new Set());
      setAnchorPath(null);
      if (paths.length === 1) {
        void tree.deletePath(paths[0]);
      } else {
        void tree.deletePaths(paths);
      }
    }, [deleteRequest, tree.deletePath, tree.deletePaths]);

    const dnd = useExplorerDnd({
      rootPath: rootPath ?? "",
      isDir: isDirAt,
      onMove: tree.movePath,
      pathDropTarget,
      selectedPaths,
    });

    const fileDrop = useExplorerFileDrop({
      rootPath,
      isDir: isDirAt,
      onCopied: tree.refresh,
    });

    const dropTargetDir = dnd.dropTargetDir ?? fileDrop.externalTargetDir;
    const rootIsDropTarget = dropTargetDir != null && dropTargetDir === rootPath;
    useEffect(() => {
      if (!dropTargetDir || dropTargetDir === rootPath) return;
      if (tree.expanded.has(dropTargetDir)) return;
      const id = window.setTimeout(() => tree.expand(dropTargetDir), 700);
      return () => window.clearTimeout(id);
    }, [dropTargetDir, rootPath, tree.expanded, tree.expand]);

    useEffect(() => {
      setSelectedPaths((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Set<string>();
        for (const p of prev) {
          if (entryIndexByPath.has(p)) {
            next.add(p);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      if (anchorPath && !entryIndexByPath.has(anchorPath)) {
        setAnchorPath(null);
      }
    }, [entryIndexByPath, anchorPath]);

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
      getItemKey: (index) => rows[index]?.key ?? index,
    });

    const scrollEntryIntoView = useCallback(
      (path: string) => {
        const index = entryIndexByPath.get(path);
        if (index === undefined) return;
        virtualizer.scrollToIndex(index, { align: "auto" });
      },
      [entryIndexByPath, virtualizer],
    );

    const handleSelectPath = useCallback(
      (path: string, e?: React.MouseEvent) => {
        if (!e) {
          setSelectedPaths(new Set([path]));
          setAnchorPath(path);
          return;
        }

        if (e.metaKey || e.ctrlKey) {
          // Toggle individual path in multi-selection
          setSelectedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
              next.delete(path);
            } else {
              next.add(path);
            }
            return next;
          });
          setAnchorPath(path);
        } else if (e.shiftKey) {
          // Range selection from anchor to clicked path
          const fromPath = anchorPath ?? (entryPaths.length > 0 ? entryPaths[0] : null);
          const fromIdx = fromPath ? entryPaths.indexOf(fromPath) : 0;
          const toIdx = entryPaths.indexOf(path);
          if (fromIdx !== -1 && toIdx !== -1) {
            const start = Math.min(fromIdx, toIdx);
            const end = Math.max(fromIdx, toIdx);
            const slice = entryPaths.slice(start, end + 1);
            setSelectedPaths(new Set(slice));
          } else {
            setSelectedPaths(new Set([path]));
            setAnchorPath(path);
          }
        } else {
          // Single selection
          setSelectedPaths(new Set([path]));
          setAnchorPath(path);
        }
      },
      [anchorPath, entryPaths],
    );

    const lastSyncedActivePathRef = useRef<string | null>(null);
    useEffect(() => {
      if (!activeFilePath || activeFilePath === lastSyncedActivePathRef.current) {
        return;
      }
      if (!entryIndexByPath.has(activeFilePath)) return;
      lastSyncedActivePathRef.current = activeFilePath;
      setSelectedPaths(new Set([activeFilePath]));
      setAnchorPath(activeFilePath);
      requestAnimationFrame(() => scrollEntryIntoView(activeFilePath));
    }, [activeFilePath, entryIndexByPath, scrollEntryIntoView]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          containerRef.current?.focus();
          if (selectedPaths.size === 0 && entryPaths.length > 0) {
            const first = entryPaths[0];
            setSelectedPaths(new Set([first]));
            setAnchorPath(first);
            requestAnimationFrame(() => scrollEntryIntoView(first));
          }
        },
        isFocused: () => {
          const c = containerRef.current;
          if (!c) return false;
          const active = document.activeElement;
          return active instanceof Node && c.contains(active);
        },
        focusSearch: () => {
          setIsSearchOpen(true);
          searchRef.current?.focus();
        },
        reveal: async (path: string) => {
          const revealed = await tree.reveal(path);
          if (!revealed) return false;
          setSelectedPaths(new Set([path]));
          setAnchorPath(path);
          requestAnimationFrame(() => scrollEntryIntoView(path));
          return true;
        },
      }),
      [entryPaths, scrollEntryIntoView, selectedPaths.size, tree.reveal],
    );

    useGlobalShortcuts({
      "explorer.search": () => {
        if (searchRef.current?.isFocused()) {
          setIsSearchOpen(false);
          return;
        }
        setIsSearchOpen(true);
        searchRef.current?.focus();
      },
    });

    if (!rootPath) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={24}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <div className="text-xs text-muted-foreground">
            {t("explorer.noCurrentDirectory")}
          </div>
        </div>
      );
    }

    const root = tree.nodes[rootPath];
    const pendingAtRoot =
      tree.pendingCreate?.parentPath === rootPath ? tree.pendingCreate : null;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tree.renaming || tree.pendingCreate || isSearchOpen) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (entryPaths.length === 0) return;

      // Ctrl+A / Cmd+A: Select all visible entries
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedPaths(new Set(entryPaths));
        return;
      }

      // Delete / Backspace: Delete selected items
      if (
        e.key === "Delete" ||
        ((e.ctrlKey || e.metaKey) && e.key === "Backspace")
      ) {
        if (selectedPaths.size > 0) {
          e.preventDefault();
          requestDelete(Array.from(selectedPaths));
        }
        return;
      }

      if (e.key === "F2" && selectedPaths.size === 1) {
        e.preventDefault();
        const [path] = selectedPaths;
        tree.beginRename(path);
        return;
      }

      // Escape: clear multi-selection down to single anchor or none
      if (e.key === "Escape") {
        if (selectedPaths.size > 1) {
          e.preventDefault();
          if (anchorPath && selectedPaths.has(anchorPath)) {
            setSelectedPaths(new Set([anchorPath]));
          } else {
            setSelectedPaths(new Set());
          }
        }
        return;
      }

      const currentAnchor =
        anchorPath ??
        (selectedPaths.size > 0 ? Array.from(selectedPaths)[0] : null);
      const currentIdx = currentAnchor ? entryPaths.indexOf(currentAnchor) : -1;

      // Shift + ArrowDown / ArrowUp: range expansion
      if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(
                entryPaths.length - 1,
                (currentIdx < 0 ? 0 : currentIdx) + 1,
              )
            : Math.max(
                0,
                (currentIdx < 0 ? entryPaths.length - 1 : currentIdx) - 1,
              );
        const nextPath = entryPaths[nextIdx];
        const origin = anchorPath ?? entryPaths[0];
        const originIdx = entryPaths.indexOf(origin);
        if (originIdx !== -1) {
          const start = Math.min(originIdx, nextIdx);
          const end = Math.max(originIdx, nextIdx);
          const slice = entryPaths.slice(start, end + 1);
          setSelectedPaths(new Set(slice));
          requestAnimationFrame(() => scrollEntryIntoView(nextPath));
        }
        return;
      }

      const move = (next: number) => {
        const clamped = Math.max(0, Math.min(entryPaths.length - 1, next));
        const path = entryPaths[clamped];
        setSelectedPaths(new Set([path]));
        setAnchorPath(path);
        requestAnimationFrame(() => scrollEntryIntoView(path));
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(currentIdx < 0 ? 0 : currentIdx + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(currentIdx < 0 ? entryPaths.length - 1 : currentIdx - 1);
          break;
        case "ArrowRight": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) {
            if (!row.isExpanded) tree.toggle(row.path);
            else move(currentIdx + 1);
          }
          break;
        }
        case "ArrowLeft": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir && row.isExpanded) {
            tree.toggle(row.path);
          } else {
            const parent = row.path.slice(0, row.path.lastIndexOf("/"));
            if (parent && parent !== rootPath) {
              setSelectedPaths(new Set([parent]));
              setAnchorPath(parent);
            }
          }
          break;
        }
        case "Enter": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) tree.toggle(row.path);
          else onOpenFile(row.path);
          break;
        }
      }
    };

    const renderRow = (row: Row) => {
      switch (row.kind) {
        case "entry":
        case "rename": {
          return (
            <EntryRow
              path={row.path}
              name={row.name}
              isDir={row.isDir}
              isExpanded={row.kind === "entry" ? row.isExpanded : false}
              depth={row.depth}
              size={row.size}
              mtime={row.mtime}
              workspace={workspaceEnv}
              actions={rowActions}
              renameInProgress={renameInProgress}
              isSelected={selectedPaths.has(row.path)}
              isRenaming={row.kind === "rename"}
              isDropTarget={dropTargetDir === row.path}
              onOpenFile={onOpenFile}
              onSelectPath={handleSelectPath}
              gitStatusCode={row.gitStatusCode}
              gitignored={gitDecorations && row.gitignored}
            />
          );
        }
        case "pending":
          return (
            <PendingRow
              depth={row.depth}
              kind={row.pendingKind}
              onCommit={tree.commitCreate}
              onCancel={tree.cancelCreate}
            />
          );
        case "status":
          return (
            <StatusRow depth={row.depth} message={row.message} tone={row.tone} />
          );
      }
    };

    return (
      <div
        ref={containerRef}
        className="flex h-full flex-col outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="flex h-7.5 shrink-0 items-center gap-0.5 border-b border-border/60 px-2">
          <span
            className="flex flex-1 items-center truncate text-[11.5px] font-medium text-foreground/80"
            title={rootPath}
          >
            <img
              src={folderIconUrl(basename(rootPath), false)}
              alt=""
              height={14}
              width={14}
              className="mx-1"
            />
            {basename(rootPath)}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-5.5 text-muted-foreground hover:text-foreground"
            onClick={() => void handleNavigateToParent()}
            disabled={!canNavigateToParent}
            title={
              canNavigateToParent
                ? t("explorer.parentDirectory")
                : t("explorer.parentDirectoryUnavailable")
            }
            aria-label={
              canNavigateToParent
                ? t("explorer.parentDirectory")
                : t("explorer.parentDirectoryUnavailable")
            }
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={12} strokeWidth={2} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-5.5 text-muted-foreground hover:text-foreground"
            onClick={() => setIsSearchOpen((v) => !v)}
            title={t("commandPalette.commands.searchFiles")}
            aria-label={t("commandPalette.commands.searchFiles")}
          >
            <HugeiconsIcon icon={Search01Icon} size={12} strokeWidth={2} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.beginCreate(rootPath, "file")}
            title={t("explorer.newFile")}
          >
            <HugeiconsIcon icon={FileAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.beginCreate(rootPath, "dir")}
            title={t("explorer.newFolder")}
          >
            <HugeiconsIcon icon={FolderAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => void handleSyncToTerminal()}
            title={t("explorer.refreshActiveTerminal")}
            aria-label={t("explorer.refreshActiveTerminal")}
          >
            <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
          </Button>
          {hasGitRepo === false && rootPath && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={async () => {
                try {
                  if (onInitGit) {
                    await onInitGit(rootPath);
                  }
                  toast.success(t("git.initRepoSuccess"));
                } catch (err) {
                  toast.error(String(err));
                }
              }}
              title={t("git.initializeRepo")}
              aria-label={t("git.initializeRepo")}
            >
              <HugeiconsIcon icon={FolderGitTwoIcon} size={13} strokeWidth={2} />
            </Button>
          )}
        </div>

        <ExplorerSearch
          ref={searchRef}
          rootPath={rootPath}
          onOpenFile={onOpenFile}
          open={isSearchOpen}
          onRequestClose={() => setIsSearchOpen(false)}
          onActiveChange={setIsSearchActive}
          onRevealInTerminal={onRevealInTerminal}
          onOpenInSourceControl={onOpenInSourceControl}
          onOpenGitHistory={onOpenGitHistory}
          onAttachToAgent={onAttachToAgent}
        />

        {!isSearchActive ? (
          <ContextMenu
            onOpenChange={(open) => {
              if (!open) setMenuTarget(null);
            }}
          >
            <ContextMenuTrigger asChild>
              <div
                ref={scrollRef}
                data-explorer-drop=""
                className={cn(
                  "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
                  rootIsDropTarget &&
                    "rounded-sm ring-1 ring-inset ring-primary/50",
                )}
                onPointerDown={dnd.onPointerDown}
                onClickCapture={dnd.onClickCapture}
                onContextMenuCapture={(e) => {
                  const el = (e.target as HTMLElement).closest<HTMLElement>(
                    "[data-fs-path]",
                  );
                  const path = el?.getAttribute("data-fs-path") ?? null;
                  const idx =
                    path != null ? entryIndexByPath.get(path) : undefined;
                  const row = idx !== undefined ? rows[idx] : undefined;
                  if (row && row.kind === "entry") {
                    if (!selectedPaths.has(row.path)) {
                      setSelectedPaths(new Set([row.path]));
                      setAnchorPath(row.path);
                    }
                    setMenuTarget({
                      path: row.path,
                      name: row.name,
                      isDir: row.isDir,
                    });
                  } else {
                    setMenuTarget(null);
                  }
                  setMenuNonce((n) => n + 1);
                }}
              >
                {pendingAtRoot ? (
                  <div
                    className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
                    style={{ paddingLeft: 6 }}
                  >
                    <span className="size-3.5 shrink-0" />
                    <img
                      src={
                        pendingAtRoot.kind === "dir"
                          ? folderIconUrl("", false)
                          : fileIconUrl("untitled")
                      }
                      alt=""
                      className="size-4 shrink-0 opacity-70"
                    />
                    <InlineInput
                      initial=""
                      placeholder={
                        pendingAtRoot.kind === "dir" ? t("explorer.newFolder") : t("explorer.newFile")
                      }
                      onCommit={tree.commitCreate}
                      onCancel={tree.cancelCreate}
                    />
                  </div>
                ) : null}
                {root?.status === "loading" && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    {t("common.loading")}
                  </div>
                )}
                {root?.status === "error" && (
                  <div className="px-3 py-2 text-[11px] text-destructive">
                    {root.message}
                  </div>
                )}
                {root?.status === "loaded" ? (
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          data-virtual-row-index={virtualRow.index}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderRow(row)}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              key={menuNonce}
              className={COMPACT_CONTENT}
              onCloseAutoFocus={(e) => {
                if (tree.renaming || tree.pendingCreate) e.preventDefault();
              }}
            >
              {menuTarget ? (
                selectedPaths.size > 1 ? (
                  <>
                    {workspaceEnv.kind === "ssh" && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() =>
                          void downloadRemoteFilesOrFolders(
                            workspaceEnv.connection,
                            Array.from(selectedPaths),
                          )
                        }
                      >
                        {t("explorer.downloadMultiple", {
                          count: selectedPaths.size,
                        })}
                      </ContextMenuItem>
                    )}
                    {workspaceEnv.kind === "ssh" && <ContextMenuSeparator />}
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() =>
                        void copyToClipboard(
                          Array.from(selectedPaths).join("\n"),
                        )
                      }
                    >
                      {t("explorer.copyPaths", {
                        count: selectedPaths.size,
                      })}
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() =>
                        void copyToClipboard(
                          Array.from(selectedPaths)
                            .map((p) => relativePath(rootPath, p))
                            .join("\n"),
                        )
                      }
                    >
                      {t("explorer.copyRelativePaths", {
                        count: selectedPaths.size,
                      })}
                    </ContextMenuItem>
                    {onAttachToAgent && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => {
                            for (const p of selectedPaths) onAttachToAgent(p);
                          }}
                        >
                          {t("explorer.attachMultiple", {
                            count: selectedPaths.size,
                          })}
                        </ContextMenuItem>
                      </>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      variant="destructive"
                      onSelect={() => requestDelete(Array.from(selectedPaths))}
                    >
                      {t("explorer.deleteMultiple", {
                        count: selectedPaths.size,
                      })}
                    </ContextMenuItem>
                  </>
                ) : (
                  <>
                    {!menuTarget.isDir && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onOpenFile(menuTarget.path, true)}
                      >
                        {isPreviewActive ? (
                          <>
                            <HugeiconsIcon
                              icon={Globe02Icon}
                              size={14}
                              strokeWidth={1.75}
                              className="mr-1.5 shrink-0 text-cyan-400"
                            />
                            {t("explorer.viewInBrowserPreview")}
                          </>
                        ) : (
                          t("common.open")
                        )}
                      </ContextMenuItem>
                    )}
                    {isPreviewActive && onOpenFileInEditor && !menuTarget.isDir && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onOpenFileInEditor(menuTarget.path, true)}
                      >
                        <HugeiconsIcon
                          icon={CodeIcon}
                          size={14}
                          strokeWidth={1.75}
                          className="mr-1.5 shrink-0 text-emerald-400"
                        />
                        {t("explorer.openInEditor")}
                      </ContextMenuItem>
                    )}
                    {!isPreviewActive &&
                      onOpenPreview &&
                      (!menuTarget.isDir
                        ? isWebPreviewablePath(menuTarget.path)
                        : true) && (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => onOpenPreview(menuTarget.path)}
                        >
                          <HugeiconsIcon
                            icon={Globe02Icon}
                            size={14}
                            strokeWidth={1.75}
                            className="mr-1.5 shrink-0 text-cyan-400"
                          />
                          {t("preview.openPreview")}
                        </ContextMenuItem>
                      )}
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => tree.beginRename(menuTarget.path)}
                    >
                      {t("common.rename")}
                    </ContextMenuItem>
                    {menuTarget.isDir && onRevealInTerminal && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onRevealInTerminal(menuTarget.path)}
                      >
                        {t("explorer.openInTerminal")}
                      </ContextMenuItem>
                    )}
                    {menuTarget.isDir && onOpenInSourceControl && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onOpenInSourceControl(menuTarget.path)}
                      >
                        {t("sidebar.sourceControl")}
                      </ContextMenuItem>
                    )}
                    {menuTarget.isDir && onOpenGitHistory && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onOpenGitHistory(menuTarget.path)}
                      >
                        {t("sidebar.gitHistory")}
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => void revealInFinder(menuTarget.path)}
                    >
                      {t("explorer.revealInFinder")}
                    </ContextMenuItem>
                    {workspaceEnv.kind === "ssh" && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() =>
                          void downloadRemoteFileOrFolder(
                            workspaceEnv.connection,
                            menuTarget.path,
                          )
                        }
                      >
                        {t("explorer.downloadToLocal")}
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() =>
                        tree.beginCreate(
                          menuTarget.isDir
                            ? menuTarget.path
                            : parentOf(menuTarget.path, rootPath),
                          "file",
                        )
                      }
                    >
                      {t("explorer.newFile")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() =>
                        tree.beginCreate(
                          menuTarget.isDir
                            ? menuTarget.path
                            : parentOf(menuTarget.path, rootPath),
                          "dir",
                        )
                      }
                    >
                      {t("explorer.newFolder")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => void copyToClipboard(menuTarget.path)}
                    >
                      {t("explorer.copyPath")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() =>
                        void copyToClipboard(relativePath(rootPath, menuTarget.path))
                      }
                    >
                      {t("explorer.copyRelativePath")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onAttachToAgent?.(menuTarget.path)}
                    >
                      {t("ai.composerAttach")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      variant="destructive"
                      onSelect={() => requestDelete([menuTarget.path])}
                    >
                      {t("explorer.delete")}
                    </ContextMenuItem>
                  </>
                )
              ) : (
                <>
                  {onRevealInTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onRevealInTerminal(rootPath)}
                    >
                      {t("explorer.openInTerminal")}
                    </ContextMenuItem>
                  )}
                  {onOpenInSourceControl && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenInSourceControl(rootPath)}
                    >
                      {t("sidebar.sourceControl")}
                    </ContextMenuItem>
                  )}
                  {onOpenGitHistory && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenGitHistory(rootPath)}
                    >
                      {t("sidebar.gitHistory")}
                    </ContextMenuItem>
                  )}
                  {onOpenPreview && rootPath && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenPreview(rootPath)}
                    >
                      <HugeiconsIcon
                        icon={Globe02Icon}
                        size={14}
                        strokeWidth={1.75}
                        className="mr-1.5 shrink-0 text-cyan-400"
                      />
                      {t("preview.openPreview")}
                    </ContextMenuItem>
                  )}
                  {hasGitRepo === false && rootPath && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={async () => {
                        try {
                          if (onInitGit) {
                            await onInitGit(rootPath);
                          }
                          toast.success(t("git.initRepoSuccess"));
                        } catch (err) {
                          toast.error(String(err));
                        }
                      }}
                    >
                      {t("git.initializeRepo")}
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void revealInFinder(rootPath)}
                  >
                    {t("explorer.revealInFinder")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.beginCreate(rootPath, "file")}
                  >
                    {t("explorer.newFile")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.beginCreate(rootPath, "dir")}
                  >
                    {t("explorer.newFolder")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void copyToClipboard(rootPath)}
                  >
                    {t("explorer.copyPath")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={handleRefreshCurrent}
                  >
                    {t("explorer.refresh")}
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : null}

        <AlertDialog
          open={deleteRequest !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteRequest(null);
          }}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteRequest?.paths.length === 1
                  ? t("explorer.deleteConfirmTitle")
                  : t("explorer.deleteMultiple", {
                      count: deleteRequest?.paths.length ?? 0,
                    })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteRequest?.paths.length === 1
                  ? t("explorer.deleteConfirmDesc", {
                      name: basename(deleteRequest.paths[0]),
                    })
                  : t("explorer.deleteMultipleConfirmDesc", {
                      count: deleteRequest?.paths.length ?? 0,
                    })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={confirmDelete}>
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {dnd.dragLabel && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={dnd.ghostRef}
                className="pointer-events-none fixed left-0 top-0 z-[99999] flex items-center gap-1.5 rounded-sm border border-border/70 bg-card/95 px-2 py-1 text-[12px] text-foreground shadow-md backdrop-blur-sm"
                style={{ willChange: "transform" }}
              >
                {dnd.dragLabel}
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }),
);
