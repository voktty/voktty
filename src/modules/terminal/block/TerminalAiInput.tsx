import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/modules/i18n";
import {
  Cancel01Icon,
  Copy01Icon,
  PlayIcon,
  Shield01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  generateTerminalCommand,
  type CopilotCommandResult,
} from "../copilot/generateTerminalCommand";
import { useTerminalCopilotStore } from "../copilot/terminalCopilotStore";

type Props = {
  leafId: number;
  focused: boolean;
  os?: string | null;
  shell?: string | null;
  getCwd?: () => string | null;
  onSubmit: (command: string) => void;
  onInterrupt?: () => void;
  onSwitchToShell?: () => void;
};

export default function TerminalAiInput({
  leafId,
  focused,
  os,
  shell,
  getCwd,
  onSubmit,
  onInterrupt,
  onSwitchToShell,
}: Props) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<CopilotCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isAutoApproved = useTerminalCopilotStore((s) =>
    s.autoApprovedLeafIds.includes(leafId),
  );
  const allowAlways = useTerminalCopilotStore((s) => s.allowAlwaysForLeaf);

  useEffect(() => {
    if (focused && !previewResult) {
      inputRef.current?.focus();
    }
  }, [focused, previewResult]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if (!text || loading) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setPreviewResult(null);

    const activeCwd = getCwd?.() ?? null;
    const activeShell = shell ?? "powershell";
    const activeOs = os ?? "Windows";

    try {
      const res = await generateTerminalCommand({
        prompt: text,
        shell: activeShell,
        os: activeOs,
        cwd: activeCwd,
        abortSignal: ctrl.signal,
      });

      if (ctrl.signal.aborted) return;

      if (!res?.command) {
        setError(t("terminal.aiInput.noCommand"));
        return;
      }

      // Check if this tab is auto-approved
      if (isAutoApproved) {
        setPrompt("");
        onSubmit(res.command);
        toast.success(t("terminal.aiInput.executing", { command: res.command }));
      } else {
        setPreviewResult(res);
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : t("terminal.aiInput.processingFailed"),
      );
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleAccept = () => {
    if (!previewResult?.command) return;
    const cmd = previewResult.command;
    setPreviewResult(null);
    setPrompt("");
    onSubmit(cmd);
  };

  const handleAllowAlways = () => {
    if (!previewResult?.command) return;
    const cmd = previewResult.command;
    allowAlways(leafId);
    setPreviewResult(null);
    setPrompt("");
    onSubmit(cmd);
    toast.success(t("terminal.aiInput.permissionGranted"));
  };

  const handleCancel = () => {
    setPreviewResult(null);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      if (loading) {
        abortRef.current?.abort();
        setLoading(false);
      }
      onInterrupt?.();
    }

    if (previewResult) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleAccept();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    } else {
      if (e.key === "Escape") {
        e.preventDefault();
        if (prompt.length > 0) {
          setPrompt("");
        } else {
          onSwitchToShell?.();
        }
      }
    }
  };

  const copyCommand = (cmd: string) => {
    void navigator.clipboard.writeText(cmd);
    toast.success(t("terminal.aiInput.copied"));
  };

  return (
    <div className="flex flex-col gap-2 w-full select-none" onKeyDown={handleKeyDown}>
      {previewResult ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs shadow-lg backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium text-amber-300">
              <HugeiconsIcon icon={SparklesIcon} size={14} className="text-amber-400" />
              <span>{t("terminal.aiInput.preview")}</span>
            </div>
            {previewResult.explanation && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[300px]">
                {previewResult.explanation}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1.5 font-mono text-[12px] text-foreground select-text">
            <code className="truncate flex-1">{previewResult.command}</code>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => copyCommand(previewResult.command)}
              title={t("terminal.aiInput.copy")}
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon icon={Copy01Icon} size={12} />
            </Button>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              size="xs"
              variant="outline"
              onClick={handleAllowAlways}
              className="h-7 gap-1 text-[11px] border-violet-500/40 text-violet-300 hover:bg-violet-500/15"
              title={t("terminal.aiInput.allowAlwaysTitle")}
            >
              <HugeiconsIcon icon={Shield01Icon} size={12} />
              <span>{t("terminal.aiInput.allowAlways")}</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={handleCancel}
                className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} className="mr-1" />
                <span>{t("terminal.aiInput.cancel")}</span>
              </Button>
              <Button
                size="xs"
                onClick={handleAccept}
                className="h-7 gap-1 px-3 text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
                <span>{t("terminal.aiInput.confirm")}</span>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleGenerate} className="flex items-center gap-2 w-full">
          <div className="flex size-6 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 shrink-0">
            <HugeiconsIcon icon={SparklesIcon} size={13} />
          </div>

          <div className="relative flex-1 flex items-center">
            <Input
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("terminal.aiInput.placeholder")}
              disabled={loading}
              className="h-8 border-border/50 bg-background/50 text-xs px-2.5 rounded-lg shadow-none focus-visible:ring-1 focus-visible:ring-amber-500/50"
            />
            {loading && (
              <div className="absolute right-2.5 flex items-center gap-1.5 text-[11px] text-amber-400">
                <Spinner />
                <span>{t("terminal.aiInput.generating")}</span>
              </div>
            )}
          </div>

          <Button
            type="submit"
            size="xs"
            disabled={!prompt.trim() || loading}
            className="h-8 gap-1.5 rounded-lg px-3 text-[11px] font-medium bg-amber-500 text-white hover:bg-amber-600 shrink-0 shadow-sm"
          >
            {loading ? <Spinner /> : <HugeiconsIcon icon={PlayIcon} size={12} />}
            <span>{t("terminal.aiInput.generateAndRun")}</span>
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-[11px] text-rose-400 pl-8">
          {error}
        </p>
      )}
    </div>
  );
}
