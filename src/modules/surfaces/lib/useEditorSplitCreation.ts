import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Tab, OpenFileTabOptions } from "@/modules/tabs/lib/useTabs";
import { tabDirectoryTarget } from "@/modules/surfaces/lib/tabDirectoryTarget";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { getTabPath } from "@/modules/tabs/lib/tabMetadata";

type Input = {
  tabs: readonly Tab[];
  selectedId: number;
  spaceId: string;
  limit: number;
  getTab: (id: number) => Tab | undefined;
  destination: (tab: Tab) => unknown;
  hasRoom: (tab: Tab, limit: number) => boolean;
  open: (path: string, pin: boolean, options: OpenFileTabOptions) => number;
  join: (source: Tab, target: Tab, limit: number) => boolean;
  activate: (id: number) => void;
  onFull: () => void;
};

export function useEditorSplitCreation(input: Input) {
  const selectedKey = input.tabs.find(
    (tab) => tab.id === input.selectedId,
  )?.tabKey;
  const { spaceId, limit } = input;
  const binding = useMemo(
    () => ({ selectedKey, spaceId, limit }),
    [selectedKey, spaceId, limit],
  );
  const owner = useRef<{ current: boolean; binding: typeof binding } | null>(
    null,
  );
  const latest = useRef(input);
  type Request = {
    target: NonNullable<ReturnType<typeof tabDirectoryTarget>>;
    current: () => boolean;
    complete: (path: string) => void;
  };
  const active = useRef<Request | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  useLayoutEffect(() => {
    latest.current = input;
  });
  useLayoutEffect(() => {
    const receipt = { current: true, binding };
    owner.current = receipt;
    return () => {
      receipt.current = false;
    };
  }, [binding]);
  const retire = useCallback(() => {
    const current = active.current;
    if (current && !current.current()) {
      active.current = null;
      setRequest(null);
    }
  }, []);
  useLayoutEffect(retire);
  useLayoutEffect(() => useSpaces.subscribe(retire), [retire]);
  const openEditorSplit = useCallback(
    (sourceId?: number) => {
      const receipt = owner.current;
      if (!receipt?.current || receipt.binding !== binding) return;
      const source = input.tabs.find(
        (tab) => tab.id === (sourceId ?? input.selectedId),
      );
      if (!source) return;
      const space = useSpaces
        .getState()
        .spaces.find((space) => space.id === source.spaceId);
      const target = tabDirectoryTarget(source, space);
      if (!target || !/^(?:[A-Za-z]:[/\\]|[/\\]|remote:\/\/)/.test(target.path))
        return;
      if (!input.hasRoom(source, limit)) {
        input.onFull();
        return;
      }
      const destination = input.destination(source);
      const selection = useSpaces.getState().activeId;
      const current: Request = {
        target,
        current: () => {
          if (active.current !== current || !receipt.current) return false;
          const state = latest.current;
          const live = state.getTab(source.id);
          if (
            !live ||
            live.tabKey !== source.tabKey ||
            live.kind !== source.kind ||
            live.spaceId !== source.spaceId ||
            getTabPath(live) !== getTabPath(source) ||
            (source.kind === "terminal" &&
              (live.kind !== "terminal" ||
                live.activeLeafId !== source.activeLeafId))
          )
            return false;
          const liveSpace = useSpaces
            .getState()
            .spaces.find((space) => space.id === source.spaceId);
          const liveTarget = tabDirectoryTarget(live, liveSpace);
          return (
            Boolean(space) === Boolean(liveSpace) &&
            space?.root === liveSpace?.root &&
            space?.env === liveSpace?.env &&
            liveTarget?.path === target.path &&
            liveTarget.workspace === target.workspace &&
            useSpaces.getState().activeId === selection &&
            state.destination(live) === destination
          );
        },
        complete: (path) => {
          if (!current.current()) return;
          if (!latest.current.hasRoom(source, limit)) {
            input.onFull();
            return;
          }
          const id = input.open(path, true, {
            spaceId: source.spaceId,
            workspaceEnv: target.workspace,
            activate: false,
          });
          if (!current.current()) return;
          const created = input.getTab(id);
          if (!created || created.id === source.id) return;
          const joined = input.join(source, created, limit);
          const noSuccessor =
            active.current === null || active.current === current;
          if (active.current === current) {
            active.current = null;
            setRequest(null);
          }
          if (
            joined &&
            noSuccessor &&
            receipt.current &&
            useSpaces.getState().activeId === selection &&
            input.getTab(source.id)?.tabKey === source.tabKey &&
            input.getTab(created.id)?.tabKey === created.tabKey
          )
            input.activate(id);
        },
      };
      active.current = current;
      setRequest(current);
      return current;
    },
    [binding, input, limit],
  );
  const close = useCallback((original: Request) => {
    if (active.current !== original) return;
    active.current = null;
    setRequest(null);
  }, []);
  return { openEditorSplit, request, close };
}
