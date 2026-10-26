import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Cancel01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { invoke } from "@tauri-apps/api/core";
import { isWindowsNativePath, workspaceForDocumentPath, type WorkspaceEnv } from "@/modules/workspace";
import { IS_WINDOWS } from "@/lib/platform";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { fileIconUrl } from "./lib/iconResolver";
import { copyToClipboard, revealInFinder } from "./lib/contextActions";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import { cn } from "@/lib/utils";

type SearchHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

type SearchResult = {
  hits: SearchHit[];
  truncated: boolean;
};

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;
let pendingSearches = 0;

type Props = {
  rootPath: string;
  workspace: WorkspaceEnv;
  onOpenFile: (path: string) => void;
  open: boolean;
  onRequestClose: () => void;
  onActiveChange?: (active: boolean) => void;
  onRevealInTerminal?: (path: string) => void;
  onOpenInSourceControl?: (path: string) => void;
  onOpenGitHistory?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
};

export type ExplorerSearchHandle = {
  focus: () => void;
  isFocused: () => boolean;
};

export const ExplorerSearch = forwardRef<ExplorerSearchHandle, Props>(function ExplorerSearch({
  rootPath,
  workspace,
  onOpenFile,
  open,
  onRequestClose,
  onActiveChange,
  onRevealInTerminal,
  onOpenInSourceControl,
  onOpenGitHistory,
  onAttachToAgent,
}: Props,
  ref,
) {
  const { t } = useTranslation();
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const filesystem = JSON.stringify(workspace);
  const owner = workspaceForDocumentPath(workspace, rootPath);
  const available = !rootPath.startsWith("remote://") &&
    (isWindowsNativePath(rootPath) ||
      (workspace.kind !== "docker" && workspace.kind !== "serial" &&
        (owner.kind === "local" || (owner.kind === "wsl" && IS_WINDOWS))));
  const [query, setQuery] = useState("");
  const searchOwner = useMemo(
    () => ({ rootPath, filesystem, showHidden, query, open, lifetime: { current: false } }),
    [rootPath, filesystem, showHidden, query, open],
  );
  useLayoutEffect(() => {
    const lifetime = { current: open && available };
    searchOwner.lifetime = lifetime;
    return () => {
      lifetime.current = false;
    };
  }, [searchOwner, open, available]);
  const [publication, setPublication] = useState<{
    owner: typeof searchOwner;
    lifetime: { current: boolean };
    result: SearchResult;
  } | null>(null);
  const resultLifetime =
    publication?.owner === searchOwner ? publication.lifetime : undefined;
  const results =
    publication && resultLifetime?.current ? publication.result.hits : [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const truncated = resultLifetime?.current && publication?.result.truncated;
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastKeyboardNavAt = useRef(0);

  const active = query.trim().length > 0;

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setPublication(null);
      setSelectedIndex(0);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    const { query, rootPath, showHidden, filesystem, open } = searchOwner;
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN || !available || !open) {
      setPublication(null);
      setSelectedIndex(0);
      setSearching(false);
      setFailed(false);
      return;
    }
    setSearching(true);
    setFailed(false);
    let alive = true;
    const lifetime = searchOwner.lifetime;
    const captured = workspaceForDocumentPath(JSON.parse(filesystem) as WorkspaceEnv, rootPath);
    const handle = setTimeout(async () => {
      if (pendingSearches >= 16) {
        if (alive && lifetime.current) {
          setFailed(true);
          setSearching(false);
        }
        return;
      }
      pendingSearches++;
      try {
        const res = await invoke<SearchResult>("fs_search", {
          root: rootPath,
          query: q,
          limit: 200,
          showHidden,
          workspace: captured,
        });
        if (alive && lifetime.current) {
          setPublication({ owner: searchOwner, lifetime, result: res });
          setSelectedIndex(0);
        }
      } catch {
        if (alive && lifetime.current) {
          setFailed(true);
          setPublication(null);
          setSelectedIndex(0);
        }
      } finally {
        pendingSearches--;
        if (alive && lifetime.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [available, searchOwner]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      },
      isFocused: () => document.activeElement === inputRef.current,
    }),
    [],
  );

  useEffect(() => {
    if (active && results.length > 0) {
      const el = scrollRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, results, active]);

  const handleSelect = (hit: SearchHit) => {
    if (resultLifetime?.current && !hit.is_dir) {
      onOpenFile(hit.path);
    }
  };

  return (
    <div className={cn("flex flex-col", active && "min-h-0 flex-1")}>
      {open ? (
        <div className="relative shrink-0 px-2 py-1.5 animate-in fade-in-0 slide-in-from-top-3 duration-200 ease-out">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={2}
            className="absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onRequestClose();
                return;
              }
              if (results.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  lastKeyboardNavAt.current = Date.now();
                  setSelectedIndex((prev) => (prev + 1) % results.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  lastKeyboardNavAt.current = Date.now();
                  setSelectedIndex(
                    (prev) => (prev - 1 + results.length) % results.length,
                  );
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  handleSelect(results[selectedIndex]);
                }
              }
            }}
            placeholder={t("explorer.searchPlaceholder")}
            className="h-7 pr-7 pl-6.5 text-xs"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-3.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("explorer.clearSearch")}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}

      {active ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="py-1" ref={scrollRef}>
            {!available || failed ? (
              <div role="status" className="px-3 py-2 text-[11px] text-muted-foreground">
                {t(!available ? "git.unsupportedFilesystem" : "feedback.somethingWentWrong")}
              </div>
            ) : searching && results.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                {t("explorer.searching")}
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                {t("explorer.noMatches")}
              </div>
            ) : (
              results.map((hit, index) => {
                const url = hit.is_dir ? null : fileIconUrl(hit.name);
                const isSelected = index === selectedIndex;
                return (
                  <ContextMenu key={hit.path}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        data-index={index}
                        onClick={() => handleSelect(hit)}
                        onMouseEnter={() => {
                          if (Date.now() - lastKeyboardNavAt.current > 250) {
                            setSelectedIndex(index);
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors",
                          isSelected ? "bg-accent text-foreground" : "hover:bg-accent/50 text-foreground/80"
                        )}
                        title={hit.path}
                      >
                        {url ? (
                          <img src={url} alt="" className="size-3.5 shrink-0" />
                        ) : (
                          <HugeiconsIcon
                            icon={Folder01Icon}
                            size={13}
                            strokeWidth={1.75}
                            className="shrink-0 text-muted-foreground"
                          />
                        )}
                        <span className="truncate">{hit.name}</span>
                        <span className="ml-auto truncate text-[10px] text-muted-foreground">
                          {hit.rel}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className={COMPACT_CONTENT}>
                      {!hit.is_dir && (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => { if (resultLifetime?.current) onOpenFile(hit.path); }}
                        >
                          {t("explorer.open")}
                        </ContextMenuItem>
                      )}
                      {hit.is_dir && onRevealInTerminal && (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => { if (resultLifetime?.current) onRevealInTerminal(hit.path); }}
                        >
                          {t("explorer.openInTerminal")}
                        </ContextMenuItem>
                      )}
                      {hit.is_dir && onOpenInSourceControl && (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => { if (resultLifetime?.current) onOpenInSourceControl(hit.path); }}
                        >
                          {t("explorer.openInSourceControl")}
                        </ContextMenuItem>
                      )}
                      {hit.is_dir && onOpenGitHistory && (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => { if (resultLifetime?.current) onOpenGitHistory(hit.path); }}
                        >
                          {t("explorer.openGitHistory")}
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => { if (resultLifetime?.current) void revealInFinder(hit.path); }}
                      >
                        {t("explorer.revealInFinder")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => { if (resultLifetime?.current) void copyToClipboard(hit.path); }}
                      >
                        {t("explorer.copyPath")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => { if (resultLifetime?.current) onAttachToAgent?.(hit.path); }}
                      >
                        {t("explorer.attachToAgent")}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            )}
            {truncated && results.length > 0 ? (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
                {t("explorer.partialResults")}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
});
