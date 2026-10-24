import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { tabDirectoryTarget } from "@/modules/surfaces/lib/tabDirectoryTarget";
import { previewTargetUrl } from "@/modules/surfaces/lib/tabPreviewTarget";
import {
  previewOpeningTarget,
  previewOpeningFilesystem,
  type PreviewOpeningOptions,
} from "@/modules/preview/lib/previewOpeningTarget";

type Input = {
  tabs: readonly Tab[];
  selectedId: number;
  spaceId: string;
  root: string | null;
  workspace: WorkspaceEnv;
  limit: number;
  getTab: (id: number) => Tab | undefined;
  destination: (tab: Tab) => unknown;
  hasRoom: (tab: Tab, limit: number) => boolean;
  start: (root: string) => Promise<{ url: string }>;
  open: (url: string, options: { spaceId: string; activate: false }) => number;
  join: (source: Tab, preview: Tab, limit: number) => boolean;
  activate: (id: number) => void;
  onFull: () => void;
  onUnavailable: () => void;
  onError: () => void;
};

export function usePreviewOpening(input: Input) {
  const selectedKey = input.tabs.find(
    (tab) => tab.id === input.selectedId,
  )?.tabKey;
  const { spaceId, root, workspace, limit } = input;
  const binding = useMemo(
    () => ({ selectedKey, spaceId, limit }),
    [selectedKey, spaceId, limit],
  );
  const context = useMemo(() => ({ root, workspace }), [root, workspace]);
  const contextOwner = useRef<object | null>(null);
  const owner = useRef<object | null>(null);
  const latest = useRef(input);
  type Request = { retired: boolean; current: () => boolean };
  const pending = useRef(new Set<Request>());
  useLayoutEffect(() => {
    latest.current = input;
  });
  useLayoutEffect(() => {
    contextOwner.current = context;
    return () => {
      if (contextOwner.current === context) contextOwner.current = null;
    };
  }, [context]);
  useLayoutEffect(() => {
    owner.current = binding;
    return () => {
      if (owner.current === binding) owner.current = null;
    };
  }, [binding]);
  const retire = useCallback(() => {
    for (const request of pending.current)
      if (!request.current()) request.retired = true;
  }, []);
  useLayoutEffect(retire);
  useLayoutEffect(() => useSpaces.subscribe(retire), [retire]);

  return useCallback(
    async (target = "", options: PreviewOpeningOptions = {}) => {
      const state = latest.current;
      if (owner.current !== binding || pending.current.size >= 256) return;
      const original = options.source ?? state.getTab(state.selectedId);
      if (options.source && state.getTab(options.source.id) !== options.source)
        return;
      const sourceSpace = useSpaces
        .getState()
        .spaces.find((space) => space.id === (original?.spaceId ?? spaceId));
      const sourceTarget = original
        ? tabDirectoryTarget(original, sourceSpace)
        : null;
      const filesystem = previewOpeningFilesystem(
        original,
        state.root,
        state.workspace,
        options.filesystem,
      );
      const split = options.splitWithActive ?? true;
      const callerCurrent = options.current;
      const capturedContext = contextOwner.current;
      const usesContext = Boolean(filesystem) || !sourceTarget;
      const destination = original ? state.destination(original) : null;
      const selection = useSpaces.getState().activeId;
      const sourceCurrent = () => {
        if (
          owner.current !== binding ||
          callerCurrent?.() === false ||
          useSpaces.getState().activeId !== selection
        )
          return false;
        if (usesContext && contextOwner.current !== capturedContext)
          return false;
        const currentSpace = useSpaces
          .getState()
          .spaces.find((space) => space.id === (original?.spaceId ?? spaceId));
        if (
          Boolean(currentSpace) !== Boolean(sourceSpace) ||
          currentSpace?.root !== sourceSpace?.root ||
          currentSpace?.env !== sourceSpace?.env
        )
          return false;
        if (!original)
          return latest.current.getTab(state.selectedId) === undefined;
        const live = latest.current.getTab(original.id);
        if (
          !live ||
          live.tabKey !== original.tabKey ||
          live.kind !== original.kind ||
          live.spaceId !== original.spaceId
        )
          return false;
        if (
          original.kind === "terminal" &&
          (live.kind !== "terminal" ||
            live.activeLeafId !== original.activeLeafId)
        )
          return false;
        if (
          "path" in original &&
          (!("path" in live) || live.path !== original.path)
        )
          return false;
        const projected = tabDirectoryTarget(live, currentSpace);
        return (
          projected?.path === sourceTarget?.path &&
          projected?.workspace === sourceTarget?.workspace
        );
      };
      const request: Request = {
        retired: false,
        current: () =>
          !request.retired &&
          sourceCurrent() &&
          (!original || latest.current.destination(original) === destination),
      };
      if (!request.current()) return;
      const plan = previewOpeningTarget(
        target,
        original,
        sourceSpace
          ? { root: sourceSpace.root ?? state.root, env: sourceSpace.env }
          : { root: state.root, env: state.workspace },
        filesystem,
      );
      if (!plan) {
        state.onUnavailable();
        return;
      }
      if (split && original && !state.hasRoom(original, limit)) {
        state.onFull();
        return;
      }
      if (!request.current()) return;
      pending.current.add(request);
      try {
        const url =
          plan.kind === "url"
            ? plan.url
            : previewTargetUrl((await state.start(plan.root)).url, plan.file);
        if (!request.current()) return;
        if (split && original && !latest.current.hasRoom(original, limit)) {
          state.onFull();
          return;
        }
        if (!request.current()) return;
        const id = state.open(url, {
          spaceId: original?.spaceId ?? spaceId,
          activate: false,
        });
        if (!request.current()) return id;
        const created = state.getTab(id);
        if (!created) return id;
        const joined =
          !split || !original || state.join(original, created, limit);
        // Joining replaces the destination receipt; the original source still gates activation.
        if (
          joined &&
          sourceCurrent() &&
          state.getTab(created.id)?.tabKey === created.tabKey
        )
          state.activate(id);
        return id;
      } catch {
        if (request.current()) state.onError();
      } finally {
        pending.current.delete(request);
      }
    },
    [binding, spaceId, limit],
  );
}
