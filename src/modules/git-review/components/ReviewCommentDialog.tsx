import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/modules/i18n";
import { Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useGitReviewStore } from "../store/gitReviewStore";
import type { ReviewComment } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string;
  target?: string;
  path: string;
  line: number;
  endLine?: number;
  side?: "old" | "new";
  content?: string;
  existingComment?: ReviewComment | null;
  onSaved?: () => void;
};

export function ReviewCommentDialog({
  open,
  onOpenChange,
  repoRoot,
  target = "worktree",
  path,
  line,
  endLine,
  side = "new",
  content = "",
  existingComment,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [commentText, setCommentText] = useState(existingComment?.comment ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addComment = useGitReviewStore((s) => s.addComment);
  const updateComment = useGitReviewStore((s) => s.updateComment);

  useEffect(() => {
    if (open) {
      setCommentText(existingComment?.comment ?? "");
    }
  }, [open, existingComment]);

  const handleSave = async () => {
    const trimmed = commentText.trim();
    if (!trimmed) {
      toast.error(t("git.commentCannotBeEmpty"));
      return;
    }

    setIsSubmitting(true);
    try {
      if (existingComment) {
        const ok = await updateComment(
          repoRoot,
          target,
          existingComment.id,
          trimmed,
        );
        if (ok) {
          toast.success(t("git.commentUpdated"));
          onSaved?.();
          onOpenChange(false);
        } else {
          toast.error(t("common.error"));
        }
      } else {
        const res = await addComment({
          repoRoot,
          target,
          path,
          side,
          line,
          endLine,
          content,
          comment: trimmed,
        });
        if (res) {
          toast.success(t("git.commentAdded"));
          onSaved?.();
          onOpenChange(false);
        } else {
          toast.error(t("common.error"));
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const lineRangeText = endLine && endLine > line ? `${line}-${endLine}` : `${line}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-5">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Comment01Icon}
              size={18}
              strokeWidth={1.9}
              className="text-amber-500"
            />
            <DialogTitle className="text-sm font-semibold">
              {existingComment
                ? t("git.editReviewComment")
                : t("git.addReviewComment")}
            </DialogTitle>
          </div>
          <DialogDescription className="font-mono text-[11px] text-muted-foreground truncate">
            {path}:{lineRangeText} ({side === "new" ? t("git.addedModified") : t("git.original")})
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={t("git.commentPlaceholder")}
            rows={4}
            autoFocus
            className="text-xs resize-none font-sans"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
            }}
          />
          <div className="flex justify-end pt-1">
            <span className="text-[10px] text-muted-foreground">
              {t("git.pressCtrlEnterToSave")}
            </span>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="text-xs"
            onClick={() => void handleSave()}
            disabled={isSubmitting || !commentText.trim()}
          >
            {existingComment ? t("common.save") : t("git.addComment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
