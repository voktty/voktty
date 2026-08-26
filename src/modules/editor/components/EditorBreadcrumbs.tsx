import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  isWebPreviewablePath,
  LivePreviewButton,
} from "@/modules/preview/components/LivePreviewButton";
import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CancelCircleIcon,
  CodeIcon,
  Folder01Icon,
  MagicWand01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CurrentSymbol } from "../lib/breadcrumbs/symbolResolver";
import { useCompletionStatusStore } from "../lib/autocomplete/statusStore";

type Props = {
  editorId: number;
  path: string;
  symbol: CurrentSymbol | null;
  language: string;
  indentUnit: string;
  eol: "lf" | "crlf";
  errorCount: number;
  warningCount: number;
  onTriggerInlineAi: () => void;
  onTriggerAiCompletion: () => void;
  onOpenPreview?: (url: string) => void;
  onJumpToError?: () => void;
  onQuickFix?: () => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
};

export function EditorBreadcrumbs({
  editorId,
  path,
  symbol,
  language,
  indentUnit,
  eol,
  errorCount,
  warningCount,
  onTriggerInlineAi,
  onTriggerAiCompletion,
  onOpenPreview,
  onJumpToError,
  onQuickFix,
  canNavigateBack = false,
  canNavigateForward = false,
  onNavigateBack,
  onNavigateForward,
}: Props) {
  const { t } = useTranslation();
  const aiAvailable = useAiAvailable();
  const autocompleteEnabled = usePreferencesStore((s) => s.autocompleteEnabled);
  const completionStatus = useCompletionStatusStore(
    (s) => s.byEditorId[editorId]?.phase ?? "idle",
  );
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const filename = parts.pop() ?? t("common.untitled");

  return (
    <div className="flex h-7.5 w-full items-center justify-between border-b border-border/40 bg-card/60 px-2.5 text-[11px] text-muted-foreground select-none backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
        <div className="mr-0.5 flex shrink-0 items-center gap-0.5 border-r border-border/40 pr-1.5">
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={!canNavigateBack}
            onClick={onNavigateBack}
            title={t("editor.navigateBack")}
            aria-label={t("editor.navigateBack")}
            className="rounded-md"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={!canNavigateForward}
            onClick={onNavigateForward}
            title={t("editor.navigateForward")}
            aria-label={t("editor.navigateForward")}
            className="rounded-md"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
          </Button>
        </div>
        <HugeiconsIcon
          icon={Folder01Icon}
          size={13}
          className="shrink-0 text-muted-foreground/70"
        />
        {parts.slice(-2).map((part, idx) => (
          <span key={idx} className="flex items-center gap-1.5 shrink-0">
            <span className="truncate text-muted-foreground/80 hover:text-foreground transition-colors max-w-[120px]">
              {part}
            </span>
            <span className="text-muted-foreground/40">/</span>
          </span>
        ))}
        <span className="font-medium text-foreground truncate max-w-[160px] shrink-0">
          {filename}
        </span>

        {symbol ? (
          <span className="flex items-center gap-1.5 shrink-0 ml-1">
            <span className="text-muted-foreground/40">&gt;</span>
            <span className="flex items-center gap-1 rounded-md bg-accent/60 px-1.5 py-0.5 text-[11px] font-mono font-medium text-accent-foreground">
              <HugeiconsIcon
                icon={CodeIcon}
                size={11}
                className="text-sky-400"
              />
              <span className="truncate max-w-[180px]">{symbol.name}</span>
            </span>
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-2">
        {errorCount > 0 || warningCount > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={onQuickFix ?? onJumpToError}
            className="h-6 gap-1 px-1.5 text-[11px] rounded-lg text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 transition-colors"
            title={t("editor.diagnosticsTitle", {
              errors: errorCount,
              warnings: warningCount,
            })}
          >
            {errorCount > 0 ? (
              <span className="flex items-center gap-0.5">
                <HugeiconsIcon
                  icon={CancelCircleIcon}
                  size={12}
                  className="text-rose-500"
                />
                <span className="font-mono">{errorCount}</span>
              </span>
            ) : null}
            {warningCount > 0 ? (
              <span className="flex items-center gap-0.5">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  size={12}
                  className="text-amber-400"
                />
                <span className="font-mono">{warningCount}</span>
              </span>
            ) : null}
            <span className="hidden lg:inline text-[10px] text-amber-400/90 font-medium ml-0.5">
              {t("editor.quickFixAction")}
            </span>
          </Button>
        ) : null}

        <div className="hidden sm:flex items-center gap-1.5 text-[10.5px] font-mono text-muted-foreground/70 border-l border-border/40 pl-2">
          <span className="uppercase">{language}</span>
          <span>·</span>
          <span>
            {indentUnit.startsWith("\t")
              ? t("common.indentTabs")
              : t("common.indentSpaces", { count: indentUnit.length })}
          </span>
          <span>·</span>
          <span className="uppercase">{eol}</span>
        </div>

        <div className="flex items-center gap-1 border-l border-border/40 pl-1.5">
          {onOpenPreview && isWebPreviewablePath(path) ? (
            <LivePreviewButton path={path} onOpenPreview={onOpenPreview} />
          ) : null}
          {aiAvailable && autocompleteEnabled ? (
            <Button
              size="icon-xs"
              variant="ghost"
              title={t(`editor.aiCompletionStatus.${completionStatus}`)}
              aria-label={t(`editor.aiCompletionStatus.${completionStatus}`)}
              onClick={onTriggerAiCompletion}
              className={cn(
                "relative rounded-lg text-violet-400 hover:bg-violet-500/10 hover:text-violet-300",
                completionStatus === "requesting" && "animate-pulse",
                completionStatus === "error" && "text-destructive",
                completionStatus === "paused" && "text-amber-400",
              )}
            >
              <HugeiconsIcon icon={MagicWand01Icon} size={12} />
              {completionStatus === "ready" ? (
                <span className="absolute right-0.5 top-0.5 size-1 rounded-full bg-emerald-400" />
              ) : null}
            </Button>
          ) : null}
          {aiAvailable ? (
            <Button
              size="xs"
              variant="ghost"
              title={t("editor.editWithAiTitle")}
              onClick={onTriggerInlineAi}
              className="gap-1 rounded-lg px-2 text-[11px] font-medium text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
            >
              <HugeiconsIcon icon={SparklesIcon} size={12} />
              <span className="hidden md:inline">Ctrl+K</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
