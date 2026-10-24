import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { tabPreviewTarget } from "@/modules/surfaces/lib/tabPreviewTarget";
import type { WorkspaceEnv } from "@/modules/workspace";
import { previewTargetUrl } from "@/modules/surfaces/lib/tabPreviewTarget";

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
    url: string;
  } | null>;
  open: (url: string, options: { spaceId: string; activate: false }) => number;
  join: (source: Tab, target: Tab, limit: number) => boolean;
  activate: (id: number) => void;
  onFull: () => void;
  onError: (error: unknown) => void;
};

export function useTabPreviewSplit(input: Input) {
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
      const target = tabPreviewTarget(original, sourceSpace);
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
          const current = tabPreviewTarget(live, liveSpace);
          return (
            Boolean(liveSpace) === Boolean(sourceSpace) &&
            liveSpace?.root === sourceSpace?.root &&
            liveSpace?.env === sourceSpace?.env &&
            current?.path === target.path &&
            current?.file === target.file &&
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
        if (!request.current()) return;
        const server = await input.resolve(target.path, target.workspace);
        if (!request.current()) return;
        if (!server) return;
        if (!latest.current.hasRoom(original, limit)) {
          input.onFull();
          return;
        }
        if (!request.current()) return;
        const id = input.open(previewTargetUrl(server.url, target.file), {
          spaceId: original.spaceId,
          activate: false,
        });
        if (!request.current()) return;
        const preview = input.getTab(id);
        if (
          preview &&
          preview.id !== original.id &&
          input.join(original, preview, limit) &&
          receipt.current &&
          useSpaces.getState().activeId === workspaceSelection &&
          input.getTab(original.id)?.tabKey === original.tabKey &&
          input.getTab(preview.id)?.tabKey === preview.tabKey
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
