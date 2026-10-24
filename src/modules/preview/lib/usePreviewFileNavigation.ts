import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { PreviewTab, Tab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { WebServerInfo } from "@/modules/preview/store/webServerStore";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { previewFileNavigation } from "@/modules/preview/lib/previewFileNavigation";

type Input = {
  tabs: readonly Tab[];
  selectedId: number;
  root: string | null;
  workspace: WorkspaceEnv;
  getTab: (id: number) => Tab | undefined;
  servers: () => readonly WebServerInfo[];
  start: (root: string) => Promise<WebServerInfo>;
  update: (tab: PreviewTab, url: string, current: () => boolean) => void;
  reload: (id: number) => void;
  onError: () => void;
  onUnavailable: () => void;
};

export function usePreviewFileNavigation(input: Input) {
  const selectedKey = input.tabs.find(
    (tab) => tab.id === input.selectedId,
  )?.tabKey;
  const binding = useMemo(
    () => ({ selectedKey, root: input.root, workspace: input.workspace }),
    [selectedKey, input.root, input.workspace],
  );
  const owner = useRef<object | null>(null);
  const latest = useRef(input);
  type Request = { current: () => boolean; retired: boolean };
  const pending = useRef(new Set<Request>());
  const newest = useRef<Request | null>(null);
  useLayoutEffect(() => {
    latest.current = input;
  });
  useLayoutEffect(() => {
    owner.current = binding;
    return () => {
      if (owner.current === binding) owner.current = null;
    };
  }, [binding]);
  const retire = useCallback(() => {
    if (newest.current && !newest.current.current())
      newest.current.retired = true;
    for (const request of pending.current)
      if (!request.current()) request.retired = true;
  }, []);
  useLayoutEffect(retire);
  useLayoutEffect(() => useSpaces.subscribe(retire), [retire]);

  return useCallback(
    async (id: number, path: string) => {
      if (
        owner.current !== binding ||
        id !== input.selectedId ||
        pending.current.size >= 256
      )
        return;
      const original = input.getTab(id);
      if (original?.kind !== "preview") return;
      const workspaceSelection = useSpaces.getState().activeId;
      const sourceSpace = useSpaces
        .getState()
        .spaces.find((space) => space.id === original.spaceId);
      const request: Request = {
        retired: false,
        current: () => {
          const live = latest.current.getTab(id);
          const liveSpace = useSpaces
            .getState()
            .spaces.find((space) => space.id === original.spaceId);
          return (
            !request.retired &&
            owner.current === binding &&
            newest.current === request &&
            Boolean(liveSpace) === Boolean(sourceSpace) &&
            liveSpace?.root === sourceSpace?.root &&
            liveSpace?.env === sourceSpace?.env &&
            useSpaces.getState().activeId === workspaceSelection &&
            live?.tabKey === original.tabKey &&
            live.kind === "preview" &&
            live.url === original.url &&
            live.spaceId === original.spaceId
          );
        },
      };
      if (newest.current) newest.current.retired = true;
      newest.current = request;
      pending.current.add(request);
      try {
        const plan = previewFileNavigation(
          path,
          input.root,
          input.workspace,
          input.servers(),
          original.url,
        );
        if (!request.current()) return;
        if (!plan) {
          input.onUnavailable();
          return;
        }
        const url =
          plan.kind === "navigate"
            ? plan.url
            : `${(await input.start(plan.root)).url}/${plan.relative}`;
        if (!request.current()) return;
        if (original.url === url) input.reload(id);
        else input.update(original, url, request.current);
      } catch {
        if (request.current()) input.onError();
      } finally {
        pending.current.delete(request);
      }
    },
    [binding, input],
  );
}
