import { DEFAULT_MODEL_ID } from "@/modules/ai/config";
import { Spinner } from "@/components/ui/spinner";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { useChatStore } from "@/modules/ai/store/chatStore";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  Cancel01Icon,
  CommandLineIcon,
  Copy01Icon,
  PlayIcon,
  Refresh01Icon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  generateTerminalCommand,
  type CopilotCommandResult,
} from "./generateTerminalCommand";

export type TerminalCopilotPopupProps = {
  leafId: number;
  active: boolean;
  cwd?: string | null;
  workspaceEnv?: WorkspaceEnv;
  initialPrompt?: string;
  onInsert: (command: string) => void;
  onExecute: (command: string) => void;
  onClose: () => void;
};

export function TerminalCopilotPopup({
  leafId: _leafId,
  active,
  cwd,
  workspaceEnv,
  initialPrompt = "",
  onInsert,
  onExecute,
  onClose,
}: TerminalCopilotPopupProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopilotCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isWin =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
  const isMac =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const isWsl = workspaceEnv?.kind === "wsl";
  const isSsh = workspaceEnv?.kind === "ssh";

  const shellName = isSsh || isWsl || !isWin ? "bash" : "powershell";

  const osName = isSsh
    ? `Remote (${workspaceEnv?.connection?.host || "SSH"})`
    : isWsl
      ? `WSL (${workspaceEnv?.distro || "Linux"})`
      : isMac
        ? "macOS"
        : isWin
          ? "Windows"
          : "Linux";

  const modelId =
    useChatStore((s) => s.selectedModelId) || DEFAULT_MODEL_ID;

  useEffect(() => {
    if (active) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [active]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleGenerate = async (query = prompt) => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await generateTerminalCommand({
        prompt: trimmed,
        shell: shellName,
        cwd,
        os: osName,
        abortSignal: ctrl.signal,
      });
      setResult(res);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const msg =
        err instanceof Error ? err.message : t("terminal.copilot.errorGenerating");
      setError(msg);
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleCopy = () => {
    if (!result?.command) return;
    navigator.clipboard
      .writeText(result.command)
      .then(() => {
        setCopied(true);
        toast.success(t("terminal.copilot.copied"));
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const handleInsert = () => {
    if (!result?.command) return;
    onInsert(result.command);
    onClose();
  };

  const handleExecute = () => {
    if (!result?.command) return;
    onExecute(result.command);
    onClose();
  };

  if (!active) return null;

  return (
    <div className="absolute inset-x-0 top-3 z-30 flex justify-center px-4 pointer-events-none">
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-xl flex-col rounded-xl border border-border/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-xl",
          "animate-in fade-in-0 zoom-in-95 duration-150 ease-out",
        )}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
              <HugeiconsIcon icon={SparklesIcon} size={12} strokeWidth={2} />
            </div>
            <span className="text-xs font-semibold text-foreground">
              {t("terminal.copilot.title")}
            </span>
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
              {shellName}
            </span>
            {cwd && (
              <span className="max-w-40 truncate rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground" title={cwd}>
                {cwd}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {modelId}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              title={t("terminal.copilot.cancel")}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Prompt Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (result && !loading) {
              handleInsert();
            } else {
              void handleGenerate();
            }
          }}
          className="relative flex items-center"
        >
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("terminal.copilot.placeholder")}
            className="h-8 w-full rounded-lg border border-border/80 bg-background/80 px-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 pr-16"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "Enter" && e.shiftKey && result) {
                e.preventDefault();
                handleExecute();
              }
            }}
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            {loading ? (
              <Spinner className="size-3.5 text-primary" />
            ) : (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!prompt.trim()}
                className="flex h-5 items-center gap-1 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={SparklesIcon} size={11} strokeWidth={2} />
                <span>↵</span>
              </button>
            )}
          </div>
        </form>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-2 pt-2.5 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            <span>{t("terminal.copilot.generating")}</span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Generated Result */}
        {result && !loading && (
          <div className="mt-2.5 flex flex-col gap-2 animate-in fade-in-50 duration-150">
            <div className="group relative flex items-center justify-between rounded-lg border border-border/80 bg-muted/60 px-3 py-2 font-mono text-[12px] shadow-inner">
              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto">
                <HugeiconsIcon
                  icon={CommandLineIcon}
                  size={14}
                  className="shrink-0 text-primary"
                />
                <code className="select-all font-mono font-semibold text-foreground whitespace-pre">
                  {result.command}
                </code>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-2 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                title={t("terminal.copilot.copied")}
              >
                <HugeiconsIcon
                  icon={copied ? Tick02Icon : Copy01Icon}
                  size={13}
                  className={copied ? "text-emerald-500" : ""}
                />
              </button>
            </div>

            {result.explanation && (
              <p className="px-1 text-[11.5px] leading-relaxed text-muted-foreground">
                {result.explanation}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Refresh01Icon} size={11} />
                <span>{t("terminal.copilot.regenerate")}</span>
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleInsert}
                  className="flex h-6 items-center gap-1 rounded-md border border-border/80 bg-background/80 px-2 text-[11px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
                >
                  <span>{t("terminal.copilot.insert")}</span>
                  <KbdGroup>
                    <Kbd className="h-3.5 px-1 text-[9px]">↵</Kbd>
                  </KbdGroup>
                </button>

                <button
                  type="button"
                  onClick={handleExecute}
                  className="flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={PlayIcon} size={10} strokeWidth={2.5} />
                  <span>{t("terminal.copilot.execute")}</span>
                  <KbdGroup>
                    <Kbd className="h-3.5 border-primary-foreground/30 bg-primary-foreground/15 px-1 text-[9px] text-primary-foreground">
                      ⇧↵
                    </Kbd>
                  </KbdGroup>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
