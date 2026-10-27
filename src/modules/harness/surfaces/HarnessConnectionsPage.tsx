import { AddRemoteProjectDialog } from "@/modules/connections";
import { parseRemotePath } from "@/modules/connections/model/remoteProjects";
import {
  closeSshProfileSessions,
  openSshProfileInHarness,
} from "@/modules/connections/model/sshConnectionActions";
import { remoteSshConnectionIdForEnvironment } from "@/modules/connections/model/remoteSshProfiles";
import { useTranslation } from "@/modules/i18n";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  formatSshSubtitle,
  type SshConnection,
  useSshConnections,
  useSshPing,
} from "@/modules/ssh";
import {
  type WorkspaceEnv,
  useWorkspaceEnvStore,
  workspaceScopeKey,
} from "@/modules/workspace";
import { useHarnessProjectEnvStore } from "@/modules/harness/lib/harnessEnvStore";
import { projectEnvironmentOwnerId } from "@/modules/harness/lib/projectEnvironmentIdentity";
import { harnessProfileStatus } from "@/modules/connections/model/harnessProfileStatus";
import { useHarnessProjectSelection } from "@/modules/harness/hooks/useHarnessProjectSelection";
import { useRemoteSessionSnapshots } from "@/modules/remote/useRemoteSessions";
import { useLayoutEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  FolderOpen,
  Internet,
  Loader,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from "../chrome/icons";

export function HarnessConnectionsPage({ cwd }: { cwd: string }) {
  const { t } = useTranslation();
  const connections = useSshConnections();
  const { pingMap, refreshPings } = useSshPing(connections, true);
  const captureProject = useHarnessProjectSelection(cwd);
  const [projectSelection, setProjectSelection] = useState<ReturnType<typeof captureProject>>(null);
  useLayoutEffect(() => {
    if (projectSelection && !projectSelection.isCurrent()) setProjectSelection(null);
  });
  const [connectionId, setConnectionId] = useState<string>();
  const [isRefreshingPings, setIsRefreshingPings] = useState(false);

  const projects = useHarnessProjectEnvStore((s) => s.projects);
  const pool = useRemoteSessionSnapshots();
  const connectionAttempts = useWorkspaceEnvStore((s) => s.connectionAttempts);

  const parsedCurrentProject = parseRemotePath(cwd);
  const ownerId = projectEnvironmentOwnerId(cwd, projects);
  const selectedProject = ownerId === undefined ? undefined : projects[ownerId];
  const currentConnectionId = selectedProject
    ? selectedProject.identity.profileId
    : parsedCurrentProject
      ? (remoteSshConnectionIdForEnvironment(parsedCurrentProject.environmentId) ??
        connections.find(
          (profile) => profile.id === parsedCurrentProject.environmentId,
        )?.id)
      : undefined;

  const openFolder = (id?: string) => {
    const selection = captureProject();
    if (!selection) return;
    projectSelection?.retire();
    setConnectionId(id);
    setProjectSelection(selection);
  };

  const handleConnect = async (conn: SshConnection) => {
    const selection = captureProject();
    if (!selection) return;
    try {
      await openSshProfileInHarness(conn, selection.select);
    } catch (err) {
      if (selection.isCurrent()) console.error("[harness] Failed to connect:", err);
    }
  };

  const handleDisconnect = async (conn: SshConnection) => {
    const selection = captureProject();
    if (!selection) return;
    await closeSshProfileSessions(conn.id);
    selection.select("~");
  };

  const handleReconnect = async (conn: SshConnection) => {
    const selection = captureProject();
    if (!selection) return;
    await closeSshProfileSessions(conn.id);
    if (!selection.isCurrent()) return;
    try {
      await openSshProfileInHarness(conn, selection.select);
    } catch (err) {
      if (selection.isCurrent()) console.error("[harness] Failed to connect:", err);
    }
  };
  const onRefreshPingsClick = async () => {
    setIsRefreshingPings(true);
    try {
      await refreshPings();
    } finally {
      setIsRefreshingPings(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-setting-id="remote-connections">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-content/10 bg-content/3 p-4">
        <p className="max-w-2xl text-[12px] leading-relaxed text-content/60">
          {t("harness.connections.intro")}
        </p>
        <div className="flex items-center gap-2">
          {connections.length > 0 ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-content/15 px-3 py-2 text-[12px] font-medium text-content/75 hover:bg-content/5 hover:text-content transition-colors cursor-pointer"
              onClick={() => void onRefreshPingsClick()}
              disabled={isRefreshingPings}
              title={t("harness.connections.refreshPings")}
            >
              <RefreshCw
                className={`size-3.5 ${isRefreshingPings ? "animate-spin" : ""}`}
              />
              <span>{t("harness.connections.refreshPings")}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-content/15 px-3 py-2 text-[12px] font-medium text-content/75 hover:bg-content/5 hover:text-content transition-colors cursor-pointer"
            onClick={() => void openSettingsWindow("ssh")}
          >
            {connections.length
              ? t("harness.connections.manageProfiles")
              : t("harness.connections.addProfile")}
          </button>
        </div>
      </section>

      <section aria-label={t("harness.connections.profilesTitle")}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-content">
            {t("harness.connections.profilesTitle")}
          </h2>
          <span className="text-[11.5px] text-content/45 font-medium">
            {connections.length}{" "}
            {connections.length === 1 ? "perfil" : "perfiles"}
          </span>
        </div>

        {connections.length ? (
          <div className="divide-y divide-content/10 overflow-hidden rounded-xl border border-content/10 bg-content/2">
            {connections.map((connection) => {
              const pingStatus = pingMap[connection.id];
              const candidateEnv: WorkspaceEnv = {
                kind: "ssh",
                connection,
                root: connection.initialDirectory?.trim() || ".",
              };
              const connectionAttempt =
                connectionAttempts[workspaceScopeKey(candidateEnv)];
              const harnessStatus = harnessProfileStatus(
                connection,
                projects,
                pool,
              );
              const isSshActive = harnessStatus.phase === "ready";
              const isConnConnecting =
                !isSshActive &&
                (harnessStatus.phase === "connecting" ||
                  connectionAttempt?.state.phase === "resolving" ||
                  connectionAttempt?.state.phase === "connecting" ||
                  connectionAttempt?.state.phase === "reconnecting");
              const connectionError =
                harnessStatus.error ??
                (connectionAttempt?.state.phase === "failed"
                  ? connectionAttempt.state.error
                  : null);
              const isConnFailed =
                !isSshActive && !isConnConnecting && Boolean(connectionError);
              const isCurrentProject = currentConnectionId === connection.id;

              return (
                <div
                  key={connection.id}
                  className={`flex flex-col gap-2.5 px-4 py-3.5 transition-colors ${
                    isSshActive ? "bg-emerald-500/5" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${
                          isConnConnecting
                            ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                            : isConnFailed
                              ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                              : isSshActive
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-content/10 bg-content/4 text-content/50"
                        }`}
                      >
                        {isConnConnecting ? (
                          <Loader className="size-4 animate-spin" />
                        ) : isConnFailed ? (
                          <CircleAlert className="size-4" strokeWidth={2} />
                        ) : (
                          <Internet className="size-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-content">
                            {connection.name}
                          </span>

                          {/* Ping / Latency Badge */}
                          {pingStatus?.loading ? (
                            <span className="inline-flex items-center gap-1 rounded bg-content/5 px-1.5 py-0.5 text-[10.5px] text-content/50">
                              <Loader className="size-2.5 animate-spin" />
                              <span>{t("harness.connections.pinging")}</span>
                            </span>
                          ) : pingStatus?.online ? (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-emerald-500"
                              title="Online"
                            >
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>{pingStatus.latencyMs ?? 0} ms</span>
                            </span>
                          ) : pingStatus && !pingStatus.online ? (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10.5px] text-rose-400"
                              title={
                                pingStatus.error ||
                                t("harness.connections.offline")
                              }
                            >
                              <span className="size-1.5 rounded-full bg-rose-500" />
                              <span>{t("harness.connections.offline")}</span>
                            </span>
                          ) : null}

                          {/* Active Workspace / Connection status */}
                          {isSshActive ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-500">
                              <Check className="size-3" strokeWidth={2.5} />
                              <span>{t("harness.connections.connected")}</span>
                            </span>
                          ) : isConnConnecting ? (
                            <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-sky-400">
                              <Loader className="size-2.5 animate-spin" />
                              <span>{t("harness.connections.connecting")}</span>
                            </span>
                          ) : isConnFailed ? (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-rose-400"
                              title={connectionError ?? undefined}
                            >
                              <CircleAlert className="size-3" strokeWidth={2} />
                              <span>Error</span>
                            </span>
                          ) : null}

                          {/* Active Harness Project badge */}
                          {isCurrentProject ? (
                            <span className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-indigo-400">
                              {t("harness.connections.currentProject")}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-0.5 truncate text-[11.5px] text-content/45 font-mono">
                          {formatSshSubtitle(connection)}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isSshActive ? (
                        <>
                          <button
                            type="button"
                            className="flex items-center gap-1.5 rounded-lg border border-content/15 px-2.5 py-1.5 text-[12px] font-medium text-content/80 hover:bg-content/5 hover:text-content transition-colors cursor-pointer"
                            onClick={() => handleReconnect(connection)}
                            title={t("harness.connections.reconnect")}
                          >
                            <RotateCcw className="size-3.5" />
                            <span>{t("harness.connections.reconnect")}</span>
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-[12px] font-medium text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                            onClick={() => handleDisconnect(connection)}
                            title={t("harness.connections.disconnect")}
                          >
                            <Square className="size-3.5" />
                            <span>{t("harness.connections.disconnect")}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isConnConnecting}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-600 text-white px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                          onClick={() => handleConnect(connection)}
                          title={t("harness.connections.connect")}
                        >
                          <Play className="size-3.5" />
                          <span>{t("harness.connections.connect")}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-lg bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover transition-colors cursor-pointer"
                        onClick={() => openFolder(connection.id)}
                        title={t("harness.connections.openFolder")}
                      >
                        <FolderOpen className="size-3.5" />
                        <span>{t("harness.connections.openFolder")}</span>
                      </button>
                    </div>
                  </div>

                  {/* Failure details if connection failed */}
                  {isConnFailed && connectionError ? (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5 text-[11px] text-rose-300">
                      <CircleAlert
                        className="size-3.5 shrink-0 text-rose-400 mt-0.5"
                      />
                      <span className="leading-relaxed">
                        {connectionError}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-content/15 px-5 py-7 text-center">
            <p className="text-[13px] font-medium text-content/75">
              {t("harness.connections.emptyTitle")}
            </p>
            <p className="mx-auto mt-1 max-w-lg text-[12px] leading-relaxed text-content/45">
              {t("harness.connections.emptyDescription")}
            </p>
          </div>
        )}
      </section>

      {projectSelection ? (
        <AddRemoteProjectDialog
          initialConnectionId={connectionId}
          onCancel={() => {
            if (!projectSelection.isCurrent()) return;
            projectSelection.retire();
            setProjectSelection(null);
          }}
          onOpen={(path) => {
            if (!projectSelection.isCurrent()) return;
            setProjectSelection(null);
            projectSelection.select(path);
          }}
        />
      ) : null}
    </div>
  );
}
