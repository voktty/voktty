import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { resolveDisplayName } from "@/modules/editor/lib/languageResolver";
import { useTranslation } from "@/modules/i18n";
import { useEnvironmentMetrics } from "@/modules/ssh";
import {
  getLeafTerminalStats,
  leafCwd,
  useAgentActivityStore,
  ptyIdForLeaf,
} from "@/modules/terminal";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  Clock01Icon,
  Loading03Icon,
  PinIcon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  isAnyContextMenuOpen,
  useTabContextMenuStore,
} from "../lib/tabContextMenuState";
import { formatUptime, getTabUptimeMs } from "../lib/tabMetadata";
import { TAB_DETAILS_OPEN_DELAY_MS } from "../lib/tabHoverTiming";
import { useTabProcessStatus } from "../lib/useTabProcessStatus";
import type { Tab } from "../lib/useTabs";
import { TabIcon } from "../TabBar";

type Props = {
  tab: Tab;
  activeWorkspaceEnv?: WorkspaceEnv;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  openDelay?: number;
  closeDelay?: number;
};

function formatBytes(bytes: number, precision = 1): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return "0B";
  const units = ["B", "K", "M", "G", "T", "P"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const val = (bytes / 1024 ** i).toFixed(precision);
  const cleanVal = val.endsWith(".0") ? val.slice(0, -2) : val;
  return `${cleanVal}${units[i]}`;
}

function MiniGauge({
  label,
  percentage,
  topValue,
  bottomValue,
}: {
  label: string;
  percentage: number;
  topValue: string;
  bottomValue?: string;
}) {
  const clampPct = Math.min(Math.max(percentage, 0), 100);
  const size = 48;
  const strokeWidth = 3;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampPct / 100) * circumference;

  let strokeColor = "#10b981";
  if (clampPct > 85) strokeColor = "#ef4444";
  else if (clampPct > 70) strokeColor = "#f59e0b";

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg className="-rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            className="text-muted/20"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight select-none">
          <span className="text-[10px] font-semibold text-foreground tracking-tight">
            {topValue}
          </span>
          {bottomValue && (
            <span className="text-[8px] font-mono text-muted-foreground leading-none">
              {bottomValue}
            </span>
          )}
        </div>
      </div>
      <span className="text-[8px] font-bold tracking-wider uppercase text-muted-foreground select-none">
        {label}
      </span>
    </div>
  );
}

export const TabDetailsHoverCard = memo(function TabDetailsHoverCard({
  tab,
  activeWorkspaceEnv,
  children,
  side = "bottom",
  align = "start",
  openDelay = TAB_DETAILS_OPEN_DELAY_MS,
  closeDelay = 150,
}: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const isContextMenuOpen = useTabContextMenuStore((s) => s.isOpen);
  const [uptimeMs, setUptimeMs] = useState(() =>
    getTabUptimeMs(tab.id, tab.createdAt),
  );

  const procStatus = useTabProcessStatus(tab);
  const agentPhases = useAgentActivityStore((s) => s.phases);
  const agentNames = useAgentActivityStore((s) => s.agents);

  // Close immediately if a context menu is opened anywhere
  useEffect(() => {
    if (isContextMenuOpen && isOpen) {
      setIsOpen(false);
    }
  }, [isContextMenuOpen, isOpen]);

  // Also close immediately on any contextmenu (right click) action in the window
  useEffect(() => {
    const handleContextMenu = () => {
      setIsOpen(false);
    };
    window.addEventListener("contextmenu", handleContextMenu, {
      capture: true,
    });
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu, {
        capture: true,
      });
    };
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        if (isContextMenuOpen || isAnyContextMenuOpen()) {
          setIsOpen(false);
          return;
        }
      }
      setIsOpen(nextOpen);
    },
    [isContextMenuOpen],
  );

  // Determine active environment
  const targetEnv: WorkspaceEnv =
    tab.kind === "terminal" && tab.workspaceEnv
      ? tab.workspaceEnv
      : activeWorkspaceEnv || { kind: "local" };

  const isTerminal = tab.kind === "terminal";
  const { metrics, loading } = useEnvironmentMetrics(
    isOpen && isTerminal ? targetEnv : null,
    {
      enabled: isOpen && isTerminal,
      autoRefresh: true,
      intervalMs: 4000,
    },
  );

  useEffect(() => {
    if (!isOpen) return;
    setUptimeMs(getTabUptimeMs(tab.id, tab.createdAt));
    const timer = setInterval(() => {
      setUptimeMs(getTabUptimeMs(tab.id, tab.createdAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, tab.id, tab.createdAt]);

  const ptyId = tab.kind === "terminal" ? ptyIdForLeaf(tab.activeLeafId) : null;
  const activeAgent =
    (ptyId !== null ? agentNames[ptyId] : null) || procStatus.agent;
  const activePhase =
    (ptyId !== null ? agentPhases[ptyId] : null) || procStatus.state;

  const terminalStats =
    tab.kind === "terminal" ? getLeafTerminalStats(tab.activeLeafId) : null;

  const currentCwd =
    tab.kind === "terminal" ? leafCwd(tab.activeLeafId) || tab.cwd : undefined;

  // Environment / Category Name
  let categoryLabel = "";
  if (tab.kind === "terminal") {
    if (tab.workspaceEnv?.kind === "ssh") {
      categoryLabel = `SSH: ${tab.workspaceEnv.connection.name || tab.workspaceEnv.connection.host}`;
    } else if (tab.workspaceEnv?.kind === "wsl") {
      categoryLabel = `WSL: ${tab.workspaceEnv.distro}`;
    } else if (tab.workspaceEnv?.kind === "docker") {
      categoryLabel = `Docker: ${tab.workspaceEnv.connection.containerName || tab.workspaceEnv.connection.image}`;
    } else if (tab.workspaceEnv?.kind === "serial") {
      categoryLabel = `Serial: ${tab.workspaceEnv.portName}`;
    } else if (tab.blocks) {
      categoryLabel = t("tabs.hoverCard.terminalBlocks");
    } else {
      categoryLabel = t("tabs.hoverCard.terminalLocal");
    }
  } else if (tab.kind === "editor") {
    categoryLabel = tab.overrideLanguage || resolveDisplayName(tab.path);
  } else if (tab.kind === "markdown") {
    categoryLabel = t("tabs.hoverCard.markdownPreview");
  } else if (tab.kind === "preview") {
    categoryLabel = t("tabs.hoverCard.webPreview");
  } else if (tab.kind === "ai-diff") {
    categoryLabel = t("tabs.hoverCard.aiDiffReview");
  } else if (tab.kind === "git-diff") {
    categoryLabel = t("tabs.hoverCard.gitDiff");
  } else if (tab.kind === "git-history") {
    categoryLabel = t("tabs.hoverCard.gitHistory");
  } else if (tab.kind === "rdp") {
    categoryLabel = `RDP: ${tab.host}`;
  }

  const memPct =
    metrics && metrics.memTotalBytes > 0
      ? (metrics.memUsedBytes / metrics.memTotalBytes) * 100
      : 0;

  const diskPct =
    metrics && metrics.diskTotalBytes > 0
      ? (metrics.diskUsedBytes / metrics.diskTotalBytes) * 100
      : 0;

  return (
    <HoverCard
      open={isOpen && !isContextMenuOpen}
      openDelay={openDelay}
      closeDelay={closeDelay}
      onOpenChange={handleOpenChange}
    >
      <HoverCardTrigger asChild>
        <div
          className="flex h-full w-full max-w-full items-center"
          onFocusCapture={(e) => e.stopPropagation()}
          onPointerDownCapture={() => {
            setIsOpen(false);
          }}
        >
          {children}
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={6}
        className="z-50 w-[330px] p-3 rounded-xl border border-border/60 bg-popover/95 shadow-2xl backdrop-blur-xl text-foreground select-none pointer-events-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-border/40 pb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-7 items-center justify-center rounded-lg bg-accent/60 shrink-0">
              {activeAgent ? (
                <AgentIcon agent={activeAgent} size={15} />
              ) : (
                <TabIcon tab={tab} />
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-xs text-foreground truncate">
                  {tab.title}
                </span>
                {tab.locked && (
                  <HugeiconsIcon
                    icon={SquareLock01Icon}
                    size={11}
                    className="text-amber-500 shrink-0"
                  />
                )}
                {tab.kind === "editor" && tab.preview && (
                  <HugeiconsIcon
                    icon={PinIcon}
                    size={11}
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </div>
              <span className="text-[10px] text-muted-foreground font-medium truncate">
                {categoryLabel}
              </span>
            </div>
          </div>

          {/* Status Badge */}
          <div className="shrink-0">
            {activeAgent ? (
              activePhase === "working" ? (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                  <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                  {t("tabs.hoverCard.agentWorking")}
                </span>
              ) : activePhase === "attention" ? (
                <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                  <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
                  {t("tabs.hoverCard.agentWaiting")}
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {t("tabs.hoverCard.agentIdle")}
                </span>
              )
            ) : procStatus.state === "running" ? (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                {procStatus.progress
                  ? `${procStatus.progress}%`
                  : t("ai.tools.status.running")}
              </span>
            ) : tab.kind === "editor" ? (
              tab.dirty ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                  {t("tabs.hoverCard.unsaved")}
                </span>
              ) : (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t("tabs.hoverCard.saved")}
                </span>
              )
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {t("activeTabs.activeBadge")}
              </span>
            )}
          </div>
        </div>

        {/* Uptime Row */}
        <div className="flex items-center justify-between py-2 border-b border-border/40 text-[11px]">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <HugeiconsIcon icon={Clock01Icon} size={13} />
            {t("tabs.hoverCard.activeTime")}
          </span>
          <span className="font-mono font-medium text-foreground">
            {formatUptime(uptimeMs)}
          </span>
        </div>

        {/* Live Environment Metrics (CPU / MEM / DISK / NET) */}
        {isTerminal && (
          <div className="py-2.5 border-b border-border/40">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                {t("tabs.hoverCard.resources")}
              </span>
              {metrics?.pingMs !== undefined && (
                <span className="text-[9px] font-mono text-emerald-500">
                  {metrics.pingMs}ms ping
                </span>
              )}
            </div>

            {loading && !metrics ? (
              <div className="flex items-center justify-center py-3 text-muted-foreground gap-2 text-xs">
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="animate-spin text-primary"
                />
                <span>{t("tabs.hoverCard.loadingMetrics")}</span>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                <MiniGauge
                  label="CPU"
                  percentage={metrics?.cpuPercent ?? 0}
                  topValue={
                    metrics ? `${metrics.cpuPercent.toFixed(0)}%` : "--"
                  }
                />
                <MiniGauge
                  label="MEM"
                  percentage={memPct}
                  topValue={metrics ? formatBytes(metrics.memUsedBytes) : "--"}
                  bottomValue={
                    metrics ? formatBytes(metrics.memTotalBytes) : undefined
                  }
                />
                <MiniGauge
                  label="DISK"
                  percentage={diskPct}
                  topValue={metrics ? formatBytes(metrics.diskUsedBytes) : "--"}
                />
                <MiniGauge
                  label="NET"
                  percentage={
                    metrics
                      ? Math.min(
                          100,
                          (metrics.netRxBytes + metrics.netTxBytes) /
                            (1024 * 1024),
                        )
                      : 0
                  }
                  topValue={
                    metrics ? `↑${formatBytes(metrics.netTxBytes, 0)}` : "↑0B"
                  }
                  bottomValue={
                    metrics ? `↓${formatBytes(metrics.netRxBytes, 0)}` : "↓0B"
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* Tab Specific Context & Metadata */}
        <div className="pt-2 flex flex-col gap-1.5 text-[10px]">
          {currentCwd && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-muted-foreground shrink-0">
                {t("tabs.hoverCard.directory")}
              </span>
              <span
                className="font-mono text-foreground/90 truncate text-right max-w-[200px]"
                title={currentCwd}
              >
                {currentCwd}
              </span>
            </div>
          )}

          {tab.kind === "editor" && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-muted-foreground shrink-0">
                {t("tabs.hoverCard.file")}
              </span>
              <span
                className="font-mono text-foreground/90 truncate text-right max-w-[200px]"
                title={tab.path}
              >
                {tab.path}
              </span>
            </div>
          )}

          {terminalStats && (
            <div className="flex items-center justify-between text-muted-foreground font-mono">
              <span>
                {t("tabs.hoverCard.dimensions")}:{" "}
                <strong className="text-foreground">
                  {terminalStats.cols}×{terminalStats.rows}
                </strong>
              </span>
              <span>
                {t("tabs.hoverCard.buffer")}:{" "}
                <strong className="text-foreground">
                  {terminalStats.bufferLines}
                </strong>
              </span>
            </div>
          )}

          {tab.kind === "preview" && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-muted-foreground shrink-0">URL</span>
              <span
                className="font-mono text-foreground/90 truncate text-right max-w-[200px]"
                title={tab.url}
              >
                {tab.url}
              </span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
});
