import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  spaceId: string;
  selectedKey: string | null;
  root: string | null;
  workspace: WorkspaceEnv;
  create: (path: string, workspace: WorkspaceEnv, spaceId: string) => void;
  openProject: (
    path: string,
    options: { isCurrent: () => boolean },
  ) => Promise<unknown>;
  onError: () => void;
};

export function useDirectoryTerminalOpening({
  spaceId,
  selectedKey,
  root,
  workspace,
  create,
  openProject,
  onError,
}: Props) {
  const workspaceKey = JSON.stringify(workspace);
  const binding = useMemo(
    () => ({
      spaceId,
      selectedKey,
      root,
      workspaceKey,
      create,
      openProject,
      onError,
    }),
    [spaceId, selectedKey, root, workspaceKey, create, openProject, onError],
  );
  const owner = useRef<{ binding: typeof binding; current: boolean } | null>(
    null,
  );
  const revision = useRef(0);
  useLayoutEffect(() => {
    const receipt = { binding, current: true };
    owner.current = receipt;
    let selection = useSpaces.getState().activeId;
    const spaceContext = () => {
      const space = useSpaces
        .getState()
        .spaces.find((space) => space.id === spaceId);
      return space
        ? JSON.stringify([space.createdAt, space.root, space.env])
        : null;
    };
    let incarnation = spaceContext();
    const stop = useSpaces.subscribe((state) => {
      const nextIncarnation = spaceContext();
      if (state.activeId !== selection || incarnation !== nextIncarnation)
        revision.current++;
      selection = state.activeId;
      incarnation = nextIncarnation;
    });
    return () => {
      receipt.current = false;
      stop();
    };
  }, [binding]);
  return useCallback(
    async (path: string) => {
      const receipt = owner.current;
      if (!receipt?.current || receipt.binding !== binding) return;
      const selection = useSpaces.getState().activeId;
      const capturedRevision = revision.current;
      const current = () =>
        receipt.current &&
        owner.current === receipt &&
        revision.current === capturedRevision &&
        useSpaces.getState().activeId === selection &&
        useSpaces.getState().spaces.some((space) => space.id === spaceId) &&
        (selection === null || selection === spaceId);
      if (!current()) return;
      if (
        !path ||
        path.length > 32768 ||
        /[\x00-\x1f\x7f]/.test(path) ||
        (root?.startsWith("remote://") && !path.startsWith("remote://")) ||
        (workspace.kind === "serial" && !path.startsWith("remote://"))
      ) {
        onError();
        return;
      }
      try {
        if (path.startsWith("remote://"))
          await openProject(path, { isCurrent: current });
        else create(path, workspace, spaceId);
      } catch {
        if (current()) onError();
      }
    },
    [binding, spaceId, root, workspace, create, openProject, onError],
  );
}
