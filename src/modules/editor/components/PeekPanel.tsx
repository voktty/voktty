import { useTranslation } from "@/modules/i18n";
import type { LspPeekItem, LspPeekKind } from "@/modules/lsp/lib/client";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  FileSearchIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PeekExcerpt } from "@/modules/editor/lib/peekModel";
import { movePeekIndex } from "@/modules/editor/lib/peekModel";
import { buildSharedExtensions } from "@/modules/editor/lib/extensions";
import { resolveLanguage } from "@/modules/editor/lib/languageResolver";
import { useEditorThemeExt } from "@/modules/editor/lib/useEditorThemeExt";

export type PeekDocumentState =
  | { status: "loading" }
  | { status: "ready"; excerpt: PeekExcerpt }
  | { status: "binary" | "tooLarge" | "invalid" | "error" };

type Props = {
  kind: LspPeekKind;
  items: LspPeekItem[];
  activeIndex: number;
  document: PeekDocumentState;
  onSelect: (index: number) => void;
  onOpen: (item: LspPeekItem) => void;
  onClose: () => void;
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function PeekPanel({
  kind,
  items,
  activeIndex,
  document,
  onSelect,
  onOpen,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const active = items[activeIndex];
  const theme = useEditorThemeExt();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ReactCodeMirrorRef>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const [language, setLanguage] = useState<Extension>([]);

  useEffect(() => {
    let cancelled = false;
    setLanguage([]);
    if (!active) return;
    void resolveLanguage(active.path).then((result) => {
      if (!cancelled) setLanguage(result?.ext ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const extensions = useMemo<Extension[]>(() => {
    const startLine =
      document.status === "ready" ? document.excerpt.startLine : 1;
    return [
      ...buildSharedExtensions(),
      language,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      lineNumbers({ formatNumber: (line) => String(line + startLine - 1) }),
    ];
  }, [document, language]);

  useLayoutEffect(() => {
    if (document.status !== "ready") return;
    const view = previewRef.current?.view;
    if (!view) return;
    const target = Math.min(
      document.excerpt.targetOffset,
      view.state.doc.length,
    );
    view.dispatch({
      selection: { anchor: target },
      effects: EditorView.scrollIntoView(target, { y: "center" }),
    });
  }, [document]);

  useEffect(() => {
    rowRefs.current.get(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    (items.length > 1 ? listRef.current : sectionRef.current)?.focus();
  }, [items.length]);

  if (!active) return null;
  const title = t(`editor.peek.${kind}Title`);
  const selectRelative = (delta: number) =>
    onSelect(movePeekIndex(activeIndex, delta, items.length));

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="flex h-[38%] min-h-52 max-h-[32rem] shrink-0 flex-col border-t border-border/70 bg-background/98 shadow-[0_-12px_36px_rgba(0,0,0,0.18)]"
      aria-label={title}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2.5">
        <HugeiconsIcon
          icon={kind === "definition" ? SourceCodeIcon : FileSearchIcon}
          size={14}
          className="text-primary"
        />
        <span className="truncate text-xs font-semibold text-foreground">
          {title}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {active.label}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {activeIndex + 1}/{items.length}
        </span>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label={t("editor.peek.previous")}
          title={t("editor.peek.previous")}
          disabled={items.length < 2}
          onClick={() => selectRelative(-1)}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={13} />
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label={t("editor.peek.next")}
          title={t("editor.peek.next")}
          disabled={items.length < 2}
          onClick={() => selectRelative(1)}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={13} />
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("editor.peek.open")}
          title={t("editor.peek.open")}
          onClick={() => onOpen(active)}
        >
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} />
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("editor.peek.close")}
          title={t("editor.peek.close")}
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {items.length > 1 && (
          <div
            ref={listRef}
            role="listbox"
            aria-label={t("editor.peek.results")}
            className="w-64 shrink-0 overflow-y-auto border-r border-border/60 bg-muted/10 p-1.5"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") selectRelative(1);
              else if (event.key === "ArrowUp") selectRelative(-1);
              else if (event.key === "Enter") onOpen(active);
              else return;
              event.preventDefault();
            }}
          >
            {items.map((item, index) => (
              <button
                key={`${item.uri}:${item.line}:${item.character}`}
                ref={(node) => {
                  if (node) rowRefs.current.set(index, node);
                  else rowRefs.current.delete(index);
                }}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className="flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60 aria-selected:bg-accent aria-selected:text-accent-foreground"
                onClick={() => onSelect(index)}
                onDoubleClick={() => onOpen(item)}
              >
                <span className="truncate font-medium">
                  {basename(item.path)}
                </span>
                <span className="w-full truncate font-mono text-[10px] text-muted-foreground">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="relative min-w-0 flex-1 overflow-hidden">
          {document.status === "ready" ? (
            <CodeMirror
              ref={previewRef}
              value={document.excerpt.content}
              theme={theme}
              extensions={extensions}
              height="100%"
              className="h-full overflow-hidden"
              basicSetup={{
                lineNumbers: false,
                highlightActiveLineGutter: true,
                foldGutter: true,
                bracketMatching: true,
                highlightActiveLine: true,
                highlightSelectionMatches: false,
                searchKeymap: false,
                autocompletion: false,
                closeBrackets: false,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
              {t(`editor.peek.${document.status}`)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
