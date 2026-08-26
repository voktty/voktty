import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CodeIcon,
  ContainerIcon,
  Copy01Icon,
  PlayIcon,
  Settings02Icon,
  SparklesIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useState } from "react";
import { toast } from "sonner";
import type { ScriptCategory } from "./types";
import { useProjectScripts } from "./useProjectScripts";

type Props = {
  cwd: string | null | undefined;
  onRun: (command: string) => void;
  onInsert?: (command: string) => void;
  className?: string;
};

function categoryIcon(cat: ScriptCategory) {
  switch (cat) {
    case "dev":
      return PlayIcon;
    case "build":
      return Wrench01Icon;
    case "test":
      return CheckmarkCircle02Icon;
    case "lint":
      return SparklesIcon;
    case "docker":
      return ContainerIcon;
    default:
      return Settings02Icon;
  }
}

function categoryColor(cat: ScriptCategory): string {
  switch (cat) {
    case "dev":
      return "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 border-emerald-500/30";
    case "build":
      return "text-sky-600 dark:text-sky-400 hover:bg-sky-500/15 border-sky-500/30";
    case "test":
      return "text-purple-600 dark:text-purple-400 hover:bg-purple-500/15 border-purple-500/30";
    case "lint":
      return "text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 border-amber-500/30";
    case "docker":
      return "text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/15 border-cyan-500/30";
    default:
      return "text-muted-foreground hover:bg-muted/80 border-border/50";
  }
}

export const ProjectScriptsHud = memo(function ProjectScriptsHud({
  cwd,
  onRun,
  onInsert,
  className,
}: Props) {
  const { t } = useTranslation();
  const { scripts } = useProjectScripts(cwd);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("voktty.scriptsHud.collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("voktty.scriptsHud.collapsed", String(next));
      } catch {}
      return next;
    });
  };

  if (!cwd || scripts.length === 0) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={cn(
          "flex items-center gap-1 px-2.5 py-0.5 text-[10.5px] border-b border-border/40 bg-card/60 backdrop-blur-sm transition-all select-none overflow-x-auto [scrollbar-width:none]",
          className,
        )}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="inline-flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground/80 hover:text-foreground transition-colors cursor-pointer shrink-0 mr-1"
          title={t("terminal.scripts.toggleHud")}
        >
          <HugeiconsIcon
            icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
            size={10}
            strokeWidth={2}
          />
          <HugeiconsIcon icon={CodeIcon} size={11} strokeWidth={1.75} />
          <span className="font-semibold text-[10px]">
            {t("terminal.scripts.title")}
          </span>
          <span className="text-[9px] rounded bg-muted/60 px-1 py-0.2 font-mono text-muted-foreground">
            {scripts.length}
          </span>
        </button>

        {!collapsed && (
          <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {scripts.slice(0, 10).map((script) => {
              const Icon = categoryIcon(script.category);
              const colorClass = categoryColor(script.category);

              return (
                <DropdownMenu key={script.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onRun(script.command)}
                        className={cn(
                          "group/pill inline-flex items-center gap-1 rounded border bg-background/80 px-1.5 py-0.5 text-[10px] font-medium transition-all shadow-xs hover:shadow-sm cursor-pointer shrink-0 active:scale-97",
                          colorClass,
                        )}
                      >
                        <HugeiconsIcon
                          icon={Icon}
                          size={10}
                          strokeWidth={2}
                          className="shrink-0"
                        />
                        <span className="truncate max-w-28 font-mono text-[10px]">
                          {script.name}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[10px] font-mono">
                      {script.command}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-48 text-[11px]">
                    <DropdownMenuItem
                      onClick={() => onRun(script.command)}
                      className="gap-2 cursor-pointer"
                    >
                      <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={2} />
                      <span>{t("terminal.scripts.run")}</span>
                    </DropdownMenuItem>
                    {onInsert && (
                      <DropdownMenuItem
                        onClick={() => onInsert(script.command)}
                        className="gap-2 cursor-pointer"
                      >
                        <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
                        <span>{t("terminal.scripts.pasteToPrompt")}</span>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        void navigator.clipboard.writeText(script.command);
                        toast.success(t("feedback.commandCopied"));
                      }}
                      className="gap-2 cursor-pointer"
                    >
                      <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={2} />
                      <span>{t("terminal.scripts.copyCommand")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});
