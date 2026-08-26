import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { accentFor } from "@/modules/spaces/lib/spaceColor";
import type { SpaceMeta } from "@/modules/spaces/lib/store";
import {
  Cancel01Icon,
  CommandIcon,
  ComputerTerminal02Icon,
  Globe02Icon,
  PencilEdit02Icon,
  Search01Icon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { labelFor } from "./lib/tabLabel";
import type { EditorTab, Tab } from "./lib/useTabs";
import { TabIcon, TabProcessBadge, TabProcessBottomBar } from "./TabBar";

type FilterCategory = "all" | "terminal" | "editor" | "preview" | "git";

export type ActiveTabsLaunchpadProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: Tab[];
  activeTabId: number;
  activeSpaceId: string | null;
  spaces: SpaceMeta[];
  onSelectTab: (tab: Tab) => void;
  onCloseTab: (id: number) => void;
};

function tabSubtitle(tab: Tab): string | null {
  if (tab.kind === "terminal") {
    if (!tab.cwd) return null;
    const parts = tab.cwd.split(/[\\/]/).filter(Boolean);
    return parts.slice(-2).join("/") || tab.cwd;
  }
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const parts = tab.path.split(/[\\/]/).filter(Boolean);
    return parts.length > 1 ? parts.slice(-3).join("/") : tab.path;
  }
  if (tab.kind === "preview") {
    return tab.url || "about:blank";
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return tab.path || tab.repoRoot || null;
  }
  if (tab.kind === "git-history") {
    return tab.repoRoot || null;
  }
  if (tab.kind === "ai-diff") {
    return tab.path || null;
  }
  return null;
}

export function ActiveTabsLaunchpad({
  open,
  onOpenChange,
  tabs,
  activeTabId,
  activeSpaceId,
  spaces,
  onSelectTab,
  onCloseTab,
}: ActiveTabsLaunchpadProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FilterCategory>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const spacesById = useMemo(
    () => new Map(spaces.map((s) => [s.id, s])),
    [spaces],
  );

  // Filter tabs by category and search query
  const filteredTabs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabs.filter((tab) => {
      if (category === "terminal" && tab.kind !== "terminal") return false;
      if (
        category === "editor" &&
        tab.kind !== "editor" &&
        tab.kind !== "markdown"
      )
        return false;
      if (category === "preview" && tab.kind !== "preview") return false;
      if (
        category === "git" &&
        tab.kind !== "git-diff" &&
        tab.kind !== "git-commit-file" &&
        tab.kind !== "git-history"
      )
        return false;

      if (!q) return true;

      const title = labelFor(tab).toLowerCase();
      const subtitle = (tabSubtitle(tab) || "").toLowerCase();
      const space = (spacesById.get(tab.spaceId)?.name || "").toLowerCase();
      const kind = tab.kind.toLowerCase();

      return (
        title.includes(q) ||
        subtitle.includes(q) ||
        space.includes(q) ||
        kind.includes(q)
      );
    });
  }, [tabs, category, query, spacesById]);

  // Group filtered tabs by Space
  const groupedTabs = useMemo(() => {
    const map = new Map<string, Tab[]>();
    for (const tab of filteredTabs) {
      const list = map.get(tab.spaceId) ?? [];
      list.push(tab);
      map.set(tab.spaceId, list);
    }
    return map;
  }, [filteredTabs]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setCategory("all");
      const currentIdx = tabs.findIndex((t) => t.id === activeTabId);
      setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, activeTabId, tabs]);

  // Keep selected index in bounds when filtering
  useEffect(() => {
    if (selectedIndex >= filteredTabs.length) {
      setSelectedIndex(Math.max(0, filteredTabs.length - 1));
    }
  }, [filteredTabs.length, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    const activeTab = filteredTabs[selectedIndex];
    if (activeTab) {
      const el = itemRefs.current.get(activeTab.id);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex, filteredTabs]);

  const handleCommit = useCallback(
    (tab: Tab) => {
      onSelectTab(tab);
      onOpenChange(false);
    },
    [onSelectTab, onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filteredTabs.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          onOpenChange(false);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredTabs.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredTabs.length) % filteredTabs.length,
        );
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = filteredTabs[selectedIndex];
        if (chosen) handleCommit(chosen);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }

      if ((e.shiftKey && e.key === "Delete") || (e.altKey && e.key.toLowerCase() === "w")) {
        e.preventDefault();
        const current = filteredTabs[selectedIndex];
        if (current) {
          onCloseTab(current.id);
        }
        return;
      }

      if (e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const targetIdx = parseInt(e.key, 10) - 1;
        if (targetIdx < filteredTabs.length) {
          handleCommit(filteredTabs[targetIdx]);
        }
      }
    },
    [filteredTabs, selectedIndex, handleCommit, onOpenChange, onCloseTab],
  );

  const categoryCounts = useMemo(() => {
    return {
      all: tabs.length,
      terminal: tabs.filter((t) => t.kind === "terminal").length,
      editor: tabs.filter((t) => t.kind === "editor" || t.kind === "markdown").length,
      preview: tabs.filter((t) => t.kind === "preview").length,
      git: tabs.filter(
        (t) =>
          t.kind === "git-diff" ||
          t.kind === "git-commit-file" ||
          t.kind === "git-history",
      ).length,
    };
  }, [tabs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-20 left-1/2 -translate-x-1/2 translate-y-0 z-50 flex max-h-[75vh] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border border-white/10 bg-popover/95 p-0 text-popover-foreground shadow-2xl backdrop-blur-2xl ring-1 ring-white/10 dark:border-white/10"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">
          {t("activeTabs.title")}
        </DialogTitle>

        {/* Top Search & Filter Bar */}
        <div className="flex flex-col border-b border-border/40 p-3 pb-2.5">
          <div className="flex items-center gap-2.5 px-2">
            <HugeiconsIcon
              icon={Search01Icon}
              size={18}
              className="shrink-0 text-muted-foreground"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder={t("activeTabs.placeholder")}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} />
              </button>
            )}
            <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground/80 bg-accent/60 px-2 py-0.5 rounded-full border border-border/30">
              <HugeiconsIcon icon={CommandIcon} size={11} />
              <span>{filteredTabs.length} / {tabs.length}</span>
            </div>
          </div>

          {/* Quick Filter Categories */}
          <div className="mt-2.5 flex items-center gap-1.5 px-1 overflow-x-auto text-[11px]">
            <button
              type="button"
              onClick={() => {
                setCategory("all");
                setSelectedIndex(0);
              }}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer",
                category === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-accent/40 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span>{t("activeTabs.all")}</span>
              <span className="opacity-70">({categoryCounts.all})</span>
            </button>

            {categoryCounts.terminal > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCategory("terminal");
                  setSelectedIndex(0);
                }}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer",
                  category === "terminal"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-accent/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={ComputerTerminal02Icon} size={12} />
                <span>{t("activeTabs.terminals")}</span>
                <span className="opacity-70">({categoryCounts.terminal})</span>
              </button>
            )}

            {categoryCounts.editor > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCategory("editor");
                  setSelectedIndex(0);
                }}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer",
                  category === "editor"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-accent/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={PencilEdit02Icon} size={12} />
                <span>{t("activeTabs.editors")}</span>
                <span className="opacity-70">({categoryCounts.editor})</span>
              </button>
            )}

            {categoryCounts.preview > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCategory("preview");
                  setSelectedIndex(0);
                }}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer",
                  category === "preview"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-accent/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={Globe02Icon} size={12} />
                <span>{t("activeTabs.previews")}</span>
                <span className="opacity-70">({categoryCounts.preview})</span>
              </button>
            )}
          </div>
        </div>

        {/* Tabs List / Grid */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2.5 space-y-3 max-h-[50vh]"
        >
          {filteredTabs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <HugeiconsIcon
                icon={ComputerTerminal02Icon}
                size={32}
                className="opacity-30 mb-2"
              />
              <p className="text-sm font-medium">
                {t("activeTabs.noTabs")}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {t("activeTabs.tryAnotherQuery")}
              </p>
            </div>
          ) : (
            Array.from(groupedTabs.entries()).map(([spaceId, spaceTabsList]) => {
              const space = spacesById.get(spaceId);
              const spaceColor = space ? accentFor(space) : "var(--primary)";

              return (
                <div key={spaceId} className="space-y-1.5">
                  {/* Space Header Badge */}
                  <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: spaceColor }}
                    />
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {space?.name || t("spaces.title")}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      ({spaceTabsList.length})
                    </span>
                  </div>

                  {/* Tab Cards for this space */}
                  <div className="grid grid-cols-1 gap-1">
                    {spaceTabsList.map((tab) => {
                      const globalIdx = filteredTabs.indexOf(tab);
                      const isSelected = globalIdx === selectedIndex;
                      const isActiveTab =
                        tab.id === activeTabId && tab.spaceId === activeSpaceId;
                      const subtitle = tabSubtitle(tab);
                      const isDirty =
                        (tab.kind === "editor" || tab.kind === "markdown") &&
                        (tab as EditorTab).dirty;

                      return (
                        <div
                          key={tab.id}
                          ref={(el) => {
                            if (el) itemRefs.current.set(tab.id, el);
                            else itemRefs.current.delete(tab.id);
                          }}
                          onClick={() => handleCommit(tab)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          style={
                            tab.color
                              ? {
                                  borderColor: `${tab.color}45`,
                                  backgroundColor: `${tab.color}10`,
                                }
                              : undefined
                          }
                          className={cn(
                            "group relative flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs transition-all cursor-pointer select-none border",
                            isSelected
                              ? "bg-accent text-accent-foreground shadow-sm ring-1 ring-primary/25"
                              : "border-transparent hover:bg-accent/50 text-foreground/90",
                          )}
                        >
                          {/* Left: Icon & Info */}
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <div
                              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background/60 border border-border/40 shadow-xs"
                              style={
                                tab.color
                                  ? {
                                      borderColor: `${tab.color}60`,
                                      backgroundColor: `${tab.color}18`,
                                    }
                                  : undefined
                              }
                            >
                              <TabIcon tab={tab} />
                            </div>

                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex items-center gap-2">
                                {tab.color && (
                                  <span
                                    className="size-2 shrink-0 rounded-full shadow-xs ring-1 ring-background"
                                    style={{ backgroundColor: tab.color }}
                                  />
                                )}
                                <span className="truncate font-medium text-foreground">
                                  {labelFor(tab)}
                                </span>
                                <TabProcessBadge tab={tab} />

                                {isActiveTab && (
                                  <span className="shrink-0 flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-600 dark:text-emerald-400">
                                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    {t("activeTabs.activeBadge")}
                                  </span>
                                )}

                                {isDirty && (
                                  <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-600 dark:text-amber-400">
                                    {t("activeTabs.dirtyBadge")}
                                  </span>
                                )}
                              </div>

                              {subtitle && (
                                <span className="truncate text-[10.5px] text-muted-foreground/75 font-mono">
                                  {subtitle}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Right: Badges, Shortcut Jump & Actions */}
                          <div className="flex shrink-0 items-center gap-2">
                            {/* Space Tag Pill */}
                            <span
                              className="rounded-md px-2 py-0.5 text-[10px] font-medium border border-border/40"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${spaceColor} 12%, transparent)`,
                                color: spaceColor,
                              }}
                            >
                              {space?.name || t("spaces.title")}
                            </span>

                            {/* Alt+1..9 shortcut tag */}
                            {globalIdx < 9 && (
                              <kbd className="hidden sm:inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9.5px] font-mono font-medium text-muted-foreground/70 bg-background/80 border border-border/50 shadow-2xs">
                                Alt+{globalIdx + 1}
                              </kbd>
                            )}

                            {/* Close Button / Lock indicator */}
                            {tab.locked ? (
                              <span
                                title={t("tabs.tabIsLocked")}
                                className="p-1 text-muted-foreground/75"
                              >
                                <HugeiconsIcon
                                  icon={SquareLock01Icon}
                                  size={14}
                                />
                              </span>
                            ) : (
                              <button
                                type="button"
                                  title={t("common.close")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCloseTab(tab.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 rounded-md p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-all"
                              >
                                <HugeiconsIcon icon={Cancel01Icon} size={14} />
                              </button>
                            )}
                          </div>
                          <TabProcessBottomBar tab={tab} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer / Helper Bar */}
        <div className="flex items-center justify-between border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground bg-accent/20">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-background px-1 py-0.5 text-[10px] font-mono border border-border/50">↑↓</kbd>
              <span>{t("activeTabs.navigate")}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-background px-1 py-0.5 text-[10px] font-mono border border-border/50">↵</kbd>
              <span>{t("activeTabs.switch")}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-background px-1 py-0.5 text-[10px] font-mono border border-border/50">Shift+Del</kbd>
              <span>{t("activeTabs.closeTab")}</span>
            </span>
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            <kbd className="rounded bg-background px-1 py-0.5 font-mono border border-border/50">Esc</kbd>
            <span>{t("common.close")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
