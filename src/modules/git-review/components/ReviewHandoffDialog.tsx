import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "@/modules/i18n";
import {
  BotIcon,
  CheckmarkCircle02Icon,
  Comment01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useGitReviewStore } from "../store/gitReviewStore";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string;
  target?: string;
  totalChangedFiles?: number;
};

export function ReviewHandoffDialog({
  open,
  onOpenChange,
  repoRoot,
  target = "worktree",
  totalChangedFiles = 0,
}: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const key = useMemo(
    () => `${repoRoot.replace(/[\\/]+$/, "")}#${target}`,
    [repoRoot, target],
  );

  const comments = useGitReviewStore((s) => s.comments[key] ?? []);
  const overview = useGitReviewStore((s) => s.overviews[key]);
  const buildHandoffPrompt = useGitReviewStore((s) => s.buildHandoffPrompt);

  const reviewedCount = overview?.files.filter((f) => f.reviewed).length ?? 0;
  const prompt = useMemo(
    () => buildHandoffPrompt(repoRoot, target),
    [buildHandoffPrompt, repoRoot, target, comments, reviewedCount],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success(t("git.reviewHandoffCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleSendToAgent = () => {
    window.dispatchEvent(
      new CustomEvent("voktty:agent:insert-prompt", {
        detail: { prompt },
      }),
    );
    toast.success(t("git.reviewSentToAgent"));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={BotIcon}
              size={18}
              strokeWidth={1.9}
              className="text-primary"
            />
            <DialogTitle className="text-base font-semibold">
              {t("git.reviewHandoffTitle")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("git.reviewHandoffDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pt-2 pb-1 text-xs">
          <Badge variant="outline" className="gap-1 font-mono text-[10.5px]">
            <span className="text-muted-foreground">{t("git.scope")}:</span>
            <span>{target}</span>
          </Badge>
          <Badge variant="secondary" className="gap-1 text-[10.5px]">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} className="text-emerald-500" />
            <span>
              {reviewedCount}/{totalChangedFiles || overview?.files.length || 0} {t("git.reviewedFiles")}
            </span>
          </Badge>
          <Badge variant="secondary" className="gap-1 text-[10.5px]">
            <HugeiconsIcon icon={Comment01Icon} size={12} className="text-amber-500" />
            <span>
              {comments.length} {t("git.commentsCount")}
            </span>
          </Badge>
        </div>

        <div className="min-h-0 flex-1 rounded-md border border-border/60 bg-muted/20 my-2">
          <ScrollArea className="h-64 sm:h-80 w-full p-3 font-mono text-[11.5px] leading-relaxed">
            <pre className="whitespace-pre-wrap font-mono text-muted-foreground">
              {prompt}
            </pre>
          </ScrollArea>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
          <div className="text-[11px] text-muted-foreground hidden sm:block">
            {t("git.handoffHotkeyHint")}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => void handleCopy()}
            >
              <HugeiconsIcon
                icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                size={14}
                className={copied ? "text-emerald-500" : ""}
              />
              <span>{copied ? t("common.copied") : t("common.copy")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSendToAgent}
            >
              <HugeiconsIcon icon={BotIcon} size={14} />
              <span>{t("git.sendToAgent")}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
