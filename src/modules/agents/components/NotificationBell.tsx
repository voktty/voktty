import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import type { GitDiffOpenInput } from "@/modules/tabs";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Folder01Icon,
  GitCompareIcon,
  Loading03Icon,
  Notification01Icon,
  Notification03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { AgentIcon } from "../lib/agentIcon";
import { displayAgent } from "../lib/format";
import type { AgentNotification, AgentStatus } from "../lib/types";
import { useAgentStore } from "../store/agentStore";

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
  onActivateLocal: () => void;
  onOpenDiff?: (input: GitDiffOpenInput, pin?: boolean) => void;
};

function relativeTime(
  ts: number,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t("agents.timeJustNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("agents.timeMinAgo", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("agents.timeHourAgo", { h });
  return t("agents.timeDayAgo", { d: Math.floor(h / 24) });
}

function StatusRow({
  agent,
  status,
  onClick,
}: {
  agent: string;
  status: AgentStatus;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const waiting = status === "waiting";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <AgentIcon
        agent={agent}
        size={16}
        className="shrink-0 text-muted-foreground"
      />
      <span className="flex-1 truncate text-sm text-foreground">
        {displayAgent(agent)}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs",
          waiting ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {waiting ? <span className="size-1.5 rounded-full bg-primary" /> : null}
        {waiting ? t("agents.statusWaiting") : t("agents.statusWorking")}
      </span>
    </button>
  );
}

function getNotifLabel(
  kind: AgentNotification["kind"],
  t: (k: string) => string,
): string {
  switch (kind) {
    case "attention":
      return t("agents.notifNeedsInput");
    case "finished":
      return t("agents.notifFinished");
    case "error":
      return t("agents.notifFailed");
  }
}

const HOOK_AGENTS = ["claude", "codex", "gemini", "pi", "kimi"] as const;

function HookAgentRow({
  id,
  label,
  ready,
  installing,
  onEnable,
}: {
  id: string;
  label: string;
  ready: boolean;
  installing: boolean;
  onEnable: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <AgentIcon agent={id} size={14} className="shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-[12px] text-muted-foreground">
        {label}
      </span>
      {ready ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={13}
            strokeWidth={1.75}
          />
          {t("agents.hookEnabled")}
        </span>
      ) : (
        <button
          type="button"
          onClick={onEnable}
          disabled={installing}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
        >
          {installing ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={12}
              strokeWidth={1.75}
              className="animate-spin"
            />
          ) : null}
          {installing ? t("agents.hookEnabling") : t("agents.hookEnable")}
        </button>
      )}
    </div>
  );
}

function AgentDiffCard({
  n,
  onOpenDiff,
  onActivate,
  onDismiss,
}: {
  n: AgentNotification;
  onOpenDiff?: (input: GitDiffOpenInput, pin?: boolean) => void;
  onActivate: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [staged, setStaged] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const diff = n.diffStat;

  if (!diff) return null;

  const handleStageAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!diff.repoRoot) return;
    try {
      await native.gitStage(
        diff.repoRoot,
        diff.files.map((f) => f.path),
      );
      setStaged(true);
    } catch (err) {
      console.warn("[voktty] failed to stage agent changes:", err);
    }
  };

  const handleDiscardAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!diff.repoRoot) return;
    try {
      await native.gitDiscard(
        diff.repoRoot,
        diff.files.map((f) => ({
          path: f.path,
          untracked: f.status === "added",
        })),
      );
      setDiscarded(true);
      setTimeout(() => onDismiss(), 1000);
    } catch (err) {
      console.warn("[voktty] failed to discard agent changes:", err);
    }
  };

  const handleOpenFullDiff = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (diff.repoRoot && onOpenDiff) {
      const firstPath = diff.files[0]?.path ?? "";
      onOpenDiff(
        {
          repoRoot: diff.repoRoot,
          path: firstPath,
          mode: "-",
        },
        true,
      );
    }
  };

  const handleOpenFileDiff = (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    if (diff.repoRoot && onOpenDiff) {
      onOpenDiff(
        {
          repoRoot: diff.repoRoot,
          path: filePath,
          mode: "-",
        },
        true,
      );
    }
  };

  return (
    <div
      onClick={onActivate}
      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-2.5 transition-all hover:border-border hover:bg-muted/30"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AgentIcon agent={n.agent} size={15} className="shrink-0" />
          <span className="text-xs font-semibold text-foreground">
            {displayAgent(n.agent)}
          </span>
          <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary">
            {getNotifLabel(n.kind, t)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] tabular-nums text-muted-foreground/80">
            {relativeTime(n.at, t)}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t("agents.dismissNotification")}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Impact Stats */}
      <div className="flex items-center gap-1.5 text-[11px] font-mono">
        <span className="inline-flex items-center gap-0.5 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-500 dark:text-emerald-400">
          +{diff.additions}
        </span>
        <span className="inline-flex items-center gap-0.5 rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 font-semibold text-rose-500 dark:text-rose-400">
          -{diff.deletions}
        </span>
        <span className="flex items-center gap-1 rounded border border-border/40 bg-background/50 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
          <HugeiconsIcon icon={Folder01Icon} size={11} strokeWidth={1.75} />
          <span>{t("agents.diffFiles", { count: diff.filesChanged })}</span>
        </span>
      </div>

      {/* Files List Preview */}
      <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-lg border border-border/30 bg-background/50 p-1.5 text-[11px]">
        {diff.files.slice(0, 5).map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={(e) => handleOpenFileDiff(e, f.path)}
            className="group/file flex items-center justify-between gap-1.5 rounded px-1.5 py-0.5 text-left text-foreground/90 transition-colors hover:bg-accent"
          >
            <span className="truncate font-mono text-[10.5px]">{f.path}</span>
            <div className="flex shrink-0 items-center gap-1 text-[9.5px] font-mono">
              {f.additions > 0 ? (
                <span className="text-emerald-500">+{f.additions}</span>
              ) : null}
              {f.deletions > 0 ? (
                <span className="text-rose-500">-{f.deletions}</span>
              ) : null}
              <span className="text-muted-foreground/60 opacity-0 group-hover/file:opacity-100">
                {t("agents.diffPreview")}
              </span>
            </div>
          </button>
        ))}
        {diff.files.length > 5 ? (
          <div className="px-1 text-[10px] text-muted-foreground italic">
            {t("agents.diffMoreFiles", { count: diff.files.length - 5 })}
          </div>
        ) : null}
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center justify-between gap-1 pt-0.5">
        <Button
          variant="secondary"
          size="xs"
          className="h-6 gap-1 px-2 text-[10.5px] font-medium"
          onClick={handleOpenFullDiff}
        >
          <HugeiconsIcon icon={GitCompareIcon} size={11} strokeWidth={2} />
          <span>{t("agents.viewDiff")}</span>
        </Button>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            disabled={discarded}
            className="h-6 gap-1 px-2 text-[10.5px] text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
            onClick={handleDiscardAll}
            title={t("agents.discardAndRevert")}
          >
            <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={2} />
            <span>
              {discarded ? t("agents.reverted") : t("agents.discard")}
            </span>
          </Button>

          <Button
            variant="outline"
            size="xs"
            disabled={staged}
            className="h-6 gap-1 px-2 text-[10.5px] text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600"
            onClick={handleStageAll}
            title={t("agents.stageChanges")}
          >
            <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2} />
            <span>{staged ? t("agents.staged") : t("agents.stage")}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function NotificationRow({
  n,
  onClick,
  onDismiss,
}: {
  n: AgentNotification;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          {n.kind === "finished" ? (
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={15}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
          ) : (
            <span
              className={cn(
                "size-1.5 rounded-full",
                n.kind === "error" ? "bg-destructive" : "bg-primary",
              )}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {displayAgent(n.agent)}{" "}
          <span className="text-muted-foreground">
            {getNotifLabel(n.kind, t)}
          </span>
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {relativeTime(n.at, t)}
        </span>
      </button>

      <button
        type="button"
        onClick={onDismiss}
        className="cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        title={t("agents.dismissNotification")}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function NotificationBell({
  onActivate,
  onActivateLocal,
  onOpenDiff,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hooks, setHooks] = useState<Record<string, boolean>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const sessions = useAgentStore((s) => s.sessions);
  const localAgent = useAgentStore((s) => s.localAgent);
  const notifications = useAgentStore((s) => s.notifications);
  const markAllRead = useAgentStore((s) => s.markAllRead);
  const removeNotification = useAgentStore((s) => s.removeNotification);
  const clearNotifications = useAgentStore((s) => s.clearNotifications);

  const active = useMemo(() => Object.values(sessions), [sessions]);
  const activeCount = active.length + (localAgent ? 1 : 0);
  const waitingCount =
    active.filter((s) => s.status === "waiting").length +
    (localAgent?.status === "waiting" ? 1 : 0);
  // attention maps to an active waiting session, so only completed events add
  // to the badge to avoid double-counting.
  const unreadDone = notifications.filter(
    (n) => !n.read && n.kind !== "attention",
  ).length;
  const badge = waitingCount + unreadDone;
  const enabledCount = HOOK_AGENTS.filter((id) => hooks[id] === true).length;

  const refreshHooks = () => {
    for (const id of HOOK_AGENTS) {
      invoke<boolean>("agent_hooks_status", { agent: id })
        .then((ok) => setHooks((h) => ({ ...h, [id]: ok })))
        .catch(() => setHooks((h) => ({ ...h, [id]: false })));
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      markAllRead();
      refreshHooks();
    }
  };

  const enableHooks = async (id: string) => {
    setInstalling(id);
    try {
      await invoke("agent_enable_hooks", { agent: id });
      setHooks((h) => ({ ...h, [id]: true }));
    } catch {
      setHooks((h) => ({ ...h, [id]: false }));
    } finally {
      setInstalling(null);
    }
  };

  const activate = (tabId: number, leafId: number) => {
    onActivate(tabId, leafId);
    setOpen(false);
  };

  const activateLocal = () => {
    onActivateLocal();
    setOpen(false);
  };

  const activateNotification = (n: AgentNotification) => {
    if (n.source === "local") activateLocal();
    else activate(n.tabId, n.leafId);
  };

  const empty = activeCount === 0 && notifications.length === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("header.notifications")}
        >
          <HugeiconsIcon
            icon={Notification01Icon}
            size={16}
            strokeWidth={1.75}
          />
          {badge > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-96 max-w-[95vw] overflow-hidden p-0 gap-0.5 rounded-xl border border-border/60 bg-popover/95 backdrop-blur-xl shadow-2xl"
      >
        <div className="flex h-10 items-center gap-2 px-3 pt-0.5 border-b border-border/40">
          <span className="flex gap-1 text-[13px] font-semibold text-foreground">
            {t("header.notifications")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {activeCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {t("agents.activeBadge", { count: activeCount })}
              </span>
            ) : null}
            {notifications.length > 0 ? (
              <button
                type="button"
                onClick={clearNotifications}
                className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {t("agents.clearAll")}
              </button>
            ) : null}
          </div>
        </div>

        {empty ? (
          <div className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            {t("agents.noNotifications")}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto p-2 flex flex-col gap-2">
            {localAgent ? (
              <StatusRow
                agent={localAgent.agent}
                status={localAgent.status}
                onClick={activateLocal}
              />
            ) : null}
            {active.map((s) => (
              <StatusRow
                key={s.leafId}
                agent={s.agent}
                status={s.status}
                onClick={() => activate(s.tabId, s.leafId)}
              />
            ))}
            {activeCount > 0 && notifications.length > 0 ? (
              <div className="my-0.5 h-px bg-border/50" />
            ) : null}

            {notifications.map((n) =>
              n.diffStat ? (
                <AgentDiffCard
                  key={n.id}
                  n={n}
                  onOpenDiff={onOpenDiff}
                  onActivate={() => activateNotification(n)}
                  onDismiss={() => removeNotification(n.id)}
                />
              ) : (
                <NotificationRow
                  key={n.id}
                  n={n}
                  onClick={() => activateNotification(n)}
                  onDismiss={() => removeNotification(n.id)}
                />
              ),
            )}
          </div>
        )}

        <div className="border-t border-border/60 p-1 bg-muted/20">
          <button
            type="button"
            onClick={() => setAlertsOpen((v) => !v)}
            aria-expanded={alertsOpen}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Notification03Icon}
              size={11}
              strokeWidth={2}
            />
            {t("agents.agentAlerts")}
            <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
              {enabledCount > 0 ? (
                <span className="text-[10px] text-muted-foreground/60">
                  {t("agents.alertsOnBadge", { count: enabledCount })}
                </span>
              ) : null}
              <HugeiconsIcon
                icon={alertsOpen ? ArrowUp01Icon : ArrowDown01Icon}
                size={13}
                strokeWidth={2}
              />
            </span>
          </button>
          {alertsOpen
            ? HOOK_AGENTS.map((id) => (
                <HookAgentRow
                  key={id}
                  id={id}
                  label={displayAgent(id)}
                  ready={hooks[id] === true}
                  installing={installing === id}
                  onEnable={() => enableHooks(id)}
                />
              ))
            : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
