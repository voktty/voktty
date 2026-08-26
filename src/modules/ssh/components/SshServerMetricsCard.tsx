import { memo } from "react";
import { useTranslation } from "@/modules/i18n";
import { HugeiconsIcon } from "@hugeicons/react";
import { Refresh01Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import type { SshServerMetrics } from "../types";

type Props = {
  serverName: string;
  metrics: SshServerMetrics | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  compact?: boolean;
};

function formatBytes(bytes: number, precision = 1): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return "0B";
  const units = ["B", "K", "M", "G", "T", "P"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = (bytes / Math.pow(1024, i)).toFixed(precision);
  const cleanVal = val.endsWith(".0") ? val.slice(0, -2) : val;
  return `${cleanVal}${units[i]}`;
}

type GaugeProps = {
  percentage: number;
  label: string;
  topValue: string;
  bottomValue?: string;
  colorVariant?: "auto" | "green" | "cyan" | "yellow";
};

function CircularGauge({
  percentage,
  label,
  topValue,
  bottomValue,
  colorVariant = "auto",
}: GaugeProps) {
  const clampPct = Math.min(Math.max(percentage, 0), 100);
  const size = 58;
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampPct / 100) * circumference;

  let strokeColor = "#10b981"; // emerald
  if (colorVariant === "cyan") {
    strokeColor = "#06b6d4";
  } else if (colorVariant === "yellow") {
    strokeColor = "#f59e0b";
  } else if (colorVariant === "auto") {
    if (clampPct > 88) strokeColor = "#ef4444";
    else if (clampPct > 72) strokeColor = "#f59e0b";
    else strokeColor = "#10b981";
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg className="-rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            className="text-muted/30"
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
          <span className="text-[11px] font-semibold text-foreground tracking-tight">
            {topValue}
          </span>
          {bottomValue && (
            <span className="text-[9px] font-mono text-muted-foreground/80 leading-none">
              {bottomValue}
            </span>
          )}
        </div>
      </div>
      <span className="text-[9px] font-bold tracking-wider uppercase text-muted-foreground select-none">
        {label}
      </span>
    </div>
  );
}

export const SshServerMetricsCard = memo(function SshServerMetricsCard({
  serverName,
  metrics,
  loading = false,
  error = null,
  onRefresh,
  compact = false,
}: Props) {
  const { t } = useTranslation();
  if (error) {
    return (
      <div className="w-72 rounded-lg border border-destructive/30 bg-popover/95 p-3.5 shadow-xl backdrop-blur-md text-foreground select-none">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
          <span className="text-xs font-bold text-destructive flex items-center gap-1.5">
            <HugeiconsIcon icon={AlertCircleIcon} size={14} />
            {serverName}
          </span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("common.retry")}
            >
              <HugeiconsIcon icon={Refresh01Icon} size={12} className={loading ? "animate-spin" : ""} />
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
          {error}
        </p>
      </div>
    );
  }

  const memPct =
    metrics && metrics.memTotalBytes > 0
      ? (metrics.memUsedBytes / metrics.memTotalBytes) * 100
      : 0;

  const diskPct =
    metrics && metrics.diskTotalBytes > 0
      ? (metrics.diskUsedBytes / metrics.diskTotalBytes) * 100
      : 0;

  const cpuTop = metrics ? `${metrics.cpuPercent.toFixed(1)}%` : "--";
  const memTop = metrics ? formatBytes(metrics.memUsedBytes) : "--";
  const memBottom = metrics ? formatBytes(metrics.memTotalBytes) : "";
  const diskTop = metrics ? formatBytes(metrics.diskUsedBytes) : "--";
  const diskBottom = metrics ? formatBytes(metrics.diskTotalBytes) : "";
  const netTop = metrics ? `↑${formatBytes(metrics.netTxBytes, 0)}` : "↑0B";
  const netBottom = metrics ? `↓${formatBytes(metrics.netRxBytes, 0)}` : "↓0B";

  return (
    <div
      className={`rounded-xl border border-border/50 bg-popover/95 shadow-2xl backdrop-blur-lg text-foreground select-none transition-all ${
        compact ? "w-72 p-3" : "w-[330px] p-3.5"
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-sky-400 dark:text-sky-300">
              {serverName}
            </span>
            {metrics?.pingMs !== undefined && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {metrics.pingMs}ms
              </span>
            )}
          </div>
          <span className="truncate text-[10px] text-muted-foreground/90 font-medium">
            {metrics?.osName || t("ssh.metrics.remoteLinux")}
          </span>
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title={t("tooltips.refreshMetrics")}
          >
            <HugeiconsIcon icon={Refresh01Icon} size={13} className={loading ? "animate-spin text-primary" : ""} />
          </button>
        )}
      </div>

      {/* 4 Circular Gauges */}
      <div className="grid grid-cols-4 gap-1.5 py-3 border-b border-border/40">
        <CircularGauge
          label="CPU"
          percentage={metrics?.cpuPercent ?? 0}
          topValue={cpuTop}
        />
        <CircularGauge
          label="MEM"
          percentage={memPct}
          topValue={memTop}
          bottomValue={memBottom}
        />
        <CircularGauge
          label="DISK"
          percentage={diskPct}
          topValue={diskTop}
          bottomValue={diskBottom}
        />
        <CircularGauge
          label="NETWORK"
          percentage={metrics ? Math.min(100, (metrics.netRxBytes + metrics.netTxBytes) / (1024 * 1024)) : 0}
          topValue={netTop}
          bottomValue={netBottom}
          colorVariant="yellow"
        />
      </div>

      {/* Bottom Info Row */}
      <div className="flex items-center justify-between pt-2 text-[10px] font-mono text-muted-foreground">
        <span>
          TCP EST: <strong className="text-foreground font-semibold">{metrics?.tcpConnections ?? 0}</strong>
        </span>
        <span>
          {t("ssh.metrics.users")}: {" "}
          <strong className="text-foreground font-semibold">
            {metrics?.usersCount ?? 0}
          </strong>
        </span>
        {metrics?.loadAvg && metrics.loadAvg.length > 0 && (
          <span className="text-amber-500 dark:text-amber-400 font-semibold">
            {metrics.loadAvg.map((l) => l.toFixed(2)).join(" ")}
          </span>
        )}
      </div>
    </div>
  );
});
