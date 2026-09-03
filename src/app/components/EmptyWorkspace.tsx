import { useTranslation } from "@/modules/i18n";
import { useTerminalDropStore } from "@/modules/terminal/lib/dropStore";
import {
  ComputerTerminal02Icon,
  File02Icon,
  FileEditIcon,
  FolderOpenIcon,
  SparklesIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

type Props = {
  projectName?: string;
  onOpenFile: () => void;
  onOpenFolder?: () => void;
  onNewFile?: () => void;
  onNewTerminal: () => void;
  onOpenHarness?: () => void;
  onDropPath?: (path: string) => void;
};

export function EmptyWorkspace({
  projectName,
  onOpenFile,
  onOpenFolder,
  onNewFile,
  onNewTerminal,
  onOpenHarness,
  onDropPath,
}: Props) {
  const { t } = useTranslation();
  const isWorkspaceHovered = useTerminalDropStore((s) => s.isWorkspaceHovered);
  const [isHtmlDragOver, setIsHtmlDragOver] = useState(false);

  const isDragging = isWorkspaceHovered || isHtmlDragOver;
  const label = projectName || t("common.default");
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
  const modKey = isMac ? "⌘" : "Ctrl+";

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsHtmlDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsHtmlDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsHtmlDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const path = (file as unknown as { path?: string }).path;
        if (path) {
          onDropPath?.(path);
        }
      }
    }
  };

  return (
    <div
      data-empty-workspace
      role="region"
      aria-label={t("workspace.empty.title")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex h-full min-h-0 items-center justify-center px-6 pb-8 transition-colors duration-200 ${
        isDragging ? "bg-primary/5" : ""
      }`}
    >
      {/* Visual Drop Highlight Overlay */}
      {isDragging && (
        <div className="absolute inset-4 z-20 pointer-events-none flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/70 bg-background/80 backdrop-blur-md shadow-2xl animate-in fade-in zoom-in-95 duration-150">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary mb-3">
            <HugeiconsIcon icon={Upload01Icon} size={36} strokeWidth={2} />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {t("workspace.empty.dropPrompt")}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t("workspace.empty.dropSubtitle")}
          </p>
        </div>
      )}

      <div className={`flex max-w-xl flex-col items-center text-center transition-opacity duration-150 ${isDragging ? "opacity-20 pointer-events-none" : ""}`}>
        <div className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary shadow-sm ring-1 ring-inset ring-primary/20 backdrop-blur-md">
          <HugeiconsIcon icon={FileEditIcon} size={44} strokeWidth={1.5} />
        </div>
        <p className="mb-2 max-w-full truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          {label}
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t("workspace.empty.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground max-w-md">
          {t("workspace.empty.description", { project: label })}
        </p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full max-w-2xl">
          <button
            type="button"
            onClick={onOpenFile}
            className="group flex items-center justify-between gap-2.5 h-12 px-3.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-md shadow-primary/20 hover:bg-primary/90 transition-all active:scale-[0.98]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <HugeiconsIcon icon={File02Icon} size={17} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{t("workspace.empty.openFile")}</span>
            </div>
            <kbd className="shrink-0 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-mono">
              {modKey}O
            </kbd>
          </button>

          {onOpenFolder && (
            <button
              type="button"
              onClick={onOpenFolder}
              className="group flex items-center justify-between gap-2.5 h-12 px-3.5 rounded-xl bg-muted/60 hover:bg-muted/90 text-foreground text-xs font-semibold border border-border/40 transition-all active:scale-[0.98]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <HugeiconsIcon icon={FolderOpenIcon} size={17} strokeWidth={2} className="shrink-0 text-muted-foreground group-hover:text-foreground" />
                <span className="truncate">{t("workspace.empty.openFolder")}</span>
              </div>
              <kbd className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border/40">
                {modKey}⇧O
              </kbd>
            </button>
          )}

          <button
            type="button"
            onClick={onNewTerminal}
            className="group flex items-center justify-between gap-2.5 h-12 px-3.5 rounded-xl bg-muted/60 hover:bg-muted/90 text-foreground text-xs font-semibold border border-border/40 transition-all active:scale-[0.98]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <HugeiconsIcon
                icon={ComputerTerminal02Icon}
                size={17}
                strokeWidth={2}
                className="shrink-0 text-muted-foreground group-hover:text-foreground"
              />
              <span className="truncate">{t("workspace.empty.newTerminal")}</span>
            </div>
            <kbd className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border/40">
              {modKey}T
            </kbd>
          </button>

          {onOpenHarness && (
            <button
              type="button"
              onClick={onOpenHarness}
              className="group flex items-center justify-between gap-2.5 h-12 px-3.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-foreground text-xs font-semibold border border-violet-500/30 hover:border-violet-500/50 transition-all active:scale-[0.98] shadow-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <HugeiconsIcon
                  icon={SparklesIcon}
                  size={17}
                  strokeWidth={2}
                  className="shrink-0 text-violet-400 group-hover:text-violet-300"
                />
                <span className="truncate">{t("workspace.empty.openHarness", { defaultValue: "Agent Harness" })}</span>
              </div>
              <kbd className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-violet-400/90 border border-violet-500/30">
                {`${modKey}⇧D`}
              </kbd>
            </button>
          )}
        </div>
        {onNewFile && (
          <button
            type="button"
            onClick={onNewFile}
            className="mt-5 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <HugeiconsIcon icon={FileEditIcon} size={14} />
            <span>{t("workspace.empty.newFile")}...</span>
          </button>
        )}
      </div>
    </div>
  );
}
