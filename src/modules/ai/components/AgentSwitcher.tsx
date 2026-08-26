import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  AbsoluteIcon,
  ArrowDown01Icon,
  CodeIcon,
  PaintBrush04Icon,
  PencilEdit02Icon,
  Settings01Icon,
  ShieldUserIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { AgentAvatar } from "../avatar/AgentAvatar";
import { useChatAvatarPresence } from "../avatar/useChatAvatarPresence";
import type { Agent, AgentIconId } from "../lib/agents";
import { useChatStore } from "../store/chatStore";
import { useAgentsStore } from "../store/agentsStore";

const ICONS: Record<AgentIconId, typeof CodeIcon> = {
  coder: CodeIcon,
  architect: AbsoluteIcon,
  reviewer: PencilEdit02Icon,
  security: ShieldUserIcon,
  designer: PaintBrush04Icon,
  spark: SparklesIcon,
};

type Translate = (key: string) => string;

function agentText(agent: Agent, field: "name" | "description", t: Translate): string {
  if (!agent.builtIn) return agent[field];
  const id = agent.id.replace("builtin:", "");
  return t(`ai.agentSwitcher.agents.${id}.${field}`);
}

export function AgentSwitcher({ isMiniWindow }: { isMiniWindow?: boolean } = {}) {
  void isMiniWindow;
  const { t } = useTranslation();
  // Subscribe to customAgents + activeId so the trigger updates live.
  const customAgents = useAgentsStore((s) => s.customAgents);
  const activeId = useAgentsStore((s) => s.activeId);
  const setActiveId = useAgentsStore((s) => s.setActiveId);
  const chatPresence = useChatAvatarPresence();
  const chatStatus = useChatStore((s) => s.agentMeta.status);

  const list = useAgentsStore.getState().all();
  void customAgents; // keeps the store subscription alive

  const active = list.find((a) => a.id === activeId) ?? list[0];
  const builtIn = list.filter((a) => a.builtIn);
  const custom = list.filter((a) => !a.builtIn);
  const ActiveIcon = ICONS[active.icon] ?? SparklesIcon;
  const activeName = agentText(active, "name", t);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          className={cn(
            "flex h-6 min-w-0 items-center gap-1 rounded-md border border-border/60 bg-card/60 px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground shrink-0",
          )}
          title={t("ai.agentSwitcher.activeTitle", { name: activeName })}
        >
          <AgentAvatar
            agent={active}
            presence={chatPresence}
            size="xs"
            decorative
            className={chatStatus === "idle" ? "opacity-90" : undefined}
            fallback={
              <HugeiconsIcon
                icon={ActiveIcon}
                size={11}
                strokeWidth={1.75}
                className="shrink-0"
              />
            }
          />
          <span className="max-w-20 sm:max-w-28 truncate font-medium">{activeName}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className="opacity-70 shrink-0"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {t("ai.agentSwitcher.builtIn")}
        </div>
        {builtIn.map((a) => {
          const Icon = ICONS[a.icon] ?? SparklesIcon;
          return (
            <DropdownMenuItem
              key={a.id}
              onSelect={() => setActiveId(a.id)}
              className={cn(
                "flex items-start gap-2 pr-2 text-[12px]",
                a.id === activeId && "bg-accent/40",
              )}
            >
              <HugeiconsIcon
                icon={Icon}
                size={13}
                strokeWidth={1.75}
                className={cn(
                  "mt-0.5",
                  a.id === activeId
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{agentText(a, "name", t)}</span>
                <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                  {agentText(a, "description", t)}
                </span>
              </span>
              {a.id === activeId ? (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={12}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-foreground"
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
        {custom.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 pt-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("ai.agentSwitcher.custom")}
            </div>
            {custom.map((a) => {
              const Icon = ICONS[a.icon] ?? SparklesIcon;
              return (
                <DropdownMenuItem
                  key={a.id}
                  onSelect={() => setActiveId(a.id)}
                  className={cn(
                    "flex items-start gap-2 text-[12px]",
                    a.id === activeId && "bg-accent/40",
                  )}
                >
                  <HugeiconsIcon
                    icon={Icon}
                    size={13}
                    strokeWidth={1.75}
                    className="mt-0.5 text-muted-foreground"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{a.name}</span>
                    {a.description ? (
                      <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                        {a.description}
                      </span>
                    ) : null}
                  </span>
                  {a.id === activeId ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={12}
                      strokeWidth={2}
                      className="mt-0.5 shrink-0 text-foreground"
                    />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void openSettingsWindow("agents")}
          className="gap-2 text-[12px] text-muted-foreground"
        >
          <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
          {t("settings.tabs.agents")}…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ICONS as AGENT_ICONS };
