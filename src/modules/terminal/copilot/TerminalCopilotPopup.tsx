import { DEFAULT_MODEL_ID, MODELS } from "@/modules/ai/config";
import { Spinner } from "@/components/ui/spinner";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useTranslation } from "@/modules/i18n";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useDraggableModal } from "@/hooks/useDraggableModal";
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
import { usePreferencesStore } from "@/modules/settings/preferences";
import { SHORTCUTS, matchBinding } from "@/modules/shortcuts";
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

  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { position, dragHandleProps } = useDraggableModal();

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
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);

  useEffect(() => {
    if (active) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handlePointerDownOutside);
    document.addEventListener("touchstart", handlePointerDownOutside);
    return () => {
      document.removeEventListener("mousedown", handlePointerDownOutside);
      document.removeEventListener("touchstart", handlePointerDownOutside);
    };
  }, [active, onClose]);

  useEffect(() => {
    if (!active) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const copilotBindings =
        usePreferencesStore.getState().shortcuts["terminal.copilot"] ??
        SHORTCUTS.find((s) => s.id === "terminal.copilot")?.defaultBindings ??
        [];
      if (copilotBindings.some((b) => matchBinding(e, b, "terminal.copilot"))) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [active, onClose]);

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
    <div className="absolute inset-x-0 top-2 z-30 flex justify-center px-3 pointer-events-none">
      <div
        ref={cardRef}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
        className="pointer-events-auto flex w-full max-w-lg flex-col rounded-lg border border-border/80 bg-popover text-popover-foreground p-3 shadow-xl select-none transition-shadow"
      >
        {/* Header bar / Drag handle */}
        <div
          {...dragHandleProps}
          className="flex items-center justify-between gap-2 pb-2 cursor-grab active:cursor-grabbing border-b border-border/40"
        >
          <div className="flex items-center gap-1.5 pointer-events-none min-w-0">
            <HugeiconsIcon
              icon={SparklesIcon}
              size={13}
              strokeWidth={2}
              className="text-primary shrink-0"
            />
            <span className="text-xs font-semibold text-foreground tracking-tight truncate">
              {t("terminal.copilot.title")}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.2 text-[9.5px] font-mono text-muted-foreground uppercase shrink-0">
              {shellName}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Active Model Switcher */}
            <select
              value={modelId}
              data-no-drag
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="h-5.5 max-w-36 rounded-md bg-muted/70 hover:bg-muted text-[10px] font-mono text-foreground px-1.5 py-0 border border-border/50 outline-none cursor-pointer focus:ring-1 focus:ring-primary/40 truncate"
              title={t("settings.tabs.models")}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              data-no-drag
              onClick={onClose}
              className="flex size-5.5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              title={`${t("terminal.copilot.cancel")} (Esc)`}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
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
          className="relative flex items-center mt-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("terminal.copilot.placeholder")}
            className="h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 pr-14"
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
          <div className="absolute right-1 flex items-center gap-1">
            {loading ? (
              <Spinner className="size-3 text-primary" />
            ) : (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!prompt.trim()}
                className="flex h-5.5 items-center gap-0.5 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={SparklesIcon} size={10} strokeWidth={2} />
                <span>↵</span>
              </button>
            )}
          </div>
        </form>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
            <Spinner className="size-3 text-primary" />
            <span className="text-[11px]">{t("terminal.copilot.generating")}</span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Generated Result */}
        {result && !loading && (
          <div className="mt-2 flex flex-col gap-1.5 animate-in fade-in-50 duration-150">
            <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 font-mono text-[11.5px]">
              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto">
                <HugeiconsIcon
                  icon={CommandLineIcon}
                  size={13}
                  className="shrink-0 text-primary"
                />
                <code className="select-all font-mono font-semibold text-foreground whitespace-pre">
                  {result.command}
                </code>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-2 flex size-5.5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                title={t("terminal.copilot.copied")}
              >
                <HugeiconsIcon
                  icon={copied ? Tick02Icon : Copy01Icon}
                  size={12}
                  className={copied ? "text-emerald-500" : ""}
                />
              </button>
            </div>

            {result.explanation && (
              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                {result.explanation}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Refresh01Icon} size={11} />
                <span>{t("terminal.copilot.regenerate")}</span>
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleInsert}
                  className="flex h-5.5 items-center gap-1 rounded border border-border/80 bg-background px-2 text-[10.5px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
                >
                  <span>{t("terminal.copilot.insert")}</span>
                  <KbdGroup>
                    <Kbd className="h-3 px-1 text-[8.5px]">↵</Kbd>
                  </KbdGroup>
                </button>

                <button
                  type="button"
                  onClick={handleExecute}
                  className="flex h-5.5 items-center gap-1 rounded bg-primary px-2 text-[10.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={PlayIcon} size={9} strokeWidth={2.5} />
                  <span>{t("terminal.copilot.execute")}</span>
                  <KbdGroup>
                    <Kbd className="h-3 border-primary-foreground/30 bg-primary-foreground/15 px-1 text-[8.5px] text-primary-foreground">
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
