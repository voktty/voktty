import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDiagnosticsStore } from "@/modules/editor/lib/diagnosticsStore";
import {
  collectWorkspaceProblems,
  summarizeProblems,
} from "@/modules/editor/lib/problems";
import { useTranslation } from "@/modules/i18n";
import { playVokttySoundThrottled, problemSoundCue } from "@/modules/sound";
import {
  Alert02Icon,
  FileSearchIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  HierarchyIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import type { SidebarViewId } from "./types";

export const SIDEBAR_RAIL_WIDTH = 44;

type RailItem = {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  badge?: number;
  badgeTone?: "neutral" | "warning" | "danger";
};

type Props = {
  activeView: SidebarViewId | null;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
  workspaceRoot: string | null;
  /** Above the view icons: the permanent entry to the Harness. */
  header?: ReactNode;
  /** Pinned to the bottom of the bar, below the view icons. */
  footer?: ReactNode;
};

export function SidebarRail({
  activeView,
  onSelectView,
  changedCount,
  workspaceRoot,
  header,
  footer,
}: Props) {
  const { t } = useTranslation();
  const problemDocuments = useDiagnosticsStore(
    (state) => state.problemDocuments,
  );
  const problemSummary = useMemo(
    () =>
      summarizeProblems(
        collectWorkspaceProblems(problemDocuments, workspaceRoot),
      ),
    [problemDocuments, workspaceRoot],
  );
  const previousProblemsRef = useRef<{
    root: string | null;
    summary: typeof problemSummary;
  } | null>(null);
  useEffect(() => {
    const previous = previousProblemsRef.current;
    previousProblemsRef.current = { root: workspaceRoot, summary: problemSummary };
    if (!previous || previous.root !== workspaceRoot) return;
    if (
      problemSummary.total === 0 ||
      (problemSummary.errors === previous.summary.errors &&
        problemSummary.warnings === previous.summary.warnings &&
        problemSummary.information === previous.summary.information &&
        problemSummary.hints === previous.summary.hints)
    ) {
      return;
    }
    const cue = problemSoundCue(problemSummary);
    if (cue) playVokttySoundThrottled(cue, "problems", 650);
  }, [problemSummary, workspaceRoot]);
  const items: RailItem[] = [
    { id: "explorer", label: t("sidebar.files"), icon: FolderTreeIcon },
    { id: "search", label: t("sidebar.search"), icon: FileSearchIcon },
    { id: "outline", label: t("sidebar.outline"), icon: HierarchyIcon },
    {
      id: "problems",
      label: t("sidebar.problems"),
      icon: Alert02Icon,
      badge: problemSummary.total,
      badgeTone:
        problemSummary.errors > 0
          ? "danger"
          : problemSummary.warnings > 0
            ? "warning"
            : "neutral",
    },
    {
      id: "run-debug",
      label: t("sidebar.runDebug"),
      icon: PlayIcon,
    },
    {
      id: "source-control",
      label: t("sidebar.git"),
      icon: FolderGitTwoIcon,
      badge: changedCount,
    },
  ];

  return (
    <div
      style={{ width: SIDEBAR_RAIL_WIDTH }}
      className="flex shrink-0 flex-col items-stretch gap-0.5 border-r border-content/10 bg-content/[0.025] px-1 py-1"
    >
      {header ? (
        <>
          {header}
          <div aria-hidden className="mx-2 my-0.5 border-t border-content/10" />
        </>
      ) : null}
      {items.map((item) => {
        const isActive = item.id === activeView;
        const badge = item.badge ?? 0;
        const showBadge = badge > 0;
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={item.label}
                aria-pressed={isActive}
                onClick={() => onSelectView(item.id)}
                className="group flex h-10 shrink-0 cursor-pointer items-center justify-center text-content/50 outline-none transition-colors duration-[var(--dur-base)] hover:text-content"
              >
                <span
                  className={cn(
                    "relative inline-flex size-6.5 items-center justify-center rounded-md transition-colors duration-[var(--dur-base)]",
                    "group-hover:bg-content/10 group-focus-visible:ring-2 group-focus-visible:ring-primary/40",
                    isActive &&
                      "bg-content/10 text-content",
                  )}
                >
                  <HugeiconsIcon
                    icon={item.icon}
                    size={18}
                    strokeWidth={isActive ? 2 : 1.75}
                    className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
                  />
                  {showBadge ? (
                    <span
                      className={cn(
                        "absolute -right-1.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-0.5 text-[8.5px] font-semibold leading-none tabular-nums",
                        item.badgeTone === "danger"
                          ? "border-destructive/50 bg-destructive text-destructive-foreground"
                          : item.badgeTone === "warning"
                            ? "border-amber-500/50 bg-amber-500 text-black"
                            : "border-border/60 bg-card text-muted-foreground/95",
                      )}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {footer ? (
        <div className="mt-auto flex flex-col items-center pb-1">{footer}</div>
      ) : null}
    </div>
  );
}
