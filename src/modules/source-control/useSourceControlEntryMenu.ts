import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IS_WINDOWS } from "@/lib/platform";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import { isNativeFolderPath } from "@/modules/explorer/lib/nativeFolderSelection";
import type { SourceControlFileEntry } from "@/modules/source-control/useSourceControlPanel";
import {
  nativeFileActionPath,
  resolveFileActionPath,
} from "@/modules/surfaces/lib/fileActionTarget";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

export type SourceControlFileOpening = (
  path: string,
  pin?: boolean,
  options?: { workspaceEnv: WorkspaceEnv },
) => void;

export function useSourceControlEntryMenu({
  entry,
  repoRoot,
  contextKey,
  actionBusy,
  onFocusRow,
  onSelectFile,
  onToggleStageFile,
  onDiscardFile,
  onOpenFile,
  onOpenProjectFile,
}: {
  entry: SourceControlFileEntry;
  repoRoot: string | null;
  contextKey: string;
  actionBusy: string | null;
  onFocusRow: (key: string | null) => void;
  onSelectFile: (entry: SourceControlFileEntry) => Promise<void>;
  onToggleStageFile: (entry: SourceControlFileEntry) => Promise<void>;
  onDiscardFile: (entry: SourceControlFileEntry) => void;
  onOpenFile?: SourceControlFileOpening;
  onOpenProjectFile?: (path: string) => void;
}) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const filesystem = JSON.stringify(workspace);
  const entryKey = JSON.stringify(entry);
  const file = useMemo<SourceControlFileEntry>(
    () => Object.freeze(JSON.parse(entryKey)),
    [entryKey],
  );
  const target = JSON.stringify([repoRoot, contextKey, entryKey]);
  const [epoch, setEpoch] = useState(0);
  const epochRef = useRef(0);
  const binding = useMemo(
    () => ({
      key: crypto.randomUUID(),
      target,
      filesystem,
      epoch,
      actionBusy,
      onFocusRow,
      onSelectFile,
      onToggleStageFile,
      onDiscardFile,
      onOpenFile,
      onOpenProjectFile,
    }),
    [
      target,
      filesystem,
      epoch,
      actionBusy,
      onFocusRow,
      onSelectFile,
      onToggleStageFile,
      onDiscardFile,
      onOpenFile,
      onOpenProjectFile,
    ],
  );
  type Owner = { binding: typeof binding; live: boolean };
  type Menu = { owner: Owner; live: boolean };
  const current = useRef<Owner | null>(null);
  const currentMenu = useRef<Menu | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  useLayoutEffect(() => {
    let previous = JSON.stringify(useWorkspaceEnvStore.getState().env);
    return useWorkspaceEnvStore.subscribe((state) => {
      const next = JSON.stringify(state.env);
      if (next !== previous) {
        epochRef.current++;
        setEpoch(epochRef.current);
      }
      previous = next;
    });
  }, []);
  useLayoutEffect(() => {
    const owner: Owner = { binding, live: true };
    current.current = owner;
    return () => {
      owner.live = false;
      if (currentMenu.current?.owner === owner) {
        currentMenu.current.live = false;
        currentMenu.current = null;
      }
    };
  }, [binding]);
  const owns = useCallback(
    (owner: Owner) =>
      owner.live &&
      current.current === owner &&
      owner.binding === binding &&
      binding.epoch === epochRef.current &&
      binding.filesystem ===
        JSON.stringify(useWorkspaceEnvStore.getState().env),
    [binding],
  );
  const ownsMenu = (capture: Menu) =>
    capture.live && currentMenu.current === capture && owns(capture.owner);
  const setOpen = (open: boolean) => {
    const owner = current.current;
    if (!owner || !owns(owner)) return;
    if (open) {
      if (currentMenu.current?.live) return;
      const next: Menu = { owner, live: true };
      currentMenu.current = next;
      setMenu((previous) =>
        owns(owner) && currentMenu.current === next && next.live
          ? next
          : previous,
      );
    } else if (menu && ownsMenu(menu)) {
      menu.live = false;
      currentMenu.current = null;
      setMenu((previous) => (previous === menu ? null : previous));
    }
  };
  const run = (action: (isCurrent: () => boolean) => void) => {
    if (!menu || !ownsMenu(menu)) return;
    menu.live = false;
    currentMenu.current = null;
    setMenu((previous) => (previous === menu ? null : previous));
    const isCurrent = () => owns(menu.owner);
    if (isCurrent()) action(isCurrent);
  };
  const absolutePath = repoRoot
    ? resolveFileActionPath(
        file.path.replace(/\\/g, "/"),
        repoRoot.replace(/\\/g, "/"),
      )
    : null;
  const nativePath = absolutePath
    ? nativeFileActionPath(absolutePath, workspace, IS_WINDOWS)
    : null;
  const isDeleted = file.statusCode === "D";
  const canOpenNative =
    !isDeleted &&
    !!absolutePath &&
    isNativeFolderPath(absolutePath) &&
    workspace.kind !== "docker" &&
    workspace.kind !== "serial";
  const projectNamespace =
    !!absolutePath &&
    absolutePath.length <= 32768 &&
    !/[\x00-\x1f\x7f]/.test(absolutePath) &&
    /^remote:\/\/[^/]+\/.+/.test(absolutePath);
  const canOpenProject =
    !isDeleted &&
    !!absolutePath &&
    (projectNamespace ||
      (isNativeFolderPath(absolutePath) &&
        (workspace.kind === "local" || !!nativePath)));
  const canOpen =
    (!!onOpenProjectFile && canOpenProject) || (!!onOpenFile && canOpenNative);
  return {
    key: binding.key,
    setOpen,
    absolutePath,
    canOpen,
    canReveal: !isDeleted && !!nativePath,
    diff: () =>
      run((isCurrent) => {
        onFocusRow(file.key);
        if (isCurrent()) void onSelectFile({ ...file });
      }),
    openFile: () =>
      run(() => {
        if (!absolutePath) return;
        if (onOpenProjectFile && canOpenProject)
          onOpenProjectFile(absolutePath);
        else if (onOpenFile && canOpenNative)
          onOpenFile(absolutePath, true, {
            workspaceEnv: JSON.parse(binding.filesystem),
          });
      }),
    stage: () =>
      run(() => {
        if (!actionBusy) void onToggleStageFile({ ...file });
      }),
    discard: () =>
      run(() => {
        if (!actionBusy && file.unstaged) onDiscardFile({ ...file });
      }),
    copyRelative: () =>
      run(() => {
        void copyToClipboard(file.path.replace(/\\/g, "/"));
      }),
    copyAbsolute: () =>
      run(() => {
        if (absolutePath) void copyToClipboard(absolutePath);
      }),
    reveal: () =>
      run(() => {
        if (!isDeleted && nativePath) void revealInFinder(nativePath);
      }),
  };
}
