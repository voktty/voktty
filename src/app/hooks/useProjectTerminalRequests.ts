import { useLayoutEffect, useRef } from "react";
import type { Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SshMultiplexerPicker } from "@/modules/harness/lib/projectTerminalTarget";
import { createProjectTerminalRequests } from "@/app/lib/projectTerminalRequests";

type Props = {
  source: Tab | undefined;
  spaceId: string;
  projectCwd: string | null | undefined;
  newTab: (cwd?: string, workspace?: WorkspaceEnv) => number;
  getTab: (id: number) => Tab | undefined;
  closeTab: (id: number) => void;
  setActiveSpaceForNewTabs: (spaceId: string) => void;
  pick: (
    owner: object,
    ...args: Parameters<SshMultiplexerPicker>
  ) => ReturnType<SshMultiplexerPicker>;
  cancelPicker: (owner: object) => void;
  onError: (error: unknown) => void;
};

export function useProjectTerminalRequests(props: Props) {
  const latest = useRef(props);
  const origin = useRef<object>({});
  const signature = useRef<readonly unknown[]>([]);
  const service = useRef<ReturnType<
    typeof createProjectTerminalRequests
  > | null>(null);
  useLayoutEffect(() => {
    latest.current = props;
    const next = [
      props.source?.id,
      props.source?.tabKey,
      props.source?.workspaceScopeId,
      props.source?.spaceId,
      props.spaceId,
      props.projectCwd,
    ];
    if (next.some((value, index) => value !== signature.current[index])) {
      signature.current = next;
      origin.current = {};
      service.current?.retireSelection();
    }
  });
  useLayoutEffect(() => {
    const current = createProjectTerminalRequests({
      capture: () => {
        const captured = latest.current;
        const selected = origin.current;
        return {
          isCurrent: () => origin.current === selected,
          create: (cwd, workspace) => {
            captured.setActiveSpaceForNewTabs(captured.spaceId);
            const tabId = captured.newTab(cwd, workspace);
            const tab = captured.getTab(tabId);
            if (tab?.kind !== "terminal" || tab.spaceId !== captured.spaceId) {
              captured.closeTab(tabId);
              throw new Error("Terminal creation did not return a terminal.");
            }
            return { tabId, leafId: tab.activeLeafId };
          },
          rollback: captured.closeTab,
          pick: captured.pick,
          cancelPicker: captured.cancelPicker,
          onError: captured.onError,
        };
      },
      resolve: async (cwd, picker, isCurrent) => {
        const { openProjectTerminalTarget } = await import(
          "@/modules/harness/lib/projectTerminalTarget"
        );
        return openProjectTerminalTarget(cwd, picker, isCurrent);
      },
    });
    service.current = current;
    const handler = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      const cwd =
        detail && typeof detail === "object" && "cwd" in detail
          ? detail.cwd
          : undefined;
      void current.open(cwd).catch(() => undefined);
    };
    window.addEventListener("voktty:open-new-terminal-tab", handler);
    return () => {
      window.removeEventListener("voktty:open-new-terminal-tab", handler);
      current.dispose();
      if (service.current === current) service.current = null;
    };
  }, []);
}
