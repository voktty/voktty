import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { tabGitSplitTarget } from "@/modules/surfaces/lib/tabGitSplitTarget";
import type { WorkspaceEnv } from "@/modules/workspace";

type Input = {
  tabs: readonly Tab[];
  selectedId: number;
  spaceId: string;
  limit: number;
  getTab: (id: number) => Tab | undefined;
  destination: (source: Tab) => unknown;
  hasRoom: (source: Tab, limit: number) => boolean;
  resolve: (
    path: string,
    workspace: WorkspaceEnv,
  ) => Promise<{
    repoRoot: string;
    branch?: string | null;
  } | null>;
  open: (input: {
    repoRoot: string;
    branch?: string | null;
    workspaceEnv: WorkspaceEnv;
    spaceId: string;
    activate: false;
  }) => number;
  join: (source: Tab, target: Tab, limit: number) => boolean;
  activate: (id: number) => void;
  onFull: () => void;
  onMissing: () => void;
  onError: (error: unknown) => void;
};

export function useTabGitSplit(input: Input) {
  const selectedKey = input.tabs.find(
    (tab) => tab.id === input.selectedId,
  )?.tabKey;
  const { spaceId, limit } = input;
  const binding = useMemo(
    () => ({ selectedKey, spaceId, limit }),
    [selectedKey, spaceId, limit],
  );
  const owner = useRef<{ binding: typeof binding; current: boolean } | null>(
    null,
  );
  const latest = useRef(input);
  type Request = { current: () => boolean; retired: boolean };
  const pending = useRef(new Set<Request>());
  useLayoutEffect(() => {
    latest.current = input;
  });
  useLayoutEffect(() => {
    const receipt = { binding, current: true };
    owner.current = receipt;
    return () => {
      receipt.current = false;
    };
  }, [binding]);
  const retireRequests = useCallback(() => {
    for (const request of pending.current) {
      if (!request.current()) request.retired = true;
    }
  }, []);
  useLayoutEffect(retireRequests);
  useLayoutEffect(() => useSpaces.subscribe(retireRequests), [retireRequests]);

  return useCallback(
    async (sourceId?: number) => {
      const receipt = owner.current;
      if (!receipt?.current || receipt.binding !== binding) return;
      const original = input.tabs.find(
        (tab) => tab.id === (sourceId ?? input.selectedId),
      );
      if (!original) return;
      const sourceSpace = useSpaces
        .getState()
        .spaces.find((space) => space.id === original.spaceId);
      const target = tabGitSplitTarget(original, sourceSpace);
      if (!target) return;
      const destination = input.destination(original);
      const workspaceSelection = useSpaces.getState().activeId;
      const request: Request = {
        retired: false,
        current: () => {
          if (request.retired || !receipt.current) return false;
          const state = latest.current;
          const live = state.getTab(original.id);
          if (
            !live ||
            live.tabKey !== original.tabKey ||
            live.spaceId !== original.spaceId ||
            live.kind !== original.kind
          )
            return false;
          const liveSpace = useSpaces
            .getState()
            .spaces.find((space) => space.id === live.spaceId);
          const current = tabGitSplitTarget(live, liveSpace);
          return (
            Boolean(liveSpace) === Boolean(sourceSpace) &&
            liveSpace?.root === sourceSpace?.root &&
            liveSpace?.env === sourceSpace?.env &&
            current?.path === target.path &&
            current.workspace === target.workspace &&
            useSpaces.getState().activeId === workspaceSelection &&
            state.destination(live) === destination
          );
        },
      };
      if (!request.current()) return;
      if (!input.hasRoom(original, limit)) {
        input.onFull();
        return;
      }
      if (pending.current.size >= 256) return;
      pending.current.add(request);
      try {
        const repo = await input.resolve(target.path, target.workspace);
        if (!request.current()) return;
        if (!repo) {
          input.onMissing();
          return;
        }
        if (!latest.current.hasRoom(original, limit)) {
          input.onFull();
          return;
        }
        const id = input.open({
          ...repo,
          workspaceEnv: target.workspace,
          spaceId: original.spaceId,
          activate: false,
        });
        if (!request.current()) return;
        const graph = input.getTab(id);
        if (
          graph &&
          graph.id !== original.id &&
          input.join(original, graph, limit) &&
          receipt.current &&
          useSpaces.getState().activeId === workspaceSelection &&
          input.getTab(original.id)?.tabKey === original.tabKey &&
          input.getTab(graph.id)?.tabKey === graph.tabKey
        )
          input.activate(id);
      } catch (error) {
        if (request.current()) input.onError(error);
      } finally {
        pending.current.delete(request);
      }
    },
    [binding, input, limit],
  );
}
