import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IS_WINDOWS } from "@/lib/platform";
import { useTranslation } from "@/modules/i18n";
import { type RdpConnectionProfile, useRdpConnections } from "@/modules/rdp";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { InlineRename } from "@/modules/spaces/components/InlineRename";
import {
  formatSshSubtitle,
  type SshConnection,
  SshMetricsHoverCard,
  updateSshConnection,
  useSshConnections,
  useSshPing,
} from "@/modules/ssh";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowRight01Icon,
  ComputerIcon,
  ComputerTerminal02Icon,
  Loading03Icon,
  PencilEdit02Icon,
  Refresh01Icon,
  ServerStack01Icon,
  ServerStack03Icon,
  Settings01Icon,
  Tick02Icon,
  UsbIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "voktty-env-selector-collapsed";

type CollapsedState = {
  local?: boolean;
  ssh?: boolean;
  rdp?: boolean;
  serial?: boolean;
};

function readCollapsedState(): CollapsedState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCollapsedState(state: CollapsedState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

type Props = {
  onSelect: (env: WorkspaceEnv) => void;
  onConnectSsh?: (conn: SshConnection) => void;
  onConnectRdp?: (conn: RdpConnectionProfile) => void;
  onNewSsh?: () => void;
  onNewRdp?: () => void;
  onNewSerial?: () => void;
};

export function WorkspaceEnvSelector({
  onSelect,
  onConnectSsh,
  onConnectRdp,
  onNewSsh,
  onNewRdp,
  onNewSerial,
}: Props) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const suppressHoverUntilRef = useRef<number>(0);
  const [renamingConnectionId, setRenamingConnectionId] = useState<
    string | null
  >(null);
  const [collapsed, setCollapsed] = useState<CollapsedState>(() =>
    readCollapsedState(),
  );

  const env = useWorkspaceEnvStore((s) => s.env);
  const distros = useWorkspaceEnvStore((s) => s.distros);
  const loading = useWorkspaceEnvStore((s) => s.loading);
  const error = useWorkspaceEnvStore((s) => s.error);
  const connectionAttempts = useWorkspaceEnvStore((s) => s.connectionAttempts);
  const refreshDistros = useWorkspaceEnvStore((s) => s.refreshDistros);
  const sshConnections = useSshConnections();
  const rdpConnections = useRdpConnections();
  const { pingMap, refreshPings } = useSshPing(sshConnections, dropdownOpen);

  useEffect(() => {
    writeCollapsedState(collapsed);
  }, [collapsed]);

  const toggleSection = (section: keyof CollapsedState) => {
    setCollapsed((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleOpenChange = (isOpen: boolean) => {
    setDropdownOpen(isOpen);
    setHoverOpen(false);
    suppressHoverUntilRef.current = Date.now() + 500;
    if (isOpen && distros.length === 0 && !loading && IS_WINDOWS) {
      void refreshDistros();
    }
  };

  const attempts = Object.values(connectionAttempts).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const connectingAttempt = attempts.find(
    (attempt) =>
      attempt.state.phase === "resolving" ||
      attempt.state.phase === "connecting" ||
      attempt.state.phase === "reconnecting",
  );
  const failedAttempt = attempts.find(
    (attempt) =>
      attempt.state.phase === "failed" &&
      workspaceScopeKey(attempt.env) === workspaceScopeKey(env),
  );
  const isConnecting = Boolean(connectingAttempt);
  const connectingLabel = connectingAttempt
    ? t("terminal.connection.connecting", {
        name: connectingAttempt.target,
      })
    : null;
  const connectionError = failedAttempt
    ? {
        target: failedAttempt.target,
        message: failedAttempt.state.error ?? "",
      }
    : null;

  const label = isConnecting
    ? connectingLabel
    : env.kind === "ssh"
      ? env.connection.name
      : env.kind === "docker"
        ? `🐳 ${env.connection.containerName}`
        : env.kind === "serial"
          ? `Serial: ${env.portName}`
          : env.kind === "wsl"
            ? `WSL: ${env.distro}`
            : IS_WINDOWS
              ? t("workspace.windowsLocal")
              : t("workspace.localShell");

  const triggerButton = (
    <button
      type="button"
      onPointerDown={() => setHoverOpen(false)}
      onClick={() => setHoverOpen(false)}
      className={`flex h-5.5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10.5px] outline-none transition-colors cursor-pointer ${
        isConnecting
          ? "bg-sky-500/10 text-sky-400 border border-sky-500/30"
          : connectionError
            ? "bg-destructive/10 text-destructive border border-destructive/30"
            : "text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 data-[state=open]:bg-accent data-[state=open]:text-foreground"
      }`}
      title={
        isConnecting
          ? (connectingLabel ?? undefined)
          : connectionError
            ? `${connectionError.target}: ${connectionError.message}`
            : t("workspace.environment")
      }
    >
      {isConnecting ? (
        <HugeiconsIcon
          icon={Loading03Icon}
          size={12}
          strokeWidth={2}
          className="animate-spin text-sky-400"
        />
      ) : connectionError ? (
        <HugeiconsIcon
          icon={AlertCircleIcon}
          size={12}
          strokeWidth={2}
          className="text-destructive shrink-0"
        />
      ) : (
        <HugeiconsIcon icon={ServerStack03Icon} size={12} strokeWidth={1.75} />
      )}
      {!isConnecting && !connectionError && env.kind === "local" && (
        <span className="size-1.5 rounded-full bg-emerald-500/80 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
      )}
      {!isConnecting && !connectionError && env.kind === "ssh" && (
        <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
      )}
      {!isConnecting && !connectionError && env.kind === "docker" && (
        <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]" />
      )}
      {!isConnecting && !connectionError && env.kind === "serial" && (
        <span className="size-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
      )}
      {env.kind !== "local" && <span className="max-w-28 truncate text-[10px]">{label}</span>}
    </button>
  );

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={handleOpenChange}>
      <SshMetricsHoverCard
        env={env}
        side="top"
        align="start"
        open={dropdownOpen ? false : hoverOpen}
        onOpenChange={(isOpen) => {
          if (dropdownOpen || Date.now() < suppressHoverUntilRef.current) {
            setHoverOpen(false);
            return;
          }
          setHoverOpen(isOpen);
        }}
      >
        <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      </SshMetricsHoverCard>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-80 max-w-[92vw] max-h-[75vh] flex flex-col p-1.5 overflow-hidden rounded-xl border border-border/70 bg-popover/95 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex-1 overflow-y-auto overscroll-contain pr-1 space-y-1 text-xs [-ms-overflow-style:none] [scrollbar-width:thin]">
          {/* 1. LOCAL ENVIRONMENTS SECTION */}
          <div>
            <div
              onClick={() => toggleSection("local")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer rounded-md hover:bg-accent/40 select-none group transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={11}
                  className={`shrink-0 transition-transform duration-150 ${
                    collapsed.local ? "" : "rotate-90"
                  }`}
                />
                <HugeiconsIcon
                  icon={ComputerTerminal02Icon}
                  size={12}
                  className="shrink-0 opacity-70 group-hover:opacity-100"
                />
                <span className="truncate">
                  {t("workspace.localEnvironments")}
                </span>
                <span className="ml-1 text-[9px] font-normal opacity-60">
                  ({1 + (IS_WINDOWS ? distros.length : 0)})
                </span>
              </div>
            </div>

            {!collapsed.local && (
              <div className="mt-0.5 space-y-0.5 pl-2">
                <DropdownMenuItem
                  onSelect={() => onSelect(LOCAL_WORKSPACE)}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-xs">
                    {IS_WINDOWS
                      ? t("workspace.windowsLocal")
                      : t("workspace.localShell")}
                  </span>
                  {env.kind === "local" && (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={13}
                      strokeWidth={2}
                      className="text-primary shrink-0 ml-2"
                    />
                  )}
                </DropdownMenuItem>

                {IS_WINDOWS && (
                  <>
                    {distros.length === 0 ? (
                      <DropdownMenuItem disabled className="text-[11px]">
                        {loading
                          ? t("workspace.loadingWsl")
                          : error
                            ? t("workspace.wslUnavailable")
                            : t("workspace.noWslDistros")}
                      </DropdownMenuItem>
                    ) : (
                      distros.map((distro) => {
                        const isWslActive =
                          env.kind === "wsl" && env.distro === distro.name;
                        return (
                          <DropdownMenuItem
                            key={distro.name}
                            onSelect={() =>
                              onSelect({ kind: "wsl", distro: distro.name })
                            }
                            className="flex items-center justify-between py-1.5"
                          >
                            <span className="text-xs">WSL: {distro.name}</span>
                            {isWslActive && (
                              <HugeiconsIcon
                                icon={Tick02Icon}
                                size={13}
                                strokeWidth={2}
                                className="text-primary shrink-0 ml-2"
                              />
                            )}
                          </DropdownMenuItem>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <DropdownMenuSeparator className="my-1 bg-border/40" />

          {/* 2. SSH CONNECTIONS SECTION */}
          <div>
            <div
              onClick={() => toggleSection("ssh")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer rounded-md hover:bg-accent/40 select-none group transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={11}
                  className={`shrink-0 transition-transform duration-150 ${
                    collapsed.ssh ? "" : "rotate-90"
                  }`}
                />
                <HugeiconsIcon
                  icon={ServerStack01Icon}
                  size={12}
                  className="shrink-0 opacity-70 group-hover:opacity-100"
                />
                <span className="truncate">{t("ssh.title")}</span>
                <span className="ml-1 text-[9px] font-normal opacity-60">
                  ({sshConnections.length})
                </span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void refreshPings();
                }}
                className="text-[9px] lowercase opacity-70 hover:opacity-100 hover:text-foreground cursor-pointer px-1.5 py-0.5 rounded hover:bg-accent"
                title={t("tooltips.refreshPings")}
              >
                ping
              </button>
            </div>

            {!collapsed.ssh && (
              <div className="mt-0.5 space-y-0.5 pl-2">
                {sshConnections.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
                    {t("ssh.noConnections")}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {sshConnections.map((conn) => {
                      const pingStatus = pingMap[conn.id];
                      const candidateEnv: WorkspaceEnv = {
                        kind: "ssh",
                        connection: conn,
                        root: conn.initialDirectory?.trim() || ".",
                      };
                      const connectionAttempt =
                        connectionAttempts[workspaceScopeKey(candidateEnv)];
                      const isConnConnecting =
                        connectionAttempt?.state.phase === "resolving" ||
                        connectionAttempt?.state.phase === "connecting" ||
                        connectionAttempt?.state.phase === "reconnecting";
                      const isConnFailed =
                        connectionAttempt?.state.phase === "failed";
                      const isSshActive =
                        env.kind === "ssh" &&
                        (env.connection.id === conn.id ||
                          (env.connection.host === conn.host &&
                            (env.connection.port ?? 22) === (conn.port ?? 22)));
                      return (
                        <DropdownMenuItem
                          key={conn.id}
                          onSelect={(event) => {
                            const target = event.target as HTMLElement | null;
                            if (target?.closest("[data-inline-rename]")) {
                              event.preventDefault();
                              return;
                            }
                            onConnectSsh?.(conn);
                          }}
                          className={`flex items-center justify-between gap-2 py-1.5 ${
                            isConnConnecting
                              ? "bg-sky-500/10"
                              : isConnFailed
                                ? "bg-destructive/10"
                                : isSshActive
                                  ? "bg-accent/60"
                                  : ""
                          }`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {isConnConnecting ? (
                              <HugeiconsIcon
                                icon={Loading03Icon}
                                size={13}
                                strokeWidth={2}
                                className="shrink-0 animate-spin text-sky-400"
                              />
                            ) : isConnFailed ? (
                              <HugeiconsIcon
                                icon={AlertCircleIcon}
                                size={13}
                                strokeWidth={2}
                                className="shrink-0 text-destructive"
                              />
                            ) : (
                              <HugeiconsIcon
                                icon={ServerStack01Icon}
                                size={13}
                                strokeWidth={1.75}
                                className={`shrink-0 ${
                                  isSshActive
                                    ? "text-sky-400"
                                    : "text-muted-foreground"
                                }`}
                              />
                            )}
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex items-center gap-1.5">
                                {renamingConnectionId === conn.id ? (
                                  <span
                                    data-inline-rename
                                    className="min-w-0 flex-1"
                                  >
                                    <InlineRename
                                      initial={conn.name}
                                      ariaLabel={t("common.rename")}
                                      onCommit={(name) => {
                                        const nextName = name.trim();
                                        if (
                                          nextName &&
                                          nextName !== conn.name
                                        ) {
                                          void updateSshConnection(conn.id, {
                                            name: nextName,
                                          });
                                        }
                                        setRenamingConnectionId(null);
                                      }}
                                      onCancel={() =>
                                        setRenamingConnectionId(null)
                                      }
                                      className="h-6 text-xs"
                                    />
                                  </span>
                                ) : (
                                  <span className="truncate text-xs font-medium text-foreground">
                                    {conn.name}
                                  </span>
                                )}
                                {isSshActive && !isConnConnecting && (
                                  <HugeiconsIcon
                                    icon={Tick02Icon}
                                    size={12}
                                    strokeWidth={2}
                                    className="text-primary shrink-0"
                                  />
                                )}
                                {isConnConnecting && (
                                  <span className="rounded bg-sky-500/20 px-1 py-0.2 text-[9px] font-medium text-sky-400 animate-pulse">
                                    {t("tooltips.connecting")}
                                  </span>
                                )}
                                {isConnFailed && (
                                  <span
                                    className="rounded bg-destructive/15 px-1 py-0.2 text-[9px] font-medium text-destructive"
                                    title={
                                      connectionAttempt.state.error ?? undefined
                                    }
                                  >
                                    {t("terminal.connection.error")}
                                  </span>
                                )}
                              </div>
                              <span className="truncate font-mono text-[10px] text-muted-foreground">
                                {formatSshSubtitle(conn)}
                              </span>
                            </div>
                          </div>

                          {/* Status Ping Dot */}
                          <div className="flex shrink-0 items-center gap-1.5 pl-2">
                            <button
                              type="button"
                              data-inline-rename
                              aria-label={t("common.rename")}
                              title={t("common.rename")}
                              onPointerDown={(event) => event.stopPropagation()}
                              onPointerUp={(event) => event.stopPropagation()}
                              onPointerCancel={(event) =>
                                event.stopPropagation()
                              }
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setRenamingConnectionId(conn.id);
                              }}
                              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                            >
                              <HugeiconsIcon
                                icon={PencilEdit02Icon}
                                size={12}
                                strokeWidth={1.75}
                              />
                            </button>
                            {isConnConnecting ? (
                              <span
                                className="size-2 rounded-full bg-sky-400 animate-ping"
                                title={t("tooltips.connecting")}
                              />
                            ) : isConnFailed ? (
                              <span
                                className="size-2 rounded-full bg-destructive"
                                title={
                                  connectionAttempt.state.error ?? undefined
                                }
                              />
                            ) : pingStatus?.loading ? (
                              <span
                                className="size-2 rounded-full bg-muted-foreground/40 animate-pulse"
                                title={t("tooltips.checkingConnection")}
                              />
                            ) : pingStatus?.online ? (
                              <div className="flex items-center gap-1.5">
                                {pingStatus.latencyMs !== undefined && (
                                  <span className="font-mono text-[10px] text-emerald-500 font-medium">
                                    {pingStatus.latencyMs}ms
                                  </span>
                                )}
                                <span
                                  className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                                  title={
                                    pingStatus.latencyMs !== undefined
                                      ? `Online (${pingStatus.latencyMs}ms)`
                                      : t("tooltips.online")
                                  }
                                />
                              </div>
                            ) : (
                              <span
                                className="size-2 rounded-full bg-zinc-600/50 dark:bg-zinc-700/60"
                                title={
                                  pingStatus?.error ?? t("tooltips.offline")
                                }
                              />
                            )}
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                )}

                <DropdownMenuItem
                  onSelect={() => onNewSsh?.()}
                  className="gap-2 text-xs text-muted-foreground hover:text-foreground py-1.5"
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    size={13}
                    strokeWidth={1.75}
                  />
                  <span>{t("ssh.newConnection")}…</span>
                </DropdownMenuItem>
              </div>
            )}
          </div>

          <DropdownMenuSeparator className="my-1 bg-border/40" />

          {/* 3. RDP CONNECTIONS SECTION */}
          <div>
            <div
              onClick={() => toggleSection("rdp")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer rounded-md hover:bg-accent/40 select-none group transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={11}
                  className={`shrink-0 transition-transform duration-150 ${
                    collapsed.rdp ? "" : "rotate-90"
                  }`}
                />
                <HugeiconsIcon
                  icon={ComputerIcon}
                  size={12}
                  className="shrink-0 text-blue-400 opacity-80 group-hover:opacity-100"
                />
                <span className="truncate">{t("rdp.section.title")}</span>
                <span className="ml-1 text-[9px] font-normal opacity-60">
                  ({rdpConnections.length})
                </span>
              </div>
            </div>

            {!collapsed.rdp && (
              <div className="mt-0.5 space-y-0.5 pl-2">
                {rdpConnections.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
                    {t("rdp.noConnectionsTitle")}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {rdpConnections.map((conn) => (
                      <DropdownMenuItem
                        key={conn.id}
                        onSelect={() => onConnectRdp?.(conn)}
                        className="flex items-center justify-between gap-2 py-1.5"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: conn.color || "#3b82f6" }}
                          />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-xs font-medium text-foreground">
                              {conn.name}
                            </span>
                            <span className="truncate font-mono text-[10px] text-muted-foreground">
                              {conn.username ? `${conn.username}@` : ""}
                              {conn.host}:{conn.port || 3389}
                            </span>
                          </div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </div>
                )}

                <DropdownMenuItem
                  onSelect={() => onNewRdp?.()}
                  className="gap-2 text-xs text-muted-foreground hover:text-foreground py-1.5"
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    size={13}
                    strokeWidth={1.75}
                  />
                  <span>{t("rdp.newConnection")}</span>
                </DropdownMenuItem>
              </div>
            )}
          </div>

          <DropdownMenuSeparator className="my-1 bg-border/40" />

          {/* 4. SERIAL (COM / TTY) SECTION */}
          <div>
            <div
              onClick={() => toggleSection("serial")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer rounded-md hover:bg-accent/40 select-none group transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={11}
                  className={`shrink-0 transition-transform duration-150 ${
                    collapsed.serial ? "" : "rotate-90"
                  }`}
                />
                <HugeiconsIcon
                  icon={UsbIcon}
                  size={12}
                  className="shrink-0 text-amber-400 opacity-80 group-hover:opacity-100"
                />
                <span className="truncate">{t("statusbar.serial")}</span>
              </div>
            </div>

            {!collapsed.serial && (
              <div className="mt-0.5 space-y-0.5 pl-2">
                <DropdownMenuItem
                  onSelect={() => onNewSerial?.()}
                  className="gap-2 text-xs text-muted-foreground hover:text-foreground py-1.5"
                >
                  <HugeiconsIcon icon={UsbIcon} size={13} strokeWidth={1.75} />
                  <span>{t("serial.connectSerial")}</span>
                </DropdownMenuItem>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <DropdownMenuSeparator className="my-1 bg-border/50" />

        <div className="space-y-0.5 pt-0.5">
          <DropdownMenuItem
            onSelect={() => void openSettingsWindow("ssh")}
            className="gap-2 text-[11px] text-muted-foreground hover:text-foreground py-1"
          >
            <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
            <span>{t("ssh.manageConnections")}…</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={() => void openSettingsWindow("rdp")}
            className="gap-2 text-[11px] text-muted-foreground hover:text-foreground py-1"
          >
            <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
            <span>{t("rdp.manageInSettings")}</span>
          </DropdownMenuItem>

          {IS_WINDOWS && (
            <DropdownMenuItem
              onSelect={() => void refreshDistros()}
              className="gap-2 text-[11px] text-muted-foreground hover:text-foreground py-1"
            >
              <HugeiconsIcon
                icon={Refresh01Icon}
                size={12}
                strokeWidth={1.75}
              />
              <span>{t("common.refresh")}</span>
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
