import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { SshConnection } from "@/modules/ssh/types";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceEnv } from "@/modules/workspace";
import { installKeystrokes, parseInstallRequest } from "./lib/installRequest";
import { COMPUTER_USE_INSTALL_EVENT } from "./lib/probe";

type Deps = {
  /** Opens a visible terminal tab in `workspace` and returns its leaf id. */
  openTerminal: (workspace: WorkspaceEnv, cwd: string | undefined) => number;
  /** Connects a saved host; null when it could not be reached. */
  connect: (connection: SshConnection) => Promise<WorkspaceEnv | null>;
  local: WorkspaceEnv;
  localCwd: string | undefined;
  whenReady: (leafId: number) => Promise<unknown>;
  write: (leafId: number, data: string) => boolean;
  onFailure: (hostId: string | null) => void;
};

/**
 * Runs the install command from Settings in a terminal tab the user can see,
 * on this computer or on a saved SSH host. Nothing runs in the background.
 */
export function useInstallTerminal(deps: Deps): void {
  const latest = useRef(deps);
  latest.current = deps;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen(COMPUTER_USE_INSTALL_EVENT, (event) => {
      const request = parseInstallRequest(event.payload);
      if (!request) return;
      void (async () => {
        const d = latest.current;
        try {
          let workspace: WorkspaceEnv | null = d.local;
          let cwd = d.localCwd;
          if (request.hostId !== null) {
            const connection = (
              usePreferencesStore.getState().sshConnections ?? []
            ).find((candidate) => candidate.id === request.hostId);
            workspace = connection ? await d.connect(connection) : null;
            if (workspace?.kind !== "ssh") throw new Error("host unavailable");
            cwd = workspace.root;
          }
          if (!workspace) throw new Error("workspace unavailable");
          const leafId = d.openTerminal(workspace, cwd);
          await d.whenReady(leafId);
          if (!d.write(leafId, installKeystrokes())) {
            throw new Error("terminal closed");
          }
        } catch {
          d.onFailure(request.hostId);
        }
      })();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
