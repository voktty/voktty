import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  FolderCloudIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitPullRequestIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { GitWorkbenchSection } from "../types";

type Props = {
  activeSection: GitWorkbenchSection;
  onSelectSection: (section: GitWorkbenchSection) => void;
};

type NavItem = {
  id: GitWorkbenchSection;
  labelKey: string;
  icon: typeof FolderGitTwoIcon;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "history",
    labelKey: "gitHistory.workbench.sections.history",
    icon: FolderGitTwoIcon,
  },
  {
    id: "branches",
    labelKey: "gitHistory.workbench.sections.branches",
    icon: GitBranchIcon,
  },
  {
    id: "pulls",
    labelKey: "gitHistory.workbench.sections.pulls",
    icon: GitPullRequestIcon,
  },
  {
    id: "worktrees",
    labelKey: "gitHistory.workbench.sections.worktrees",
    icon: FolderTreeIcon,
  },
  {
    id: "tags-stashes",
    labelKey: "gitHistory.workbench.sections.tagsStashes",
    icon: Tag01Icon,
  },
  {
    id: "remotes",
    labelKey: "gitHistory.workbench.sections.remotes",
    icon: FolderCloudIcon,
  },
  {
    id: "compare",
    labelKey: "gitHistory.workbench.sections.compare",
    icon: GitCompareIcon,
  },
];

export function GitWorkbenchNav({ activeSection, onSelectSection }: Props) {
  const { t } = useTranslation();

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/40 bg-muted/10 py-2.5 select-none"
        aria-label={t("gitHistory.workbench.title")}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;
          const label = t(item.labelKey);

          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSelectSection(item.id)}
                  aria-pressed={isActive}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-all",
                    "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isActive &&
                      "bg-accent text-accent-foreground font-medium shadow-xs"
                  )}
                >
                  {isActive && (
                    <span
                      className="absolute -left-1.5 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary"
                      aria-hidden="true"
                    />
                  )}
                  <HugeiconsIcon
                    icon={item.icon}
                    size={17}
                    strokeWidth={isActive ? 2.1 : 1.7}
                  />
                  <span className="sr-only">{label}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <span>{label}</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </aside>
    </TooltipProvider>
  );
}
