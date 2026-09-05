import { useState } from "react";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CodeIcon,
  Copy01Icon,
  Edit02Icon,
  Folder01Icon,
  Loading03Icon,
  Target01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { toast } from "sonner";
import type { LiveComponentMetadata } from "../types";
import {
  formatComponentBadgeLabel,
  formatComponentDebugPrompt,
  formatComponentLocation,
  formatComponentModifyPrompt,
  formatComponentReference,
  useLiveComponentStore,
} from "../store/liveComponentStore";

type Props = {
  component?: LiveComponentMetadata | null;
  onClear?: () => void;
  compact?: boolean;
  className?: string;
};

export function LiveComponentBadge({
  component: propComp,
  onClear,
  compact = false,
  className = "",
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const storeComp = useLiveComponentStore((s) => s.selectedComponent);
  const clearSelection = useLiveComponentStore((s) => s.clearSelection);

  const comp = propComp ?? storeComp;
  if (!comp) return null;

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClear) onClear();
    else clearSelection();
  };

  const triggerCopyFeedback = (key: string) => {
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((k) => (k === key ? null : k));
    }, 1800);
  };

  const handleJumpToCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetPath = comp.absolutePath || comp.filePath;
    if (targetPath) {
      window.dispatchEvent(
        new CustomEvent("voktty:jump-to-component", {
          detail: {
            path: targetPath,
            line: comp.lineNumber,
            column: comp.columnNumber,
          },
        }),
      );
      toast.success(
        t("preview.jumpingToCode") ||
          `Abriendo ${comp.filePath || targetPath}:${comp.lineNumber || 1}`,
      );
    }
  };

  const handleCopyReference = (e: React.MouseEvent) => {
    e.stopPropagation();
    const refText = formatComponentReference(comp);
    void navigator.clipboard.writeText(refText);
    triggerCopyFeedback("ref");
    toast.success(t("preview.copiedReference") || "Referencia copiada al portapapeles");
  };

  const handleCopyDebugPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const promptText = formatComponentDebugPrompt(comp);
    void navigator.clipboard.writeText(promptText);
    triggerCopyFeedback("debug");
    toast.success(t("preview.copiedDebugPrompt") || "Prompt de Debug copiado");
  };

  const handleCopyModifyPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const promptText = formatComponentModifyPrompt(comp);
    void navigator.clipboard.writeText(promptText);
    triggerCopyFeedback("modify");
    toast.success(t("preview.copiedModifyPrompt") || "Prompt de Modificación copiado");
  };

  const handleCopySelector = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(comp.selector);
    triggerCopyFeedback("selector");
    toast.success("Selector CSS copiado");
  };

  const handleCopyHtml = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (comp.htmlSnippet) {
      void navigator.clipboard.writeText(comp.htmlSnippet);
      triggerCopyFeedback("html");
      toast.success("Fragmento HTML copiado");
    }
  };

  const label = formatComponentBadgeLabel(comp);
  const location = formatComponentLocation(comp);

  const dimWidth = comp.rect?.width ? Math.round(comp.rect.width) : null;
  const dimHeight = comp.rect?.height ? Math.round(comp.rect.height) : null;

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/90 px-2.5 py-1 text-xs text-cyan-200 shadow-md select-none animate-in fade-in duration-150 backdrop-blur-md ${className}`}
        title={`${comp.selector}\n${comp.htmlSnippet || ""}`}
      >
        <HugeiconsIcon
          icon={Target01Icon}
          size={13}
          strokeWidth={2}
          className="text-cyan-400 shrink-0"
        />
        <span
          onClick={comp.filePath ? handleJumpToCode : undefined}
          className={`font-semibold font-mono truncate max-w-[160px] ${
            comp.filePath ? "cursor-pointer hover:underline text-cyan-200" : "text-cyan-300"
          }`}
        >
          {label}
        </span>
        {comp.filePath ? (
          <span
            onClick={handleJumpToCode}
            className="text-[11px] text-cyan-400/80 font-mono truncate max-w-[130px] cursor-pointer hover:text-cyan-100"
          >
            ({location})
          </span>
        ) : comp.isResolvingSource ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            size={11}
            className="animate-spin text-cyan-400"
          />
        ) : null}
        <div className="flex items-center gap-1 border-l border-cyan-500/30 pl-1.5 ml-1">
          <button
            type="button"
            onClick={handleCopyReference}
            title={t("preview.copyReference") || "Copiar Referencia"}
            className="rounded p-1 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
          >
            <HugeiconsIcon
              icon={copiedKey === "ref" ? Tick02Icon : Copy01Icon}
              size={12}
              strokeWidth={2}
            />
          </button>
          <button
            type="button"
            onClick={handleCopyDebugPrompt}
            title={t("preview.copyDebugPrompt") || "Copiar Prompt Debug"}
            className="rounded p-1 text-rose-300 hover:bg-rose-500/20 transition-colors"
          >
            <HugeiconsIcon
              icon={copiedKey === "debug" ? Tick02Icon : Alert02Icon}
              size={12}
              strokeWidth={2}
            />
          </button>
          <button
            type="button"
            onClick={handleCopyModifyPrompt}
            title={t("preview.copyModifyPrompt") || "Copiar Prompt Modificar"}
            className="rounded p-1 text-amber-300 hover:bg-amber-500/20 transition-colors"
          >
            <HugeiconsIcon
              icon={copiedKey === "modify" ? Tick02Icon : Edit02Icon}
              size={12}
              strokeWidth={2}
            />
          </button>
          {comp.filePath ? (
            <button
              type="button"
              onClick={handleJumpToCode}
              title={t("preview.jumpToCode") || "Ir al Código"}
              className="rounded p-1 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              <HugeiconsIcon icon={CodeIcon} size={12} strokeWidth={2} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleClear}
            title={t("preview.clearSelection") || "Cerrar"}
            className="rounded p-1 text-muted-foreground hover:bg-cyan-500/20 hover:text-foreground transition-colors"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col rounded-xl border border-cyan-500/40 bg-background/95 p-2.5 sm:p-3 text-xs text-foreground shadow-2xl backdrop-blur-xl select-none ring-1 ring-cyan-500/20 animate-in fade-in slide-in-from-top-2 duration-200 ${className}`}
    >
      {/* Top Header: Target Info & Badges */}
      <div className="flex items-center justify-between gap-2.5 min-w-0 pb-2 border-b border-border/40">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <div className="flex size-7 items-center justify-center rounded-md bg-cyan-500/15 text-cyan-400 shrink-0 border border-cyan-500/30">
            <HugeiconsIcon icon={Target01Icon} size={15} strokeWidth={2} />
          </div>

          <span
            onClick={comp.filePath ? handleJumpToCode : undefined}
            className={`font-bold font-mono text-cyan-300 text-[13px] whitespace-nowrap shrink-0 ${
              comp.filePath ? "cursor-pointer hover:underline" : ""
            }`}
          >
            {label}
          </span>

          {comp.filePath ? (
            <button
              type="button"
              onClick={handleJumpToCode}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-950/70 border border-cyan-500/35 px-2 py-0.5 text-xs font-mono text-cyan-200 hover:text-cyan-100 hover:bg-cyan-900/70 transition-colors shrink-0 whitespace-nowrap max-w-[260px] truncate"
              title={`Abrir ${comp.filePath}:${comp.lineNumber || 1} en el editor`}
            >
              <HugeiconsIcon icon={Folder01Icon} size={12} className="shrink-0 text-cyan-400" />
              <span className="truncate">{location}</span>
            </button>
          ) : comp.isResolvingSource ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-cyan-400 font-medium whitespace-nowrap shrink-0">
              <HugeiconsIcon
                icon={Loading03Icon}
                size={12}
                className="animate-spin text-cyan-400"
              />
              Buscando archivo...
            </span>
          ) : (
            <span
              className="text-xs text-muted-foreground font-mono truncate max-w-[200px]"
              title={comp.selector}
            >
              {comp.selector}
            </span>
          )}

          {comp.framework && comp.framework !== "dom-generic" ? (
            <span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] uppercase font-semibold text-cyan-300 whitespace-nowrap shrink-0">
              {comp.framework}
            </span>
          ) : null}

          {comp.matchedBy ? (
            <span className="rounded bg-muted/60 border border-border/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground whitespace-nowrap shrink-0">
              via {comp.matchedBy}
            </span>
          ) : null}

          {dimWidth && dimHeight ? (
            <span className="rounded bg-muted/40 border border-border/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground whitespace-nowrap shrink-0">
              {dimWidth} × {dimHeight}px
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleClear}
          title={t("preview.clearSelection") || "Cerrar inspector"}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0 ml-1"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Primary Action Buttons Toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap pt-2">
        <button
          type="button"
          onClick={handleCopyReference}
          title={t("preview.copyReference") || "Copiar referencia técnica"}
          className="flex items-center gap-1.5 rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground px-2.5 py-1 text-xs font-medium transition-colors border border-border/60 active:scale-95 shadow-sm whitespace-nowrap shrink-0"
        >
          <HugeiconsIcon
            icon={copiedKey === "ref" ? Tick02Icon : Copy01Icon}
            size={13}
            strokeWidth={2}
            className={copiedKey === "ref" ? "text-emerald-400" : ""}
          />
          <span>{copiedKey === "ref" ? "¡Copiado!" : "Copiar Ref"}</span>
        </button>

        <button
          type="button"
          onClick={handleCopyDebugPrompt}
          title={t("preview.copyDebugPrompt") || "Copiar prompt estructurado para depurar"}
          className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/30 px-2.5 py-1 text-xs font-medium transition-colors active:scale-95 shadow-sm whitespace-nowrap shrink-0"
        >
          <HugeiconsIcon
            icon={copiedKey === "debug" ? Tick02Icon : Alert02Icon}
            size={13}
            strokeWidth={2}
            className={copiedKey === "debug" ? "text-emerald-400" : ""}
          />
          <span>{copiedKey === "debug" ? "¡Copiado!" : "Prompt Debug"}</span>
        </button>

        <button
          type="button"
          onClick={handleCopyModifyPrompt}
          title={t("preview.copyModifyPrompt") || "Copiar prompt de instrucción para modificar"}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/30 px-2.5 py-1 text-xs font-medium transition-colors active:scale-95 shadow-sm whitespace-nowrap shrink-0"
        >
          <HugeiconsIcon
            icon={copiedKey === "modify" ? Tick02Icon : Edit02Icon}
            size={13}
            strokeWidth={2}
            className={copiedKey === "modify" ? "text-emerald-400" : ""}
          />
          <span>{copiedKey === "modify" ? "¡Copiado!" : "Prompt Modificar"}</span>
        </button>

        {comp.filePath ? (
          <button
            type="button"
            onClick={handleJumpToCode}
            title={t("preview.jumpToCode") || "Abrir archivo y línea en el editor"}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 hover:text-cyan-100 border border-cyan-500/40 px-2.5 py-1 text-xs font-medium transition-colors active:scale-95 shadow-sm whitespace-nowrap shrink-0"
          >
            <HugeiconsIcon icon={CodeIcon} size={13} strokeWidth={2} />
            <span>Ir al Código</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Ocultar detalles técnicos" : "Ver detalles técnicos y HTML"}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium border transition-colors ml-auto whitespace-nowrap shrink-0 ${
            expanded
              ? "bg-cyan-500/20 text-cyan-200 border-cyan-500/40"
              : "bg-muted/60 text-muted-foreground hover:bg-muted border-border/50"
          }`}
        >
          <HugeiconsIcon
            icon={expanded ? ArrowUp01Icon : ArrowDown01Icon}
            size={13}
            strokeWidth={2}
          />
          <span>Detalles</span>
        </button>
      </div>

      {/* Expandable Technical Details Drawer */}
      {expanded ? (
        <div className="mt-3 flex flex-col gap-2.5 pt-3 border-t border-border/60 animate-in fade-in duration-150">
          {/* DOM Selector */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
              <span>Selector DOM</span>
              <button
                type="button"
                onClick={handleCopySelector}
                className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
              >
                <HugeiconsIcon
                  icon={copiedKey === "selector" ? Tick02Icon : Copy01Icon}
                  size={10}
                />
                {copiedKey === "selector" ? "Copiado" : "Copiar"}
              </button>
            </div>
            <div className="rounded-lg bg-muted/60 p-2 font-mono text-xs text-foreground/90 select-text overflow-x-auto border border-border/40">
              {comp.selector}
            </div>
          </div>

          {/* Ancestor Hierarchy */}
          {comp.parentClasses && comp.parentClasses.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Jerarquía de Contenedores
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {comp.parentClasses.map((cls, idx) => (
                  <span
                    key={`${cls}-${idx}`}
                    className="rounded bg-muted/80 border border-border/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                  >
                    {cls}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Visible Text */}
          {comp.innerText ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Texto Visible
              </span>
              <div className="rounded-lg bg-muted/40 p-2 text-xs italic text-foreground/85 border border-border/30 select-text">
                &ldquo;{comp.innerText}&rdquo;
              </div>
            </div>
          ) : null}

          {/* HTML Snippet */}
          {comp.htmlSnippet ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                <span>Fragmento HTML</span>
                <button
                  type="button"
                  onClick={handleCopyHtml}
                  className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <HugeiconsIcon
                    icon={copiedKey === "html" ? Tick02Icon : Copy01Icon}
                    size={10}
                  />
                  {copiedKey === "html" ? "Copiado" : "Copiar"}
                </button>
              </div>
              <pre className="rounded-lg bg-muted/70 p-2.5 font-mono text-[11px] text-foreground/90 select-text overflow-x-auto max-h-36 border border-border/40 whitespace-pre-wrap break-all">
                {comp.htmlSnippet}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
