import { memo, useEffect, useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "@/modules/i18n";
import { cn } from "@/lib/utils";
import {
  Clock01Icon,
  Folder01Icon,
  SparklesIcon,
  Time02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  formatHoursDecimal,
  getSessionDurationFormatted,
  getSessionHours,
  getTopActivePaths,
  getUptimeColorLevel,
  getWeeklyBreakdown,
  useUptimeStore,
} from "../lib/uptimeStore";

type Props = {
  cwd?: string | null;
  className?: string;
};

export const ConsoleUptimeWidget = memo(function ConsoleUptimeWidget({
  cwd,
  className,
}: Props) {
  const { t } = useTranslation();
  const sessionStart = useUptimeStore((s) => s.sessionStart);
  const history = useUptimeStore((s) => s.history);
  const tick = useUptimeStore((s) => s.tick);

  // Force local periodic re-renders so session duration increments in real-time
  const [, setTickCounter] = useState(0);

  useEffect(() => {
    // Record active time every 10 seconds
    const interval = setInterval(() => {
      tick(cwd, 10);
      setTickCounter((c) => c + 1);
    }, 10000);

    return () => clearInterval(interval);
  }, [cwd, tick]);

  const sessionHours = getSessionHours(sessionStart);
  const sessionDuration = getSessionDurationFormatted(sessionStart);
  const colorLevel = getUptimeColorLevel(sessionHours);
  const weekly = getWeeklyBreakdown(history);
  const topPaths = getTopActivePaths(history, 4);

  const [open, setOpen] = useState(false);

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${t("statusbar.uptime.title")}: ${sessionHours}H`}
          className={cn(
            "group/uptime inline-flex h-5.5 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-all shadow-none select-none cursor-pointer active:scale-97",
            colorLevel.badgeClass,
            className,
          )}
        >
          <HugeiconsIcon
            icon={Clock01Icon}
            size={11}
            strokeWidth={2}
            className="shrink-0 opacity-85 group-hover/uptime:opacity-100 transition-opacity"
          />
          <span className="font-mono text-[10px] font-bold tracking-tight">
            {sessionHours}H
          </span>
          <span
            className={cn(
              "size-1.5 rounded-full shrink-0 shadow-xs",
              colorLevel.dotClass,
            )}
          />
        </button>
      </HoverCardTrigger>

      <HoverCardContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 p-3 bg-popover/95 backdrop-blur-md border border-border/70 rounded-xl shadow-2xl space-y-3 select-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={cn(
                "flex size-6 items-center justify-center rounded-lg border shrink-0",
                colorLevel.badgeClass,
              )}
            >
              <HugeiconsIcon icon={Time02Icon} size={13} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-foreground tracking-tight leading-none">
                {t("statusbar.uptime.title")}
              </h4>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {t("statusbar.uptime.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[9.5px] font-medium text-muted-foreground">
              {t("statusbar.uptime.activeNow")}
            </span>
            <span className="font-mono text-xs font-bold text-primary">
              {sessionDuration}
            </span>
          </div>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="flex flex-col rounded-lg bg-muted/40 border border-border/40 p-1.5 text-center">
            <span className="text-[9.5px] text-muted-foreground font-medium">
              {t("statusbar.uptime.today")}
            </span>
            <span className="font-mono text-xs font-bold text-foreground mt-0.5">
              {formatHoursDecimal(weekly.todaySeconds)}
            </span>
          </div>
          <div className="flex flex-col rounded-lg bg-muted/40 border border-border/40 p-1.5 text-center">
            <span className="text-[9.5px] text-muted-foreground font-medium">
              {t("statusbar.uptime.thisWeek")}
            </span>
            <span className="font-mono text-xs font-bold text-foreground mt-0.5">
              {formatHoursDecimal(weekly.totalWeekSeconds)}
            </span>
          </div>
          <div className="flex flex-col rounded-lg bg-muted/40 border border-border/40 p-1.5 text-center">
            <span className="text-[9.5px] text-muted-foreground font-medium">
              {t("statusbar.uptime.dailyAvg")}
            </span>
            <span className="font-mono text-xs font-bold text-foreground mt-0.5">
              {formatHoursDecimal(weekly.dailyAvgSeconds)}
            </span>
          </div>
        </div>

        {/* Weekly Bar Chart */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium px-0.5">
            <span>{t("statusbar.uptime.weeklyChart")}</span>
            <span className="font-mono text-[9.5px]">7D</span>
          </div>
          <div className="flex items-end justify-between gap-1.5 h-16 pt-2 pb-1 px-1 bg-muted/20 border border-border/30 rounded-lg">
            {weekly.days.map((day) => (
              <div
                key={day.date}
                className="flex flex-col items-center flex-1 h-full justify-end group/bar relative"
                title={`${day.date}: ${day.hoursFormatted}`}
              >
                <div className="w-full flex-1 flex items-end justify-center">
                  <div
                    className={cn(
                      "w-3 rounded-t-sm transition-all duration-300",
                      day.isToday
                        ? "bg-primary shadow-xs"
                        : day.seconds > 0
                          ? "bg-muted-foreground/40 group-hover/bar:bg-primary/70"
                          : "bg-muted/40",
                    )}
                    style={{ height: `${day.percentage}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "text-[9px] font-mono mt-1",
                    day.isToday
                      ? "font-bold text-primary"
                      : "text-muted-foreground/70",
                  )}
                >
                  {day.dayLabel.slice(0, 2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Active Workspaces */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium px-0.5">
            <span>{t("statusbar.uptime.topPaths")}</span>
          </div>
          {topPaths.length === 0 ? (
            <div className="text-[10px] text-muted-foreground/70 text-center py-2 bg-muted/20 rounded-md border border-border/30">
              {t("statusbar.uptime.noPaths")}
            </div>
          ) : (
            <div className="space-y-1.5 bg-muted/20 border border-border/30 rounded-lg p-2">
              {topPaths.map((item) => (
                <div key={item.path} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5 min-w-0 max-w-[70%]">
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        size={11}
                        className="text-muted-foreground shrink-0"
                      />
                      <span className="truncate font-mono font-medium text-foreground text-[10px]" title={item.path}>
                        {item.name}
                      </span>
                    </div>
                    <span className="font-mono text-[9.5px] text-muted-foreground shrink-0">
                      {item.hoursFormatted} ({item.percentage}%)
                    </span>
                  </div>
                  <Progress value={item.percentage} className="h-1 bg-muted" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Health / Break Reminder if long session */}
        {sessionHours >= 3 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 text-amber-600 dark:text-amber-400">
            <HugeiconsIcon icon={SparklesIcon} size={13} className="shrink-0 text-amber-500" />
            <p className="text-[10px] leading-tight font-medium">
              {t("statusbar.uptime.takeBreak")}
            </p>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
});
