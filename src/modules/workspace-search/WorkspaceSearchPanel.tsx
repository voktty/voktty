import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useWorkspaceSearch } from "@/modules/workspace-search/hooks/useWorkspaceSearch";
import {
  DEFAULT_WORKSPACE_SEARCH_OPTIONS,
  WORKSPACE_SEARCH_MIN_QUERY,
} from "@/modules/workspace-search/lib/query";
import {
  groupWorkspaceSearchHits,
  splitSearchHitText,
  workspaceSearchHitKey,
} from "@/modules/workspace-search/lib/results";
import {
  normalizeWorkspacePath,
  workspaceReplaceSpec,
  workspaceReplaceTargets,
} from "@/modules/workspace-search/lib/replace";
import {
  applyWorkspaceReplace,
  previewWorkspaceReplace,
} from "@/modules/workspace-search/lib/service";
import type {
  WorkspaceReplacePreview,
  WorkspaceSearchHit,
  WorkspaceSearchOptions,
} from "@/modules/workspace-search/types";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Edit02Icon,
  FilterIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  active: boolean;
  root: string | null;
  workspace: WorkspaceEnv;
  focusRequest: number;
  dirtyPaths: string[];
  onOpenHit: (hit: WorkspaceSearchHit, pin: boolean) => void;
};

const MATCH_CASE_SYMBOL = "Aa";
const WHOLE_WORD_SYMBOL = "ab";
const REGEX_SYMBOL = ".*";

export function WorkspaceSearchPanel({
  active,
  root,
  workspace,
  focusRequest,
  dirtyPaths,
  onOpenHit,
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<WorkspaceSearchOptions>(
    DEFAULT_WORKSPACE_SEARCH_OPTIONS,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replacePreview, setReplacePreview] =
    useState<WorkspaceReplacePreview | null>(null);
  const [selectedReplaceFiles, setSelectedReplaceFiles] = useState<Set<string>>(
    () => new Set(),
  );
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceMessage, setReplaceMessage] = useState<string | null>(null);
  const search = useWorkspaceSearch(root, workspace, options, active);
  const groups = useMemo(
    () => groupWorkspaceSearchHits(search.hits),
    [search.hits],
  );
  const dirtyPathSet = useMemo(
    () => new Set(dirtyPaths.map(normalizeWorkspacePath)),
    [dirtyPaths],
  );
  const dirtySearchFiles = useMemo(
    () =>
      groups.filter((group) => dirtyPathSet.has(normalizeWorkspacePath(group.path))),
    [dirtyPathSet, groups],
  );

  useEffect(() => {
    setReplacePreview(null);
    setSelectedReplaceFiles(new Set());
    setReplaceError(null);
    setReplaceMessage(null);
  }, [dirtyPaths, options, replacement, root, workspace]);

  useEffect(() => {
    if (!active || focusRequest === 0) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [active, focusRequest]);

  const updateOption = <Key extends keyof WorkspaceSearchOptions>(
    key: Key,
    value: WorkspaceSearchOptions[Key],
  ) => setOptions((current) => ({ ...current, [key]: value }));

  const toggleCollapsed = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const createReplacePreview = async () => {
    if (!root || search.truncated || dirtySearchFiles.length > 0) return;
    setReplaceBusy(true);
    setReplaceError(null);
    setReplaceMessage(null);
    try {
      const preview = await previewWorkspaceReplace(
        root,
        workspace,
        workspaceReplaceSpec(options, replacement),
        groups.map((group) => group.rel),
      );
      if (preview.files.length === 0) {
        setReplaceError(t("workspaceSearch.status.noMatches"));
        return;
      }
      setReplacePreview(preview);
      setSelectedReplaceFiles(new Set(preview.files.map((file) => file.path)));
    } catch (error) {
      setReplaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplaceBusy(false);
    }
  };

  const applyReplacePreview = async () => {
    if (!root || !replacePreview) return;
    if (dirtySearchFiles.length > 0) {
      setReplaceError(
        t("workspaceSearch.replace.dirtyBlocked", {
          count: dirtySearchFiles.length,
        }),
      );
      return;
    }
    const targets = workspaceReplaceTargets(
      replacePreview.files,
      selectedReplaceFiles,
    );
    if (targets.length === 0) return;
    setReplaceBusy(true);
    setReplaceError(null);
    try {
      const outcome = await applyWorkspaceReplace(
        root,
        workspace,
        workspaceReplaceSpec(options, replacement),
        targets,
      );
      if (outcome.status === "applied") {
        setReplaceMessage(
          t("workspaceSearch.replace.applied", {
            replacements: outcome.replacements,
            files: outcome.files,
          }),
        );
        setReplacePreview(null);
        setSelectedReplaceFiles(new Set());
        search.searchNow();
      } else if (outcome.status === "conflict") {
        setReplaceError(
          t("workspaceSearch.replace.conflict", {
            count: outcome.conflicts.length,
          }),
        );
      } else {
        setReplaceError(
          outcome.rollbackFailures.length > 0
            ? t("workspaceSearch.replace.rollbackFailed", {
                count: outcome.rollbackFailures.length,
              })
            : outcome.error,
        );
      }
    } catch (error) {
      setReplaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplaceBusy(false);
    }
  };

  const status = !root
    ? t("workspaceSearch.status.noWorkspace")
    : !search.supported
      ? t("workspaceSearch.status.unsupported")
      : options.query.trim().length < WORKSPACE_SEARCH_MIN_QUERY
        ? t("workspaceSearch.status.enterQuery")
        : search.error
          ? t("workspaceSearch.status.failed")
          : search.loading && search.hits.length === 0
            ? t("workspaceSearch.status.searching")
            : search.hits.length === 0
              ? t("workspaceSearch.status.noMatches")
              : null;

  return (
    <section
      aria-label={t("workspaceSearch.title")}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="shrink-0 border-b border-border/50 p-2">
        <div className="relative flex items-center">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={2}
            className="pointer-events-none absolute left-2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={options.query}
            onChange={(event) => updateOption("query", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") search.searchNow();
              if (event.key === "Escape" && options.query) {
                event.preventDefault();
                updateOption("query", "");
              }
            }}
            aria-label={t("workspaceSearch.queryLabel")}
            placeholder={t("workspaceSearch.queryPlaceholder")}
            className="h-8 pr-[9.25rem] pl-7 text-xs"
            spellCheck={false}
          />
          <div className="absolute right-1 flex items-center gap-0.5">
            <SearchToggle
              label={t("workspaceSearch.matchCase")}
              pressed={options.caseSensitive}
              onPressedChange={(pressed) =>
                updateOption("caseSensitive", pressed)
              }
            >
              {MATCH_CASE_SYMBOL}
            </SearchToggle>
            <SearchToggle
              label={t("workspaceSearch.wholeWord")}
              pressed={options.wholeWord}
              onPressedChange={(pressed) => updateOption("wholeWord", pressed)}
            >
              {WHOLE_WORD_SYMBOL}
            </SearchToggle>
            <SearchToggle
              label={t("workspaceSearch.regex")}
              pressed={options.regex}
              onPressedChange={(pressed) => updateOption("regex", pressed)}
            >
              {REGEX_SYMBOL}
            </SearchToggle>
            {options.query ? (
              <button
                type="button"
                onClick={() => updateOption("query", "")}
                aria-label={t("workspaceSearch.clear")}
                title={t("workspaceSearch.clear")}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={t("workspaceSearch.replace.toggle")}
              aria-pressed={replaceOpen}
              title={t("workspaceSearch.replace.toggle")}
              onClick={() => {
                setReplaceOpen((open) => !open);
                setReplacePreview(null);
              }}
              className={cn(
                "flex size-6 items-center justify-center rounded",
                replaceOpen
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={Edit02Icon} size={11} strokeWidth={2} />
            </button>
          </div>
        </div>

        {replaceOpen ? (
          <div className="mt-1.5 flex gap-1.5">
            <Input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              aria-label={t("workspaceSearch.replace.label")}
              placeholder={t("workspaceSearch.replace.placeholder")}
              className="h-7 min-w-0 flex-1 font-mono text-[10.5px]"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void createReplacePreview()}
              disabled={
                replaceBusy ||
                search.loading ||
                search.truncated ||
                groups.length === 0 ||
                dirtySearchFiles.length > 0
              }
              className="h-7 shrink-0 rounded border border-border px-2 text-[10.5px] text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {replaceBusy
                ? t("workspaceSearch.replace.preparing")
                : t("workspaceSearch.replace.preview")}
            </button>
          </div>
        ) : null}

        <button
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
          className="mt-1.5 flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={FilterIcon} size={12} strokeWidth={1.75} />
          <span>{t("workspaceSearch.filters")}</span>
          <HugeiconsIcon
            icon={filtersOpen ? ArrowDown01Icon : ArrowRight01Icon}
            size={10}
            strokeWidth={2}
          />
        </button>

        {filtersOpen ? (
          <div className="mt-1.5 grid gap-1.5">
            <label
              htmlFor="workspace-search-include"
              className="grid gap-1 text-[10.5px] text-muted-foreground"
            >
              <span>{t("workspaceSearch.includeLabel")}</span>
              <Input
                id="workspace-search-include"
                value={options.include}
                onChange={(event) =>
                  updateOption("include", event.target.value)
                }
                placeholder={t("workspaceSearch.includePlaceholder")}
                className="h-7 font-mono text-[10.5px]"
                spellCheck={false}
              />
            </label>
            <label
              htmlFor="workspace-search-exclude"
              className="grid gap-1 text-[10.5px] text-muted-foreground"
            >
              <span>{t("workspaceSearch.excludeLabel")}</span>
              <Input
                id="workspace-search-exclude"
                value={options.exclude}
                onChange={(event) =>
                  updateOption("exclude", event.target.value)
                }
                placeholder={t("workspaceSearch.excludePlaceholder")}
                className="h-7 font-mono text-[10.5px]"
                spellCheck={false}
              />
            </label>
          </div>
        ) : null}
      </div>

      {replaceOpen && dirtySearchFiles.length > 0 ? (
        <div className="shrink-0 border-b border-warning/20 bg-warning/5 px-2 py-1.5 text-[10px] text-warning">
          {t("workspaceSearch.replace.dirtyBlocked", {
            count: dirtySearchFiles.length,
          })}
        </div>
      ) : null}
      {replaceOpen && search.truncated ? (
        <div className="shrink-0 border-b border-warning/20 bg-warning/5 px-2 py-1.5 text-[10px] text-warning">
          {t("workspaceSearch.replace.truncatedBlocked")}
        </div>
      ) : null}
      {replaceError ? (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[10px] text-destructive">
          {replaceError}
        </div>
      ) : null}
      {replaceMessage ? (
        <div className="shrink-0 border-b border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
          {replaceMessage}
        </div>
      ) : null}

      {replacePreview ? (
        <ReplacePreviewList
          preview={replacePreview}
          selected={selectedReplaceFiles}
          busy={replaceBusy}
          onToggle={(path) =>
            setSelectedReplaceFiles((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            })
          }
          onCancel={() => setReplacePreview(null)}
          onApply={() => void applyReplacePreview()}
        />
      ) : status ? (
        <SearchStatus
          label={status}
          error={Boolean(search.error)}
          detail={search.error}
          onRetry={search.error ? search.retry : undefined}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="py-1">
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.path);
              return (
                <div key={group.path}>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapsed(group.path)}
                    className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-[11.5px] hover:bg-accent/60"
                    title={group.path}
                  >
                    <HugeiconsIcon
                      icon={isCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
                      size={10}
                      strokeWidth={2}
                      className="shrink-0 text-muted-foreground"
                    />
                    <img
                      src={fileIconUrl(basename(group.rel))}
                      alt=""
                      className="size-3.5 shrink-0"
                    />
                    <span className="truncate font-medium">
                      {basename(group.rel)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[9.5px] text-muted-foreground">
                      {dirname(group.rel)}
                    </span>
                    <span className="shrink-0 tabular-nums text-[9.5px] text-muted-foreground">
                      {group.hits.length}
                    </span>
                  </button>
                  {!isCollapsed
                    ? group.hits.map((hit) => (
                        <SearchResult
                          key={workspaceSearchHitKey(hit)}
                          hit={hit}
                          onOpen={onOpenHit}
                        />
                      ))
                    : null}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border/50 px-2 text-[9.5px] text-muted-foreground">
        <span className="truncate">
          {search.hits.length > 0
            ? t("workspaceSearch.summary", {
                matches: search.hits.length,
                files: groups.length,
              })
            : t("workspaceSearch.title")}
        </span>
        <span className="shrink-0 tabular-nums">
          {search.loading
            ? t("workspaceSearch.status.searching")
            : t("workspaceSearch.filesScanned", {
                count: search.filesScanned,
              })}
        </span>
        {search.truncated ? (
          <span className="shrink-0 text-warning">
            {t("workspaceSearch.partial")}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function ReplacePreviewList({
  preview,
  selected,
  busy,
  onToggle,
  onCancel,
  onApply,
}: {
  preview: WorkspaceReplacePreview;
  selected: ReadonlySet<string>;
  busy: boolean;
  onToggle: (path: string) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const selectedFiles = preview.files.filter((file) => selected.has(file.path));
  const selectedReplacements = selectedFiles.reduce(
    (total, file) => total + file.replacements,
    0,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1">
          {preview.files.map((file) => (
            <div key={file.path} className="border-b border-border/30 last:border-0">
              <label className="flex min-h-7 items-center gap-1.5 px-2 text-[11px] hover:bg-accent/50">
                <Checkbox
                  checked={selected.has(file.path)}
                  onCheckedChange={() => onToggle(file.path)}
                  aria-label={t("workspaceSearch.replace.selectFile", {
                    file: file.path,
                  })}
                  className="size-3.5"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {file.path}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {file.replacements}
                </span>
              </label>
              {file.occurrences.slice(0, 20).map((occurrence, index) => (
                <div
                  key={`${file.path}:${occurrence.line}:${occurrence.column}:${index}`}
                  className="flex gap-1.5 py-1 pr-2 pl-8 font-mono text-[9.5px]"
                >
                  <span className="w-7 shrink-0 text-right text-muted-foreground">
                    {occurrence.line}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {occurrence.before}
                    <del className="bg-destructive/15 text-destructive no-underline">
                      {occurrence.matched}
                    </del>
                    <ins className="bg-emerald-500/15 text-emerald-600 no-underline dark:text-emerald-400">
                      {occurrence.replacement}
                    </ins>
                    {occurrence.after}
                  </span>
                </div>
              ))}
              {file.previewTruncated || file.occurrences.length > 20 ? (
                <div className="px-8 pb-1 text-[9px] text-muted-foreground">
                  {t("workspaceSearch.replace.moreOccurrences")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/50 p-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-7 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={busy || selectedFiles.length === 0}
          className="h-7 rounded bg-primary px-2 text-[10.5px] text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? t("workspaceSearch.replace.applying")
            : t("workspaceSearch.replace.confirm", {
                replacements: selectedReplacements,
                files: selectedFiles.length,
              })}
        </button>
      </div>
    </div>
  );
}

function SearchToggle({
  label,
  pressed,
  onPressedChange,
  children,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "flex h-6 min-w-6 items-center justify-center rounded px-1 font-mono text-[10px] font-semibold",
        pressed
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SearchResult({
  hit,
  onOpen,
}: {
  hit: WorkspaceSearchHit;
  onOpen: (hit: WorkspaceSearchHit, pin: boolean) => void;
}) {
  const parts = splitSearchHitText(hit);
  return (
    <button
      type="button"
      onClick={(event) => onOpen(hit, event.ctrlKey || event.metaKey)}
      onDoubleClick={() => onOpen(hit, true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onOpen(hit, true);
        }
      }}
      className="group flex w-full items-start gap-1.5 py-1 pr-2 pl-7 text-left hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
      title={`${hit.path}:${hit.line}:${hit.column}`}
    >
      <span className="w-8 shrink-0 pt-px text-right font-mono text-[9.5px] tabular-nums text-muted-foreground/80">
        {hit.line}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground/80">
        {parts.before}
        <mark className="rounded-sm bg-warning/25 px-px text-foreground">
          {parts.match}
        </mark>
        {parts.after}
      </span>
    </button>
  );
}

function SearchStatus({
  label,
  error,
  detail,
  onRetry,
}: {
  label: string;
  error: boolean;
  detail?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-muted-foreground">
      <HugeiconsIcon
        icon={Search01Icon}
        size={18}
        strokeWidth={1.5}
        className={error ? "text-destructive" : "opacity-70"}
      />
      <span className={error ? "text-destructive" : undefined}>{label}</span>
      {detail ? (
        <span className="max-w-full break-words font-mono text-[9.5px] text-muted-foreground">
          {detail}
        </span>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-border px-2 py-1 text-foreground hover:bg-accent"
        >
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/") || ".";
}
