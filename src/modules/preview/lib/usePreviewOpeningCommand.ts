import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  previewOpeningFilesystem,
  previewOpeningTarget,
  type PreviewOpeningAction,
} from "@/modules/preview/lib/previewOpeningTarget";

type Input = {
  source: Tab | undefined;
  space: { root: string | null; env: WorkspaceEnv } | undefined;
  root: string | null;
  workspace: WorkspaceEnv;
  hasRoom: boolean;
  open: PreviewOpeningAction;
};

export function usePreviewOpeningCommand({
  source,
  space,
  root,
  workspace,
  hasRoom,
  open,
}: Input) {
  const filesystem = previewOpeningFilesystem(source, root, workspace);
  const target = previewOpeningTarget(
    "",
    source,
    { root: space?.root ?? root, env: space?.env ?? workspace },
    filesystem,
  );
  const spaceRoot = space?.root;
  const spaceEnv = space?.env;
  const filesystemRoot = filesystem?.root;
  const filesystemEnv = filesystem?.workspace;
  const targetRoot = target?.kind === "server" ? target.root : null;
  const targetFile = target?.kind === "server" ? target.file : undefined;
  const sourceId = source?.id;
  const sourceKey = source?.tabKey;
  const sourceSpace = source?.spaceId;
  const sourceKind = source?.kind;
  const sourcePath = source && "path" in source ? source.path : undefined;
  const sourceEnv =
    source && "workspaceEnv" in source ? source.workspaceEnv : undefined;
  const sourceLeaf =
    source?.kind === "terminal" ? source.activeLeafId : undefined;
  const latestSource = useRef(source);
  useLayoutEffect(() => {
    latestSource.current = source;
  });
  const disabledReason =
    targetRoot === null
      ? "editor.status.previewNotSupported"
      : !hasRoom
        ? "spaces.maxSlots"
        : undefined;
  const binding = useMemo(() => {
    return {
      sourceId,
      sourceKey,
      sourceSpace,
      sourceKind,
      sourcePath,
      sourceEnv,
      sourceLeaf,
      filesystem: filesystemEnv
        ? { root: filesystemRoot ?? null, workspace: filesystemEnv }
        : undefined,
      targetRoot,
      open,
      spaceRoot,
      spaceEnv,
      targetFile,
    };
  }, [
    sourceId,
    sourceKey,
    sourceSpace,
    sourceKind,
    sourcePath,
    sourceEnv,
    sourceLeaf,
    spaceRoot,
    spaceEnv,
    filesystemRoot,
    filesystemEnv,
    targetRoot,
    targetFile,
    open,
  ]);
  const publication = useMemo(
    () => ({ binding, disabledReason }),
    [binding, disabledReason],
  );
  const owner = useRef<object | null>(null);
  const published = useRef<object | null>(null);
  useLayoutEffect(() => {
    published.current = publication;
    return () => {
      if (published.current === publication) published.current = null;
    };
  }, [publication]);
  useLayoutEffect(() => {
    owner.current = binding;
    return () => {
      if (owner.current === binding) owner.current = null;
    };
  }, [binding]);
  const run = useCallback(() => {
    const current = () => owner.current === binding;
    if (
      !current() ||
      published.current !== publication ||
      publication.disabledReason
    )
      return;
    // The admitted opening may fill the last slot itself; source retirement still cancels delivery.
    return binding.open("", {
      source: latestSource.current,
      filesystem: binding.filesystem,
      current,
    });
  }, [binding, publication]);
  return { run, disabledReason };
}
