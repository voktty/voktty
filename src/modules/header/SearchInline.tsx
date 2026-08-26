import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEY_SEP } from "@/lib/platform";
import type { EditorPaneHandle } from "@/modules/editor";
import { useTranslation } from "@/modules/i18n";
import type { MarkdownSearchHandle } from "@/modules/markdown";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

const TERM_DECORATIONS = {
  matchBackground: "#515c6a",
  activeMatchBackground: "#d18616",
  matchOverviewRuler: "#d18616",
  activeMatchColorOverviewRuler: "#d18616",
};

export type SearchMatchInfo = {
  current: number;
  total: number;
};

export type SearchTarget =
  | { kind: "terminal"; addon: SearchAddon; focus: () => void }
  | { kind: "editor"; handle: EditorPaneHandle; focus: () => void }
  | { kind: "markdown"; handle: MarkdownSearchHandle; focus: () => void }
  | {
      kind: "git-history";
      handle: { setQuery: (q: string) => void; clearQuery: () => void };
      focus: () => void;
    }
  | null;

export type SearchInlineHandle = {
  focus: () => void;
  findNext: () => void;
  findPrevious: () => void;
  isOpen: () => boolean;
};

type Props = {
  target: SearchTarget;
};

export const SearchInline = forwardRef<SearchInlineHandle, Props>(
  function SearchInline({ target }, ref) {
    const { t } = useTranslation();
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [matchInfo, setMatchInfo] = useState<SearchMatchInfo | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingFocusRef = useRef(false);
    const setInputRef = useCallback((el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (!el || !pendingFocusRef.current) return;
      pendingFocusRef.current = false;
      el.focus();
    }, []);

    const userShortcuts = usePreferencesStore((s) => s.shortcuts);

    const shortcutText = useMemo(() => {
      const s = SHORTCUTS.find((s) => s.id === "search.focus");
      if (!s) return "";
      const bindings = userShortcuts["search.focus"] || s.defaultBindings;
      if (!bindings || bindings.length === 0) return "";
      const tokens = getBindingTokens(bindings[0]);
      return tokens.join(KEY_SEP);
    }, [userShortcuts]);

    const baseLabel =
      target?.kind === "git-history"
        ? `${t("sidebar.git")} ${t("common.search").toLowerCase()}`
        : t("common.search");

    const placeholder = useMemo(() => {
      return shortcutText ? `${baseLabel} (${shortcutText})` : baseLabel;
    }, [baseLabel, shortcutText]);

    const tooltipTitle = useMemo(() => {
      return shortcutText ? `${baseLabel} (${shortcutText})` : baseLabel;
    }, [baseLabel, shortcutText]);

    const focus = useCallback(() => {
      pendingFocusRef.current = true;
      setOpen(true);
      inputRef.current?.focus();
      if (inputRef.current) pendingFocusRef.current = false;
    }, []);

    const findDirection = useCallback(
      (forward: boolean) => {
        if (!target || !q) return;
        if (target.kind === "terminal") {
          const opts = { decorations: TERM_DECORATIONS };
          if (forward) target.addon.findNext(q, opts);
          else target.addon.findPrevious(q, opts);
        } else if (target.kind === "editor" || target.kind === "markdown") {
          const res = forward
            ? target.handle.findNext()
            : target.handle.findPrevious();
          if (res) setMatchInfo(res);
        }
      },
      [q, target],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus,
        findNext: () => findDirection(true),
        findPrevious: () => findDirection(false),
        isOpen: () => open,
      }),
      [focus, findDirection, open],
    );

    useEffect(() => {
      if (!open) return;
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (target instanceof Node && rootRef.current?.contains(target)) return;
        setOpen(false);
      };
      document.addEventListener("pointerdown", handlePointerDown);
      return () =>
        document.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);

    const clearTarget = useCallback(() => {
      setMatchInfo(null);
      if (!target) return;
      if (target.kind === "terminal") target.addon.clearDecorations();
      else target.handle.clearQuery();
    }, [target]);

    const restoreTargetFocus = useCallback(() => {
      if (!target) return;
      target.focus();
    }, [target]);

    // Target switched (terminal ↔ editor ↔ markdown) or removed → drop highlights.
    useEffect(() => clearTarget, [clearTarget]);

    const applyIncremental = (next: string) => {
      if (!target) {
        setMatchInfo(null);
        return;
      }
      if (target.kind === "terminal") {
        if (next) {
          target.addon.findNext(next, {
            incremental: true,
            decorations: TERM_DECORATIONS,
          });
        } else {
          target.addon.clearDecorations();
        }
        setMatchInfo(null);
      } else if (target.kind === "editor" || target.kind === "markdown") {
        const res = target.handle.setQuery(next);
        setMatchInfo(res ?? null);
      } else {
        target.handle.setQuery(next);
        setMatchInfo(null);
      }
    };

    return (
      <div ref={rootRef} className="relative z-50 size-7 shrink-0">
        {open ? (
          <div className="absolute top-1/2 right-0 flex h-8 min-w-72 max-w-[calc(100vw-2rem)] -translate-y-1/2 items-center rounded-md border border-border/70 bg-background/95 px-1.5 shadow-xl ring-1 ring-black/10 backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150">
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              strokeWidth={1.75}
              className="pointer-events-none ml-1 shrink-0 text-muted-foreground"
            />
            <Input
              ref={setInputRef}
              value={q}
              placeholder={placeholder}
              className="h-full flex-1 border-0 bg-transparent pr-1 pl-2 text-[13px]! placeholder:text-muted-foreground/70 focus-visible:ring-0"
              onChange={(e) => {
                const next = e.target.value;
                setQ(next);
                applyIncremental(next);
              }}
              onBlur={() => {
                if (!q) setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "F3") {
                  e.preventDefault();
                  findDirection(!e.shiftKey);
                } else if (
                  (e.ctrlKey || e.metaKey) &&
                  (e.key === "g" || e.key === "G")
                ) {
                  e.preventDefault();
                  findDirection(!e.shiftKey);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  clearTarget();
                  setQ("");
                  setOpen(false);
                  restoreTargetFocus();
                }
              }}
            />
            {q && matchInfo && (
              <span className="shrink-0 px-1.5 text-[11px] font-mono text-muted-foreground select-none">
                {matchInfo.total > 0
                  ? `${matchInfo.current}/${matchInfo.total}`
                  : t("header.noMatches")}
              </span>
            )}
            {q && (
              <div className="flex shrink-0 items-center gap-0.5 border-l border-border/50 pl-1">
                <button
                  type="button"
                  disabled={matchInfo?.total === 0}
                  onClick={() => findDirection(false)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t("header.previousMatch")}
                  aria-label={t("header.previousMatch")}
                >
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    size={13}
                    strokeWidth={2}
                  />
                </button>
                <button
                  type="button"
                  disabled={matchInfo?.total === 0}
                  onClick={() => findDirection(true)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t("header.nextMatch")}
                  aria-label={t("header.nextMatch")}
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={13}
                    strokeWidth={2}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    clearTarget();
                    inputRef.current?.focus();
                  }}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title={t("header.clearSearch")}
                  aria-label={t("header.clearSearch")}
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={12}
                    strokeWidth={2}
                  />
                </button>
              </div>
            )}
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={focus}
            title={tooltipTitle}
            aria-label={tooltipTitle}
          >
            <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.75} />
          </Button>
        )}
      </div>
    );
  },
);
