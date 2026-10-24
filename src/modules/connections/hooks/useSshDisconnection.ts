import { useEffect, type RefObject } from "react";
import { toast } from "sonner";
import type { Tab } from "@/modules/tabs";
import { useTranslation } from "@/modules/i18n";
import { useSpaces } from "@/modules/spaces";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore } from "@/modules/workspace";
import { closeRemoteSessionById } from "@/modules/remote/sessionManager";
import { closeSshProfileSessions, DISCONNECT_SSH_EVENT, relatedProfileIds } from "@/modules/connections/model/sshConnectionActions";
import { isHarnessDisconnectTarget, planHarnessDisconnect } from "@/modules/connections/model/harnessDisconnect";
import { requestHarnessProject } from "@/modules/surfaces/lib/harnessProjectRequest";

type Props = {
  tabsRef: RefObject<Tab[]>;
  getTab: (id: number) => Tab | undefined;
  getSelectedTab: () => Tab | undefined;
  updateTab: (id: number, patch: { cwd: string }) => void;
  setProjectFallback: (path: string) => void;
  localHome: string | null;
  localRoot: string | null;
};

export function useSshDisconnection({ tabsRef, getTab, getSelectedTab, updateTab, setProjectFallback, localHome, localRoot }: Props) {
  const { t } = useTranslation();
  useEffect(() => {
    let current = true;
    const disconnect = (event: Event) => {
      if (!current) return;
      const requested = (event as CustomEvent<{ connectionId?: unknown }>).detail?.connectionId;
      const env = useWorkspaceEnvStore.getState().env;
      const profileId = typeof requested === "string" && requested ? requested : env.kind === "ssh" ? env.connection.id : null;
      const ids = profileId === null ? new Set<string>() : relatedProfileIds(
        profileId, usePreferencesStore.getState().sshConnections ?? [], env.kind === "ssh" ? [env.connection] : [],
      );
      const workspaceAffected = env.kind === "ssh" && ids.has(env.connection.id);
      const spaceId = useSpaces.getState().activeId;
      const targets = planHarnessDisconnect(tabsRef.current, getSelectedTab(), ids, workspaceAffected);
      if (profileId) void closeSshProfileSessions(profileId, ids).catch(() => {});
      if (workspaceAffected && env.kind === "ssh" && env.sessionId !== undefined) {
        void closeRemoteSessionById("workspace", env.sessionId).catch(() => {});
      }
      const workspaceIsCurrent = () => current && useWorkspaceEnvStore.getState().env === env && useSpaces.getState().activeId === spaceId;
      if (workspaceAffected && workspaceIsCurrent()) {
        if (spaceId) {
          useSpaces.getState().setEnv(spaceId, LOCAL_WORKSPACE);
          if (workspaceIsCurrent()) useSpaces.getState().setRoot(spaceId, localRoot);
        }
        if (workspaceIsCurrent()) useWorkspaceEnvStore.getState().setEnv(LOCAL_WORKSPACE);
      }
      const fallback = localHome ?? "~";
      for (const target of targets) {
        if (!current || !isHarnessDisconnectTarget(getTab(target.ownerId), target)) continue;
        updateTab(target.ownerId, { cwd: fallback });
        const isSelected = () => {
          const selected = getSelectedTab();
          return current && selected?.kind === "harness" && selected.id === target.ownerId && selected.tabKey === target.tabKey &&
            selected.spaceId === target.spaceId && (selected.cwd === target.cwd || selected.cwd === fallback);
        };
        if (!target.selected || !isSelected()) continue;
        setProjectFallback(fallback);
        if (isSelected()) requestHarnessProject(fallback, target);
      }
      if (current) toast.success(t("harness.connections.disconnected"));
    };
    window.addEventListener(DISCONNECT_SSH_EVENT, disconnect);
    return () => {
      current = false;
      window.removeEventListener(DISCONNECT_SSH_EVENT, disconnect);
    };
  }, [tabsRef, getTab, getSelectedTab, updateTab, setProjectFallback, localHome, localRoot, t]);
}
