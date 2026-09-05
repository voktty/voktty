import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import { cn } from "@/lib/utils";
import { Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cancelTransfer, isTerminal, type ConflictPolicy } from "../transfer";
import {
  formatDuration,
  formatSize,
  formatSpeed,
  percentDone,
} from "../transferFormat";
import { useTransferQueue, type QueueEntry } from "../transferStore";

const DECISIONS: Exclude<ConflictPolicy, "ask">[] = [
  "overwrite",
  "skip",
  "rename",
  "resume",
];

/**
 * The transfer queue, shown only while there is something to show.
 *
 * Mounted once at the app root. It renders nothing when the queue is empty, so
 * it costs a single empty render for anyone who never transfers a file.
 */
export function TransferQueuePanel({
  onDecide,
}: {
  onDecide?: (jobId: string, policy: Exclude<ConflictPolicy, "ask">) => void;
}) {
  const { t } = useTranslation();
  const jobs = useTransferQueue((state) => state.jobs);
  const clearFinished = useTransferQueue((state) => state.clearFinished);

  if (jobs.length === 0) return null;

  const settled = jobs.filter((entry) => isTerminal(entry.summary.state)).length;

  return (
    <section
      aria-label={t("transfers.title")}
      className="voktty-pane pointer-events-auto fixed bottom-10 right-3 z-40 flex w-80 flex-col gap-1.5 rounded-md border border-border/60 p-2 text-[12px] shadow-lg"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="font-medium">{t("transfers.title")}</span>
        {settled > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] cursor-pointer"
            onClick={clearFinished}
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
            {t("transfers.clearFinished")}
          </Button>
        )}
      </header>

      <ul className="flex flex-col gap-1.5">
        {jobs.map((entry) => (
          <TransferRow key={entry.summary.id} entry={entry} onDecide={onDecide} />
        ))}
      </ul>
    </section>
  );
}

function TransferRow({
  entry,
  onDecide,
}: {
  entry: QueueEntry;
  onDecide?: (jobId: string, policy: Exclude<ConflictPolicy, "ask">) => void;
}) {
  const { t } = useTranslation();
  const { summary, progress, conflict, skipped } = entry;
  const percent = progress
    ? percentDone(progress.bytesDone, progress.bytesTotal)
    : 0;
  const speed = formatSpeed(progress?.bytesPerSecond);
  const remaining = formatDuration(progress?.secondsRemaining);
  const done = isTerminal(summary.state);

  return (
    <li className="flex flex-col gap-1 rounded-sm bg-foreground/[0.03] p-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate" title={summary.destinationRoot}>
          {t(
            summary.direction === "upload"
              ? "transfers.uploadingTo"
              : "transfers.downloadingTo",
            { target: summary.destinationRoot },
          )}
        </span>
        {!done && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("transfers.cancel")}
            className="h-5 w-5 shrink-0 p-0 cursor-pointer"
            onClick={() => void cancelTransfer(summary.id).catch(() => undefined)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </Button>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("transfers.progressLabel")}
        className="h-1 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            summary.state === "failed" ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{stateText(entry, t)}</span>
        <span className="shrink-0 tabular-nums">
          {[speed, remaining].filter(Boolean).join(" · ")}
        </span>
      </div>

      {conflict && (
        <div className="flex flex-col gap-1 rounded-sm border border-border/60 p-1.5">
          <span className="truncate" title={conflict.destination}>
            {t("transfers.conflict", { path: conflict.destination })}
          </span>
          <div className="flex flex-wrap gap-1">
            {DECISIONS.map((policy) => (
              <Button
                key={policy}
                variant="secondary"
                size="sm"
                className="h-6 px-2 text-[11px] cursor-pointer"
                onClick={() => onDecide?.(summary.id, policy)}
              >
                {t(`transfers.policy.${policy}`)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {summary.error && (
        <span className="text-[11px] text-destructive">{summary.error}</span>
      )}
      {summary.state === "completed" && skipped ? (
        <span className="text-[11px] text-muted-foreground">
          {t("transfers.skipped", { count: skipped })}
        </span>
      ) : null}
    </li>
  );
}

function stateText(entry: QueueEntry, t: (key: string, vars?: never) => string): string {
  const { summary, progress } = entry;
  if (summary.state === "awaitingDecision") return t("transfers.state.awaiting");
  if (summary.state === "cancelled") return t("transfers.state.cancelled");
  if (summary.state === "failed") return t("transfers.state.failed");
  if (summary.state === "completed") return t("transfers.state.completed");
  if (!progress) return t("transfers.state.preparing");
  return `${formatSize(progress.bytesDone)} / ${formatSize(progress.bytesTotal)}`;
}
