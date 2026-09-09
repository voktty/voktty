import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { useTranslation } from "@/modules/i18n";
import {
  CloudIcon,
  CodeIcon,
  ComputerTerminal02Icon,
  DatabaseIcon,
  Folder01Icon,
  GitBranchIcon,
  Globe02Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { isTabAgentIconId, TAB_ICON_IDS, type TabIconId } from "./lib/tabIcon";

export function TabIconGlyph({
  icon,
  className,
}: {
  icon: TabIconId;
  className?: string;
}) {
  if (isTabAgentIconId(icon)) {
    return <AgentIcon agent={icon} size={14} className={className} />;
  }
  const shared = { size: 14, strokeWidth: 2, className };
  switch (icon) {
    case "terminal":
      return <HugeiconsIcon icon={ComputerTerminal02Icon} {...shared} />;
    case "server":
      return <HugeiconsIcon icon={ServerStack01Icon} {...shared} />;
    case "database":
      return <HugeiconsIcon icon={DatabaseIcon} {...shared} />;
    case "cloud":
      return <HugeiconsIcon icon={CloudIcon} {...shared} />;
    case "folder":
      return <HugeiconsIcon icon={Folder01Icon} {...shared} />;
    case "code":
      return <HugeiconsIcon icon={CodeIcon} {...shared} />;
    case "browser":
    case "api":
      return <HugeiconsIcon icon={Globe02Icon} {...shared} />;
    case "git":
      return <HugeiconsIcon icon={GitBranchIcon} {...shared} />;
  }
}

export function TabIconPicker({
  current,
  onSelect,
}: {
  current?: TabIconId | null;
  onSelect: (icon: TabIconId | null) => void;
}) {
  const { t } = useTranslation();
  const choices: Array<{ id: TabIconId | null; glyph: ReactNode }> = [
    {
      id: null,
      glyph: <span className="text-[10px] font-semibold">A</span>,
    },
    ...TAB_ICON_IDS.map((id) => ({
      id,
      glyph: <TabIconGlyph icon={id} className="size-3.5" />,
    })),
  ];

  return (
    <div className="grid grid-cols-7 gap-1" data-no-drag>
      {choices.map(({ id, glyph }) => {
        const selected = (current ?? null) === id;
        const label = id ?? t("tabs.automaticIcon");
        return (
          <button
            key={id ?? "automatic"}
            type="button"
            title={label}
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(id);
            }}
            className={cn(
              "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              selected && "bg-accent text-foreground ring-1 ring-primary/50",
            )}
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}
