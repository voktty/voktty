import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  FileCodeIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import { exportWalkthroughToMarkdown } from "../lib/walkthroughExport";
import { generateSyntheticWalkthrough } from "../lib/walkthroughGenerator";
import type { WalkthroughDocument } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string;
  changedFiles: readonly string[];
  onNavigateReference?: (path: string, line: number) => void;
};

export function GitWalkthroughDialog({
  open,
  onOpenChange,
  repoRoot,
  changedFiles,
  onNavigateReference,
}: Props) {
  const { t } = useTranslation();
  const [isGenerating, setIsGenerating] = useState(false);
  const [doc, setDoc] = useState<WalkthroughDocument | null>(null);

  const handleGenerate = async () => {
    if (changedFiles.length === 0) {
      toast.info(t("git.noChangesToExplain"));
      return;
    }
    setIsGenerating(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const generated = generateSyntheticWalkthrough(changedFiles);
      setDoc(generated);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!doc) return;
    const md = exportWalkthroughToMarkdown(doc);
    navigator.clipboard.writeText(md);
    toast.success(t("git.markdownCopied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2 border-b border-border/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <HugeiconsIcon icon={SparklesIcon} size={15} />
              </div>
              <DialogTitle className="text-sm font-semibold">
                {doc?.title ?? t("git.walkthrough")}
              </DialogTitle>
            </div>
            {doc ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={handleCopyMarkdown}
              >
                <HugeiconsIcon icon={Copy01Icon} size={12} />
                <span>{t("git.copyMarkdown")}</span>
              </Button>
            ) : null}
          </div>
          <DialogDescription className="text-xs text-muted-foreground truncate">
            {repoRoot}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 p-5 min-h-0">
          {!doc ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <HugeiconsIcon icon={SparklesIcon} size={22} />
              </div>
              <div className="max-w-xs space-y-1">
                <h4 className="text-xs font-semibold">
                  {t("git.generateWalkthrough")}
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  {changedFiles.length} {t("git.changedFiles").toLowerCase()}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={isGenerating || changedFiles.length === 0}
                onClick={() => void handleGenerate()}
                className="gap-2 text-xs"
              >
                {isGenerating ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon icon={SparklesIcon} size={14} />
                )}
                <span>
                  {isGenerating
                    ? t("git.generatingWalkthrough")
                    : t("git.generateWalkthrough")}
                </span>
              </Button>
            </div>
          ) : (
            <div className="space-y-4 text-left">
              {/* Coverage header */}
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs">
                <span className="font-medium text-muted-foreground">
                  {t("git.coverage")}
                </span>
                <Badge variant={doc.coverageRatio >= 0.8 ? "secondary" : "outline"} className="text-[10.5px]">
                  {Math.round(doc.coverageRatio * 100)}%
                </Badge>
              </div>

              {/* Summary */}
              <div className="text-xs leading-relaxed text-muted-foreground bg-muted/10 p-3 rounded-lg border border-border/40">
                {doc.summary}
              </div>

              {/* Sections by Intent */}
              <div className="space-y-3">
                {doc.sections.map((section) => (
                  <div
                    key={section.id}
                    className="rounded-lg border border-border/60 p-3 space-y-2 bg-card/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-foreground">
                          {section.title}
                        </h4>
                        <span className="text-[10px] text-muted-foreground italic">
                          {section.intent}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                      {section.description}
                    </p>

                    {/* Key References */}
                    {section.references.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {section.references.map((ref, idx) => (
                          <button
                            key={`${ref.path}_${idx}`}
                            type="button"
                            onClick={() =>
                              onNavigateReference?.(ref.path, ref.startLine)
                            }
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] transition-colors",
                              ref.status === "valid"
                                ? "border-border/60 bg-muted/40 text-foreground hover:bg-primary/10 hover:border-primary/40"
                                : "border-destructive/40 bg-destructive/10 text-destructive",
                            )}
                            title={ref.invalidReason ?? `${ref.path}:${ref.startLine}-${ref.endLine}`}
                          >
                            <HugeiconsIcon
                              icon={
                                ref.status === "valid"
                                  ? FileCodeIcon
                                  : Alert02Icon
                              }
                              size={11}
                            />
                            <span className="font-mono text-[10px]">
                              {`${ref.path.split("/").pop()}:${ref.startLine}-${ref.endLine}`}
                            </span>
                            {ref.status === "valid" ? (
                              <HugeiconsIcon
                                icon={CheckmarkCircle02Icon}
                                size={10}
                                className="text-emerald-500"
                              />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {/* Risks */}
                    {section.risks && section.risks.length > 0 ? (
                      <div className="pt-1 space-y-1">
                        {section.risks.map((risk, rIdx) => (
                          <div
                            key={rIdx}
                            className="flex items-center gap-1.5 text-[10.5px] text-amber-600 dark:text-amber-400"
                          >
                            <HugeiconsIcon icon={Alert02Icon} size={11} />
                            <span>{risk}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Unmentioned files */}
              {doc.unmentionedFiles.length > 0 ? (
                <div className="rounded-lg border border-border/40 bg-muted/10 p-2.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t("git.unmentionedFilesCount", {
                      count: doc.unmentionedFiles.length,
                    })}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {doc.unmentionedFiles.map((f) => (
                      <Badge
                        key={f}
                        variant="outline"
                        className="font-mono text-[9.5px]"
                      >
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
