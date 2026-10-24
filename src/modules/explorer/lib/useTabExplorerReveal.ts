import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { FileExplorerHandle } from "@/modules/explorer/FileExplorer";
import {
  explorerCanReveal,
  matchesTabExplorerTarget,
  tabExplorerTarget,
  type TabExplorerTarget,
} from "@/modules/explorer/lib/tabExplorerTarget";
import { parentPath } from "@/modules/explorer/lib/path";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { useTranslation } from "@/modules/i18n";
import { toast } from "sonner";

type Input = {
  tabs: readonly Tab[];
  spaceId: string;
  selectedTabKey: Tab["tabKey"] | null;
  root: string | null;
  workspace: WorkspaceEnv;
  ready: boolean;
  explorerRef: RefObject<FileExplorerHandle | null>;
  openExplorer: () => void;
};

export function useTabExplorerReveal(input: Input) {
  const { t } = useTranslation();
  const spaces = useSpaces((state) => state.spaces);
  const { spaceId, selectedTabKey, root, workspace } = input;
  const context = useMemo(
    () => ({ spaceId, selectedTabKey, root, workspace }),
    [spaceId, selectedTabKey, root, workspace],
  );
  const owner = useRef<{ context: typeof context } | null>(null);
  const latest = useRef({ input, spaces, t });
  useLayoutEffect(() => {
    latest.current = { input, spaces, t };
  });
  type Request = {
    owner: object;
    target: TabExplorerTarget;
    context: typeof context;
    wasReady: boolean;
    workspaceSelection: string | null;
  };
  const active = useRef<Request | null>(null);
  const [pending, setPending] = useState<Request | null>(null);
  useLayoutEffect(() => {
    const receipt = { context };
    owner.current = receipt;
    return () => {
      if (owner.current !== receipt) return;
      owner.current = null;
      active.current = null;
    };
  }, [context]);
  useLayoutEffect(() => {
    if (input.ready && active.current) active.current.wasReady = true;
    else if (active.current?.wasReady) active.current = null;
  }, [input.ready]);

  const isCurrent = useCallback((request: Request) => {
    if (owner.current !== request.owner || active.current !== request)
      return false;
    if (useSpaces.getState().activeId !== request.workspaceSelection)
      return false;
    const state = latest.current;
    return matchesTabExplorerTarget(
      request.target,
      state.input.tabs,
      state.spaces,
    );
  }, []);
  useLayoutEffect(() => {
    const request = active.current;
    if (
      request &&
      !matchesTabExplorerTarget(request.target, input.tabs, spaces)
    )
      active.current = null;
  }, [input.tabs, spaces]);

  const revealTab = useCallback(
    (tab: Tab) => {
      const state = latest.current;
      const current = state.input.tabs.find(
        (candidate) =>
          candidate.id === tab.id && candidate.tabKey === tab.tabKey,
      );
      const owningWorkspace = state.spaces.find(
        (space) => space.id === tab.spaceId,
      )?.env;
      const target = tabExplorerTarget(tab, owningWorkspace);
      const live = current && tabExplorerTarget(current, owningWorkspace);
      const receipt = owner.current;
      if (
        !receipt ||
        receipt.context !== context ||
        !target ||
        live?.path !== target.path ||
        live.workspace !== target.workspace ||
        live.spaceId !== target.spaceId ||
        live.directory !== target.directory
      )
        return;
      const request = {
        owner: receipt,
        target,
        context,
        wasReady: state.input.ready,
        workspaceSelection: useSpaces.getState().activeId,
      };
      active.current = request;
      setPending(request);
      try {
        state.input.openExplorer();
      } catch {
        if (active.current === request) {
          const report = isCurrent(request);
          active.current = null;
          setPending((value) => (value === request ? null : value));
          if (report) toast.error(state.t("feedback.somethingWentWrong"));
        }
      }
    },
    [context, isCurrent],
  );

  useEffect(() => {
    if (!pending || !input.ready) return;
    const request = pending;
    const guard = () => isCurrent(request);
    if (request.context !== context || !guard()) {
      setPending((value) => (value === request ? null : value));
      return;
    }
    const offerFolder = () => {
      if (!guard()) {
        setPending((value) => (value === request ? null : value));
        return;
      }
      const state = latest.current;
      toast.info(state.t("explorer.fileOutsideWorkspace"), {
        action: {
          label: state.t("explorer.openContainingFolder"),
          onClick: () => {
            if (!guard()) return;
            const targetRoot = request.target.directory
              ? request.target.path
              : parentPath(request.target.path);
            const spacesState = useSpaces.getState();
            spacesState.setRoot(request.context.spaceId, targetRoot);
            if (!guard()) return;
            spacesState.setEnv(
              request.context.spaceId,
              request.target.workspace,
            );
            if (!guard()) return;
            useWorkspaceEnvStore.getState().setEnv(request.target.workspace);
          },
        },
      });
    };
    const frame = requestAnimationFrame(() => {
      if (!guard()) {
        setPending((value) => (value === request ? null : value));
        return;
      }
      const state = latest.current;
      if (
        !explorerCanReveal(
          request.target,
          request.context.root,
          request.context.workspace,
        )
      ) {
        offerFolder();
        setPending((value) => (value === request ? null : value));
        return;
      }
      const explorer = state.input.explorerRef.current;
      if (!explorer) {
        active.current = null;
        setPending((value) => (value === request ? null : value));
        return;
      }
      const readGuard = () =>
        guard() &&
        latest.current.input.explorerRef.current?.reveal === explorer.reveal;
      void (async () => {
        try {
          if (!readGuard()) return;
          const revealed = await explorer.reveal(
            request.target.path,
            readGuard,
          );
          if (!readGuard()) return;
          if (revealed)
            latest.current.input.explorerRef.current?.focus({
              preserveSelection: true,
            });
          else offerFolder();
        } catch {
          if (readGuard())
            toast.error(latest.current.t("feedback.somethingWentWrong"));
        } finally {
          setPending((value) => (value === request ? null : value));
        }
      })();
    });
    return () => cancelAnimationFrame(frame);
  }, [pending, input.ready, isCurrent, context]);

  return revealTab;
}
