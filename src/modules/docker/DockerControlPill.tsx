import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { DockerWorkspaceConnection } from "@/modules/workspace/env";
import {
  ComputerTerminal02Icon,
  DocumentCodeIcon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { DockerLogsModal } from "./DockerLogsModal";
import type { DockerContainerInfo } from "./types";
import { useDockerStore } from "./useDockerStore";
import { toast } from "sonner";

type Props = {
  onConnectDocker?: (connection: DockerWorkspaceConnection) => void;
  onOpenSettings?: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export function DockerControlPill({ onConnectDocker, onOpenSettings }: Props) {
  const { t } = useTranslation();
  const dockerEnabled = usePreferencesStore((s) => s.dockerEnabled);
  const dockerCustomHost = usePreferencesStore((s) => s.dockerCustomHost);

  const {
    status,
    containers,
    stats,
    loading,
    refreshContainers,
    performAction,
    logsModalContainer,
    setLogsModalContainer,
  } = useDockerStore();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!dockerEnabled) return;
    refreshContainers(dockerCustomHost);
    const interval = setInterval(() => {
      refreshContainers(dockerCustomHost);
    }, 10000);
    return () => clearInterval(interval);
  }, [dockerEnabled, dockerCustomHost]);

  const runningCount = containers.filter((c) => c.state === "running").length;
  const totalCount = containers.length;
  const isConnected = status?.connected ?? false;

  // Compute aggregate CPU & RAM
  const totalCpu = useMemo(() => {
    return Object.values(stats).reduce((acc, s) => acc + (s.cpu_percent || 0), 0);
  }, [stats]);

  const totalMemBytes = useMemo(() => {
    return Object.values(stats).reduce((acc, s) => acc + (s.memory_usage_bytes || 0), 0);
  }, [stats]);

  const filteredContainers = useMemo(() => {
    if (!search.trim()) return containers;
    const q = search.toLowerCase();
    return containers.filter(
      (c) =>
        c.names.some((n) => n.toLowerCase().includes(q)) ||
        c.image.toLowerCase().includes(q) ||
        c.short_id.toLowerCase().includes(q) ||
        c.compose_project?.toLowerCase().includes(q) ||
        c.compose_service?.toLowerCase().includes(q),
    );
  }, [containers, search]);

  // Group by compose project
  const groupedContainers = useMemo(() => {
    const groups: Record<string, DockerContainerInfo[]> = {};
    for (const c of filteredContainers) {
      const groupName = c.compose_project
        ? `📦 ${c.compose_project}`
        : t("docker.containers");
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(c);
    }
    return groups;
  }, [filteredContainers, t]);

  const handleAction = async (containerId: string, action: string) => {
    setActionLoading(containerId);
    const container = containers.find((c) => c.id === containerId);
    const cName = container?.names[0] || container?.short_id || containerId.slice(0, 12);
    const toastId = `docker-action-${containerId}`;
    const actionLabel =
      action === "start"
        ? t("docker.starting", { name: cName })
        : action === "stop"
        ? t("docker.stopping", { name: cName })
        : t("docker.restarting", { name: cName });
    toast.loading(actionLabel, { id: toastId });
    try {
      await performAction(containerId, action);
      toast.success(
        t("docker.actionSuccess", { name: cName }),
        { id: toastId },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        t("docker.actionFailed", { error: msg }),
        { id: toastId, description: msg },
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenShell = (c: DockerContainerInfo) => {
    setOpen(false);
    onConnectDocker?.({
      containerId: c.id,
      containerName: c.names[0] || c.short_id,
      image: c.image,
      shell: "/bin/sh",
    });
  };

  if (!dockerEnabled) {
    return null;
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-5.5 px-2 text-[11px] gap-1.5 rounded-md font-medium transition-colors border ${
              isConnected
                ? runningCount > 0
                  ? "bg-sky-500/10 text-sky-400 border-sky-500/30 hover:bg-sky-500/15"
                  : "bg-muted/40 text-muted-foreground border-border/30 hover:bg-muted/60"
                : "bg-muted/20 text-muted-foreground/60 border-border/20 hover:bg-muted/40"
            }`}
          >
            <span className="text-xs">🐳</span>
            <span>Docker</span>
            {isConnected && (
              <span className="flex items-center gap-1 font-mono text-[10px] opacity-90">
                <span
                  className={`size-1.5 rounded-full ${
                    runningCount > 0 ? "bg-emerald-500" : "bg-muted-foreground"
                  }`}
                />
                {runningCount}/{totalCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          className="w-96 max-h-[480px] p-0 flex flex-col bg-card/95 backdrop-blur-md border border-border/40 shadow-2xl rounded-xl"
        >
          {/* Header */}
          <div className="flex flex-col gap-2 p-3 border-b border-border/30 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🐳</span>
                <span className="text-xs font-semibold">
                  {t("docker.title")}
                </span>
                {status?.version && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono h-4.5">
                    v{status.version}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 rounded-md"
                onClick={() => refreshContainers()}
                disabled={loading}
              >
                <HugeiconsIcon
                  icon={RefreshIcon}
                  className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            {/* Overall Resource Usage */}
            {isConnected && runningCount > 0 && (
              <div className="flex items-center justify-between text-[10.5px] px-2 py-1 rounded bg-background/50 border border-border/30 text-muted-foreground font-mono">
                <span>CPU: <strong className="text-foreground">{totalCpu.toFixed(1)}%</strong></span>
                <span>RAM: <strong className="text-foreground">{formatBytes(totalMemBytes)}</strong></span>
                <span>{t("docker.activeLabel")}: <strong className="text-emerald-400">{runningCount}</strong></span>
              </div>
            )}

            {/* Search Input */}
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                className="absolute left-2 top-2 size-3.5 text-muted-foreground/60 pointer-events-none"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("docker.searchPlaceholder")}
                className="h-7 text-xs pl-7 bg-background/60 border-border/30"
              />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {!isConnected ? (
              <div className="p-4 text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  {status?.error || t("docker.daemonNotRunning")}
                </p>
                {onOpenSettings && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setOpen(false);
                      onOpenSettings();
                    }}
                  >
                    {t("docker.configureInSettings")}
                  </Button>
                )}
              </div>
            ) : filteredContainers.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {search ? t("docker.noMatchingContainers") : t("docker.noContainers")}
              </div>
            ) : (
              Object.entries(groupedContainers).map(([groupName, items]) => (
                <div key={groupName} className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 px-1 py-0.5">
                    {groupName}
                  </div>
                  {items.map((c) => {
                    const cStats = stats[c.id];
                    const isRunning = c.state === "running";
                    const isBusy = actionLoading === c.id;
                    const cName = c.names[0] || c.short_id;

                    return (
                      <div
                        key={c.id}
                        className="group flex flex-col gap-1.5 p-2 rounded-lg bg-background/40 hover:bg-foreground/[0.04] border border-border/30 transition-all text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`size-2 rounded-full shrink-0 ${
                                isRunning ? "bg-emerald-500" : "bg-muted-foreground/40"
                              }`}
                            />
                            <span className="font-medium truncate text-foreground" title={cName}>
                              {cName}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate font-mono" title={c.image}>
                              {c.image.split(":")[0]}
                            </span>
                          </div>

                          {/* Quick Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            {isRunning && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 hover:bg-primary/20 hover:text-primary rounded"
                                    onClick={() => handleOpenShell(c)}
                                  >
                                    <HugeiconsIcon icon={ComputerTerminal02Icon} className="size-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-[10px]">
                                  {t("docker.openTerminal")}
                                </TooltipContent>
                              </Tooltip>
                            )}

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 hover:bg-foreground/10 rounded"
                                  onClick={() => setLogsModalContainer(c)}
                                >
                                  <HugeiconsIcon icon={DocumentCodeIcon} className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-[10px]">
                                {t("docker.viewLogs")}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 hover:bg-foreground/10 rounded"
                                  disabled={isBusy}
                                  onClick={() => handleAction(c.id, isRunning ? "stop" : "start")}
                                >
                                  <HugeiconsIcon
                                    icon={isRunning ? StopIcon : PlayIcon}
                                    className={`size-3.5 ${isRunning ? "text-amber-400" : "text-emerald-400"}`}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-[10px]">
                                {isRunning ? t("docker.stop") : t("docker.start")}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 hover:bg-foreground/10 rounded"
                                  disabled={isBusy}
                                  onClick={() => handleAction(c.id, "restart")}
                                >
                                  <HugeiconsIcon icon={RefreshIcon} className="size-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-[10px]">
                                {t("docker.restart")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>

                        {/* Stats & Ports */}
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                          <div className="flex items-center gap-2 font-mono">
                            {cStats ? (
                              <>
                                <span>CPU: <strong className="text-foreground">{cStats.cpu_percent}%</strong></span>
                                <span>RAM: <strong className="text-foreground">{cStats.memory_percent}%</strong> ({formatBytes(cStats.memory_usage_bytes)})</span>
                              </>
                            ) : (
                              <span>{c.status}</span>
                            )}
                          </div>

                          {c.ports.length > 0 && (
                            <div className="flex items-center gap-1">
                              {c.ports.slice(0, 2).map((p, idx) => (
                                <span
                                  key={idx}
                                  className="px-1 py-0.2 rounded bg-muted/60 text-[9.5px] font-mono"
                                >
                                  {p.public_port ? `${p.public_port}:${p.private_port}` : p.private_port}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Logs Modal */}
      <DockerLogsModal
        container={logsModalContainer}
        onClose={() => setLogsModalContainer(null)}
      />
    </>
  );
}
