import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  CodeIcon,
  Copy01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  isPathInRemoteWorkspace,
  remoteReadDocument,
} from "@/modules/remote";
import {
  type WorkspaceEnv,
  workspaceForDocumentPath,
  workspaceForNativeFs,
} from "@/modules/workspace";
import { useTranslation } from "@/modules/i18n";
import { invoke } from "@tauri-apps/api/core";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import {
  type DocumentHighlight,
  type HighlightColor,
  normalizeHighlightPath,
  useDocumentHighlightStore,
} from "../editor/store/documentHighlightStore";
import { MarkdownDocContext } from "./lib/docContext";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownLink } from "./MarkdownLink";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import {
  createDomSearchController,
  type DomSearchMatchInfo,
} from "./lib/domSearch";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

export type MarkdownSearchHandle = {
  setQuery: (q: string) => DomSearchMatchInfo;
  findNext: () => DomSearchMatchInfo;
  findPrevious: () => DomSearchMatchInfo;
  clearQuery: () => void;
  focus: () => void;
};

type Props = {
  path: string;
  workspaceEnv: WorkspaceEnv;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

const components = {
  a: MarkdownLink,
  img: MarkdownImage,
  code: MarkdownCode,
};

const customRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
];

function applyHighlightsToContainer(
  container: HTMLElement,
  highlights: DocumentHighlight[],
) {
  const existingMarks = container.querySelectorAll("mark.voktty-doc-highlight");
  existingMarks.forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }
  });

  if (!highlights || highlights.length === 0) return;

  for (const h of highlights) {
    if (!h.text || !h.text.trim()) continue;
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
    );
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.nodeValue ?? "";
      const idx = text.indexOf(h.text);
      if (idx !== -1 && node.parentElement?.tagName !== "MARK") {
        try {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + h.text.length);
          const mark = document.createElement("mark");
          mark.className = `voktty-doc-highlight voktty-doc-highlight-${h.color || "yellow"}`;
          mark.setAttribute("data-highlight-id", h.id);
          mark.style.borderRadius = "2px";
          mark.style.padding = "1px 2px";
          if (h.color === "green") {
            mark.style.backgroundColor = "rgba(34, 197, 94, 0.35)";
            mark.style.borderBottom = "2px solid rgba(34, 197, 94, 0.75)";
          } else if (h.color === "blue") {
            mark.style.backgroundColor = "rgba(56, 189, 248, 0.35)";
            mark.style.borderBottom = "2px solid rgba(56, 189, 248, 0.75)";
          } else if (h.color === "pink") {
            mark.style.backgroundColor = "rgba(244, 114, 182, 0.35)";
            mark.style.borderBottom = "2px solid rgba(244, 114, 182, 0.75)";
          } else if (h.color === "purple") {
            mark.style.backgroundColor = "rgba(168, 85, 247, 0.35)";
            mark.style.borderBottom = "2px solid rgba(168, 85, 247, 0.75)";
          } else {
            mark.style.backgroundColor = "rgba(234, 179, 8, 0.35)";
            mark.style.borderBottom = "2px solid rgba(234, 179, 8, 0.75)";
          }
          mark.style.color = "inherit";
          range.surroundContents(mark);
          break;
        } catch {}
      }
      node = walker.nextNode();
    }
  }
}

export const MarkdownPreviewPane = forwardRef<MarkdownSearchHandle, Props>(
  function MarkdownPreviewPane(
    { path, workspaceEnv, visible, onSetView },
    ref,
  ) {
    const { t } = useTranslation();
    const [status, setStatus] = useState<Status>({ kind: "loading" });
    const contentRef = useRef<HTMLDivElement>(null);
    const searcherRef = useRef<ReturnType<typeof createDomSearchController> | null>(
      null,
    );

    const normPath = normalizeHighlightPath(path);
    const highlights = useDocumentHighlightStore(
      (s) => s.highlightsByPath[normPath] ?? [],
    );

    useImperativeHandle(
      ref,
      () => ({
        setQuery: (q: string) => {
          if (!contentRef.current) return { current: 0, total: 0 };
          if (!searcherRef.current) {
            searcherRef.current = createDomSearchController(contentRef.current);
          }
          return searcherRef.current.setQuery(q);
        },
        findNext: () => {
          if (!searcherRef.current) return { current: 0, total: 0 };
          return searcherRef.current.findNext();
        },
        findPrevious: () => {
          if (!searcherRef.current) return { current: 0, total: 0 };
          return searcherRef.current.findPrevious();
        },
        clearQuery: () => {
          searcherRef.current?.clearQuery();
        },
        focus: () => {
          contentRef.current?.focus();
        },
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;
      setStatus({ kind: "loading" });
      const workspace = workspaceForDocumentPath(workspaceEnv, path);
      const read = isPathInRemoteWorkspace(workspace, path)
        ? remoteReadDocument(workspace, path, false)
        : invoke<ReadResult>("fs_read_file", {
            path,
            workspace: workspaceForNativeFs(workspace, path),
          });
      read
        .then((res) => {
          if (cancelled) return;
          if (res.kind === "text") {
            setStatus({ kind: "ready", content: res.content });
          } else if (res.kind === "binary") {
            setStatus({ kind: "binary" });
          } else {
            setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
          }
        })
        .catch((e) => {
          if (!cancelled) setStatus({ kind: "error", message: String(e) });
        });
      return () => {
        cancelled = true;
      };
    }, [path, workspaceEnv]);

    // Apply document highlights onto rendered content
    useEffect(() => {
      if (status.kind !== "ready" || !contentRef.current) return;
      const timer = setTimeout(() => {
        if (contentRef.current) {
          applyHighlightsToContainer(contentRef.current, highlights);
        }
      }, 50);
      return () => clearTimeout(timer);
    }, [status, highlights]);

    const handleCopy = useCallback(() => {
      const sel = window.getSelection()?.toString();
      if (sel) {
        void navigator.clipboard.writeText(sel);
        toast.success(t("common.textCopied"));
      }
    }, [t]);

    const handleHighlight = useCallback(
      (color: HighlightColor = "yellow") => {
        const sel = window.getSelection()?.toString();
        if (!sel || !sel.trim()) return;

        useDocumentHighlightStore.getState().addHighlight(path, {
          from: 0,
          to: sel.length,
          text: sel.trim(),
          color,
        });

        toast.success(t("editor.highlightAdded"));
      },
      [path, t],
    );

    const handleRemoveHighlight = useCallback(() => {
      const sel = window.getSelection()?.toString();
      if (sel && sel.trim()) {
        useDocumentHighlightStore
          .getState()
          .removeHighlightByText(path, sel.trim());
        toast.info(t("editor.highlightRemoved"));
      }
    }, [path, t]);

    const handleClearAllHighlights = useCallback(() => {
      useDocumentHighlightStore.getState().clearHighlights(path);
      toast.info(t("editor.highlightsCleared"));
    }, [path, t]);

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "relative flex h-full w-full flex-col overflow-hidden bg-background",
              !visible && "pointer-events-none",
            )}
          >
            <MarkdownViewToggle mode="rendered" onChange={onSetView} />
            <div className="flex-1 overflow-auto">
              <div ref={contentRef} className="px-8 py-6 select-text">
                {status.kind === "loading" && (
                  <p className="text-[12px] text-muted-foreground">
                    {t("common.loading")}
                  </p>
                )}
                {status.kind === "error" && (
                  <p className="text-[12px] text-destructive">
                    {t("feedback.markdownReadFailed", { error: status.message })}
                  </p>
                )}
                {status.kind === "binary" && (
                  <p className="text-[12px] text-muted-foreground">
                    {t("feedback.markdownBinary")}
                  </p>
                )}
                {status.kind === "toolarge" && (
                  <p className="text-[12px] text-muted-foreground">
                    {t("feedback.markdownTooLarge", {
                      size: status.size,
                      limit: status.limit,
                    })}
                  </p>
                )}
                {status.kind === "ready" && (
                  <MarkdownDocContext.Provider
                    value={{ docPath: path, workspaceEnv }}
                  >
                    <Streamdown
                      className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      components={components}
                      rehypePlugins={customRehypePlugins}
                      mode="static"
                      parseIncompleteMarkdown={false}
                    >
                      {status.content}
                    </Streamdown>
                  </MarkdownDocContext.Provider>
                )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-56 p-1">
          <ContextMenuItem
            onSelect={handleCopy}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
          >
            <HugeiconsIcon
              icon={Copy01Icon}
              size={14}
              className="text-muted-foreground"
            />
            <span className="flex-1">{t("editor.context.copy")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Ctrl+C
            </span>
          </ContextMenuItem>

          <ContextMenuSeparator className="my-1 border-border/30" />

          <ContextMenuSub>
            <ContextMenuSubTrigger className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground">
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                size={14}
                className="text-amber-400"
              />
              <span className="flex-1">{t("editor.highlightText")}</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52 p-1">
              <ContextMenuItem
                onSelect={() => handleHighlight("yellow")}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent"
              >
                <span className="h-3 w-3 rounded-full bg-yellow-400 border border-yellow-500/50 shadow-xs" />
                <span className="flex-1">{t("editor.highlightColorYellow")}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => handleHighlight("green")}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent"
              >
                <span className="h-3 w-3 rounded-full bg-emerald-400 border border-emerald-500/50 shadow-xs" />
                <span className="flex-1">{t("editor.highlightColorGreen")}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => handleHighlight("blue")}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent"
              >
                <span className="h-3 w-3 rounded-full bg-sky-400 border border-sky-500/50 shadow-xs" />
                <span className="flex-1">{t("editor.highlightColorBlue")}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => handleHighlight("pink")}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent"
              >
                <span className="h-3 w-3 rounded-full bg-pink-400 border border-pink-500/50 shadow-xs" />
                <span className="flex-1">{t("editor.highlightColorPink")}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => handleHighlight("purple")}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent"
              >
                <span className="h-3 w-3 rounded-full bg-purple-400 border border-purple-500/50 shadow-xs" />
                <span className="flex-1">{t("editor.highlightColorPurple")}</span>
              </ContextMenuItem>
              <ContextMenuSeparator className="my-1 border-border/30" />
              <ContextMenuItem
                onSelect={handleRemoveHighlight}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} className="text-muted-foreground" />
                <span className="flex-1">{t("editor.removeHighlight")}</span>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={handleClearAllHighlights}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-destructive/10 text-destructive"
              >
                <HugeiconsIcon icon={Delete02Icon} size={14} className="text-destructive" />
                <span className="flex-1">{t("editor.clearAllHighlights")}</span>
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator className="my-1 border-border/30" />

          <ContextMenuItem
            onSelect={() => onSetView("raw")}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
          >
            <HugeiconsIcon
              icon={CodeIcon}
              size={14}
              className="text-muted-foreground"
            />
            <span className="flex-1">{t("editor.viewSourceCode")}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  },
);
