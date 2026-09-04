import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { useQuotaStore } from "../store/quotaStore";
import {
  Activity01Icon,
  AlertCircleIcon,
  Loading03Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

function formatResetDisplay(
  resetsAt?: string | null,
  resetsInSeconds?: number | null,
): string | null {
  if (resetsInSeconds !== undefined && resetsInSeconds !== null && resetsInSeconds > 0) {
    const days = Math.floor(resetsInSeconds / 86400);
    const hours = Math.floor((resetsInSeconds % 86400) / 3600);
    const minutes = Math.floor((resetsInSeconds % 3600) / 60);
    if (days > 1) {
      return `Resets in ${days}d ${hours}h`;
    }
    if (days === 1 || hours >= 6) {
      return `Resets in ${days > 0 ? `${days}d ` : ""}${hours}h`;
    }
    if (hours > 0) {
      return `Resets in ${hours}h ${minutes}m`;
    }
    return `Resets in ${minutes}m`;
  }

  if (!resetsAt) return null;
  const d = new Date(resetsAt);
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs > 0) {
    const diffSec = Math.floor(diffMs / 1000);
    const days = Math.floor(diffSec / 86400);
    const hours = Math.floor((diffSec % 86400) / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);

    if (days > 1) {
      return `Resets: ${d.toLocaleDateString([], { month: "short", day: "numeric" })} (${days}d)`;
    }
    if (days === 1 || hours >= 12) {
      return `Resets: ${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    if (hours > 0) {
      return `Resets in ${hours}h ${minutes}m`;
    }
    return `Resets in ${minutes}m`;
  }

  return `Resets: ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function QuotaUsageWidget() {
  const { t } = useTranslation();
  const { overview, loading, fetchOverview, refreshProvider } = useQuotaStore();
  const [open, setOpen] = useState(false);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  useEffect(() => {
    void fetchOverview();
    const interval = setInterval(() => {
      void fetchOverview();
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  const overallState = overview?.overallState ?? { kind: "healthy" };
  const isDanger =
    overallState.kind === "reached" ||
    overallState.kind === "rate_limited" ||
    overallState.kind === "unauthenticated";
  const isWarning = overallState.kind === "approaching";

  const totalCost = overview?.totalCostTodayUsd ?? 0;

  // Find the primary active window to display in the mini statusbar pill
  let displayPercent: number | null = null;
  if (overview?.providers) {
    for (const p of overview.providers) {
      for (const w of p.windows) {
        if (w.usedPercent > 0 && (displayPercent === null || w.usedPercent > displayPercent)) {
          displayPercent = Math.round(w.usedPercent);
        }
      }
    }
  }

  const handleRefresh = async (providerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshingProvider(providerId);
    try {
      await refreshProvider(providerId);
    } finally {
      setRefreshingProvider(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-5.5 items-center gap-1.5 rounded-md px-1.5 text-[10.5px] font-medium transition-colors cursor-pointer select-none",
            isDanger
              ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
              : isWarning
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                : "text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none",
            open && "bg-accent text-foreground",
          )}
          title={t("statusbar.quota.widgetTitle", {
            defaultValue: "AI Quotas & Token Usage",
          })}
          aria-label={t("statusbar.quota.widgetLabel", { defaultValue: "AI Quotas" })}
        >
          {loading && !overview ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={12}
              strokeWidth={2}
              className="animate-spin text-sky-400"
            />
          ) : isDanger ? (
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={12}
              strokeWidth={2}
              className="text-rose-500"
            />
          ) : (
            <HugeiconsIcon
              icon={Activity01Icon}
              size={12}
              strokeWidth={1.75}
              className={cn(
                isWarning ? "text-amber-400" : "text-emerald-500",
              )}
            />
          )}
          <span
            className={cn(
              "size-1.5 rounded-full",
              isDanger
                ? "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]"
                : isWarning
                  ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]"
                  : "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]",
            )}
          />
          <span className="font-mono text-[10px]">
            {displayPercent !== null
              ? `${displayPercent}%`
              : t("statusbar.quota.costUsd", {
                  cost: totalCost.toFixed(2),
                  defaultValue: `$${totalCost.toFixed(2)}`,
                })}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={6}
        className="w-84 max-w-[92vw] max-h-[80vh] flex flex-col p-3 overflow-hidden rounded-xl border border-border/70 bg-popover/95 shadow-2xl backdrop-blur-xl text-xs"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-2">
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={Activity01Icon} size={14} className="text-primary" />
            <span className="font-semibold text-foreground">
              {t("statusbar.quota.header", {
                defaultValue: "AI Quotas & Consumption",
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-mono text-muted-foreground">
              {t("statusbar.quota.today", {
                cost: `$${totalCost.toFixed(3)}`,
                defaultValue: `Today: $${totalCost.toFixed(3)}`,
              })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              onClick={() => void fetchOverview()}
              disabled={loading}
              title={t("common.refresh", { defaultValue: "Refresh all" })}
            >
              <HugeiconsIcon
                icon={Refresh01Icon}
                size={11}
                className={cn(loading && "animate-spin")}
              />
            </Button>
          </div>
        </div>

        {/* Provider List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5 [-ms-overflow-style:none] [scrollbar-width:thin]">
          {overview?.providers.map((p) => {
            const pIsDanger =
              p.state.kind === "reached" ||
              p.state.kind === "rate_limited" ||
              p.state.kind === "unauthenticated";
            const pIsWarning = p.state.kind === "approaching";
            const isRefreshing = refreshingProvider === p.providerId;

            return (
              <div
                key={p.providerId}
                className="rounded-lg border border-border/40 bg-card/40 p-2.5 space-y-2 transition-colors hover:border-border/70"
              >
                {/* Provider Title & Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        pIsDanger
                          ? "bg-rose-500"
                          : pIsWarning
                            ? "bg-amber-400"
                            : p.state.kind === "unavailable"
                              ? "bg-muted-foreground/40"
                              : "bg-emerald-500",
                      )}
                    />
                    <span className="font-medium text-[11px] text-foreground truncate">
                      {p.providerName}
                    </span>
                    {p.planName && (
                      <span className="shrink-0 rounded bg-accent/60 px-1 py-0.2 text-[9px] text-muted-foreground">
                        {p.planName}
                      </span>
                    )}
                    {p.accountEmail && (
                      <span
                        className="shrink-0 rounded bg-muted/40 px-1 py-0.2 text-[9px] text-muted-foreground/80 max-w-[130px] truncate font-mono"
                        title={p.accountEmail}
                      >
                        {p.accountEmail}
                      </span>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-4.5 rounded text-muted-foreground hover:text-foreground"
                    onClick={(e) => handleRefresh(p.providerId, e)}
                    disabled={isRefreshing}
                    title={t("common.refresh", { defaultValue: "Refresh" })}
                  >
                    <HugeiconsIcon
                      icon={Refresh01Icon}
                      size={10}
                      className={cn(isRefreshing && "animate-spin")}
                    />
                  </Button>
                </div>

                {/* State Message if not healthy */}
                {p.state.kind === "unauthenticated" && (
                  <div className="text-[10px] text-amber-500 bg-amber-500/10 rounded px-1.5 py-0.5">
                    {p.state.message}
                  </div>
                )}
                {p.state.kind === "rate_limited" && (
                  <div className="text-[10px] text-rose-500 bg-rose-500/10 rounded px-1.5 py-0.5">
                    {p.state.message}
                  </div>
                )}
                {p.state.kind === "unavailable" && (
                  <div className="text-[10px] text-muted-foreground bg-muted/20 rounded px-1.5 py-0.5">
                    {p.state.message}
                  </div>
                )}

                {/* Quota Windows Progress Bars */}
                {p.windows.length > 0 && (
                  <div className="space-y-1.5 pt-0.5">
                    {p.windows.map((w) => {
                      const used = Math.round(w.usedPercent);
                      const barColor =
                        used >= 100
                          ? "bg-rose-500"
                          : used >= 80
                            ? "bg-amber-500"
                            : "bg-emerald-500";

                      const barWidth =
                        w.rawLimit && w.rawUsed !== undefined && w.rawUsed !== null
                          ? Math.min(100, Math.max(w.rawUsed > 0 ? 1 : 0, (w.rawUsed / w.rawLimit) * 100))
                          : Math.min(100, Math.max(used > 0 ? 1 : 0, used));

                      return (
                        <div key={w.id} className="space-y-0.5">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-muted-foreground truncate">{w.label}</span>
                            <span className="font-mono text-foreground font-medium">
                              {w.rawUsed !== undefined && w.rawUsed !== null
                                ? `${w.rawUsed.toLocaleString()} ${w.unit ?? ""}`
                                : `${used}%`}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                            <div
                              className={cn("h-full transition-all duration-300 rounded-full", barColor)}
                              style={{
                                width: `${barWidth}%`,
                              }}
                            />
                          </div>
                          {formatResetDisplay(w.resetsAt, w.resetsInSeconds) && (
                            <div className="text-[9px] text-muted-foreground/80 text-right">
                              {formatResetDisplay(w.resetsAt, w.resetsInSeconds)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tokens and Cost Footer for Provider */}
                {((p.totalInputTokens !== undefined && p.totalInputTokens !== null) ||
                  (p.totalOutputTokens !== undefined && p.totalOutputTokens !== null) ||
                  (p.costTodayUsd !== undefined && p.costTodayUsd !== null)) && (
                  <div className="flex items-center justify-between text-[9.5px] text-muted-foreground border-t border-border/20 pt-1 font-mono">
                    <span>
                      {t("statusbar.quota.tokensSummary", {
                        inTokens: (p.totalInputTokens ?? 0).toLocaleString(),
                        outTokens: (p.totalOutputTokens ?? 0).toLocaleString(),
                        defaultValue: `In: ${(p.totalInputTokens ?? 0).toLocaleString()} · Out: ${(p.totalOutputTokens ?? 0).toLocaleString()}`,
                      })}
                    </span>
                    {p.costTodayUsd !== undefined && p.costTodayUsd !== null && (
                      <span className="text-foreground/90 font-medium">
                        ${p.costTodayUsd.toFixed(4)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
