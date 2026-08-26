import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  Refresh01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  isOpen: boolean;
  initialPrompt?: string;
  onClose: () => void;
  onSubmit: (instruction: string) => Promise<string>;
  onAccept: (newCode: string) => void;
};

const QUICK_ACTIONS = [
  { labelKey: "refactor", promptKey: "refactorPrompt" },
  { labelKey: "optimize", promptKey: "optimizePrompt" },
  { labelKey: "typeScript", promptKey: "typeScriptPrompt" },
  { labelKey: "edgeCases", promptKey: "edgeCasesPrompt" },
  { labelKey: "document", promptKey: "documentPrompt" },
] as const;

export function InlineAiWidget({
  isOpen,
  initialPrompt,
  onClose,
  onSubmit,
  onAccept,
}: Props) {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (customPrompt?: string) => {
    const text = (customPrompt ?? instruction).trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    try {
      const result = await onSubmit(text);
      setProposal(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("editor.inlineAi.generationFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialPrompt && initialPrompt.trim()) {
        setInstruction(initialPrompt);
        setProposal(null);
        setError(null);
        void handleSubmit(initialPrompt);
      } else {
        setInstruction("");
        setProposal(null);
        setError(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  }, [isOpen, initialPrompt]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (proposal !== null) {
        onAccept(proposal);
      } else {
        void handleSubmit();
      }
    } else if (e.key === "Enter" && !e.shiftKey && proposal === null) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleAddMention = () => {
    const next = instruction.endsWith(" ") || instruction.length === 0
      ? `${instruction}@`
      : `${instruction} @`;
    setInstruction(next);
    inputRef.current?.focus();
  };

  return (
    <div
      data-inline-ai-widget
      className="absolute top-12 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-xl rounded-2xl border border-border/80 bg-popover/95 p-3.5 text-popover-foreground shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="flex size-6 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
          <HugeiconsIcon icon={SparklesIcon} size={14} />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">
          {proposal !== null
            ? t("editor.inlineAi.reviewTitle")
            : t("editor.inlineAi.editTitle")}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          className="rounded-lg text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} />
        </Button>
      </div>

      {proposal === null ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/80 px-2.5 py-1 focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/20">
            <Input
              ref={inputRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t("editor.inlineAi.placeholder")}
              className="h-8 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
              disabled={loading}
            />
            <Button
              size="xs"
              className="h-6 gap-1 rounded-lg px-2 text-[11px] font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
              disabled={!instruction.trim() || loading}
              onClick={() => void handleSubmit()}
            >
              {loading ? <Spinner /> : <HugeiconsIcon icon={ArrowRight01Icon} size={12} />}
              <span>{t("common.generate")}</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={handleAddMention}
              className="rounded-lg border border-border/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 px-2 py-0.5 text-[10.5px] font-medium transition-colors"
              title={t("editor.inlineAi.mentionFile")}
            >
              {t("editor.inlineAi.file")}
            </button>

            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.labelKey}
                type="button"
                onClick={() => {
                  const prompt = t(`editor.inlineAi.actions.${action.promptKey}`);
                  setInstruction(prompt);
                  void handleSubmit(prompt);
                }}
                disabled={loading}
                className="rounded-lg border border-border/50 bg-accent/40 px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {t(`editor.inlineAi.actions.${action.labelKey}`)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="max-h-48 overflow-y-auto rounded-xl border border-border/60 bg-background/80 p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground select-text">
            <pre className="whitespace-pre-wrap">{proposal}</pre>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              size="xs"
              variant="ghost"
              className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground rounded-lg"
              onClick={() => setProposal(null)}
            >
              <HugeiconsIcon icon={Refresh01Icon} size={12} />
              <span>{t("editor.inlineAi.modifyInstruction")}</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="ghost"
                className="h-7 text-[11px] rounded-lg"
                onClick={onClose}
              >
                {t("editor.inlineAi.discard")}
              </Button>
              <Button
                size="xs"
                className="h-7 gap-1 rounded-lg px-3 text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"
                onClick={() => onAccept(proposal)}
              >
                <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} />
                <span>{t("editor.inlineAi.apply")}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
