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
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { requestAddToChat } from "@/modules/harness/lib/quoteDraft";
import { copyText } from "@/modules/harness/lib/clipboard";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  getActiveTerminalLeafId,
  writeToSession,
} from "@/modules/terminal/lib/useTerminalSession";
import { toast } from "sonner";
import { EMPTY_COMMENTS, useGitReviewStore } from "../store/gitReviewStore";

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

  const comments = useGitReviewStore(
    (s) => s.comments[key] ?? (EMPTY_COMMENTS as unknown as typeof s.comments[string]),
  );
  const overview = useGitReviewStore((s) => s.overviews[key]);
  const buildHandoffPrompt = useGitReviewStore((s) => s.buildHandoffPrompt);

  const reviewedCount = overview?.files.filter((f) => f.reviewed).length ?? 0;
  const prompt = useMemo(
    () => buildHandoffPrompt(repoRoot, target),
    [buildHandoffPrompt, repoRoot, target, comments, reviewedCount],
  );

  const handleCopy = async () => {
    try {
      await copyText(prompt);
      setCopied(true);
      toast.success(t("git.reviewHandoffCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleSendToTerminal = () => {
    const leafId = getActiveTerminalLeafId();
    if (leafId != null) {
      const ok = writeToSession(leafId, prompt);
      if (ok) {
        toast.success(t("git.reviewSentToTerminal"));
        onOpenChange(false);
        return;
      }
    }
    void handleCopy();
    toast.info(t("git.noTerminalCopiedToClipboard"));
  };

  const handleSendToAgent = () => {
    // 1. Dispatch custom event for active AI components
    window.dispatchEvent(
      new CustomEvent("voktty:agent:insert-prompt", {
        detail: { prompt },
      }),
    );
    // 2. Dispatch Harness chat event
    requestAddToChat(prompt, "plain");

    // 3. Open integrated AI sidebar panel if closed
    try {
      const chat = useChatStore.getState();
      chat.openPanel();
      chat.focusInput();
    } catch {}

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

        <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
          <div className="text-[11px] text-muted-foreground hidden sm:block">
            {t("git.handoffHotkeyHint")}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
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
              variant="secondary"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleSendToTerminal}
              title={t("git.sendToTerminal")}
            >
              <HugeiconsIcon icon={TerminalIcon} size={14} />
              <span>{t("git.sendToTerminal")}</span>
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
