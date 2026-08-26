import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MOD_KEY } from "@/lib/platform";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useTranslation } from "@/modules/i18n";
import { type WorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";
import {
  AlertCircleIcon,
  Clock01Icon,
  CloudIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuickOpenFiles } from "./hooks/useQuickOpenFiles";
import {
  quickOpenScope,
  rankQuickOpenFiles,
  resolveQuickOpenPath,
  type QuickOpenMatch,
} from "./lib/quickOpen";
import { recentQuickOpenFiles, recordQuickOpenFile } from "./lib/recentFiles";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceRoot: string | null;
  workspace: WorkspaceEnv;
  onOpenFile: (path: string, pin: boolean) => void;
};

export function QuickOpenDialog({
  open,
  onOpenChange,
  workspaceRoot,
  workspace,
  onOpenFile,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const index = useQuickOpenFiles(workspaceRoot, workspace, open);
  const supported = workspace.kind !== "serial" && workspace.kind !== "docker";
  const scope = workspaceRoot
    ? quickOpenScope(workspaceRoot, workspaceScopeKey(workspace))
    : null;
  const recentFiles = useMemo(
    () => (open && scope ? recentQuickOpenFiles(scope) : []),
    [open, scope],
  );
  const matches = useMemo(
    () => rankQuickOpenFiles(index.files, query, recentFiles),
    [index.files, query, recentFiles],
  );
  const recentMatches = query ? [] : matches.filter((match) => match.recent);
  const otherMatches = query
    ? matches
    : matches.filter((match) => !match.recent);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setValue("");
      return;
    }
    setValue(matches[0] ? itemValue(matches[0]) : "");
  }, [matches, open]);

  const commit = useCallback(
    (match: QuickOpenMatch, pin: boolean) => {
      if (!workspaceRoot) return;
      if (scope) recordQuickOpenFile(scope, match.rel);
      const path = resolveQuickOpenPath(workspaceRoot, match.rel);
      onOpenChange(false);
      window.setTimeout(() => onOpenFile(path, pin), 0);
    },
    [onOpenChange, onOpenFile, scope, workspaceRoot],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
      const selected = matches.find((match) => itemValue(match) === value);
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      commit(selected, true);
    },
    [commit, matches, value],
  );

  const status = !workspaceRoot
    ? t("quickOpen.status.noWorkspace")
    : !supported
      ? t("quickOpen.status.unsupportedWorkspace")
      : index.error
        ? t("quickOpen.status.failed")
        : index.loading && index.files.length === 0
          ? t("quickOpen.status.indexing")
          : matches.length === 0
            ? t("quickOpen.status.noMatches")
            : null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("quickOpen.title")}
      description={t("quickOpen.description")}
      className="top-1/3 w-[min(680px,calc(100vw-32px))] translate-y-0"
    >
      <Command
        shouldFilter={false}
        loop
        value={value}
        onValueChange={setValue}
        onKeyDown={handleKeyDown}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("quickOpen.placeholder")}
          autoFocus
        />
        <ScrollArea className="max-h-[420px]">
          <CommandList className="max-h-none overflow-visible pr-3">
            {status ? (
              <QuickOpenStatus
                label={status}
                error={Boolean(index.error)}
                onRetry={index.error ? index.retry : undefined}
              />
            ) : (
              <>
                {recentMatches.length > 0 ? (
                  <QuickOpenGroup
                    heading={t("quickOpen.groups.recent")}
                    matches={recentMatches}
                    remote={workspace.kind === "ssh"}
                    onOpen={commit}
                  />
                ) : null}
                {otherMatches.length > 0 ? (
                  <QuickOpenGroup
                    heading={
                      query
                        ? t("quickOpen.groups.matches")
                        : t("quickOpen.groups.files")
                    }
                    matches={otherMatches}
                    remote={workspace.kind === "ssh"}
                    onOpen={commit}
                  />
                ) : null}
              </>
            )}
          </CommandList>
        </ScrollArea>
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2 text-[10.5px] text-muted-foreground">
          <span>{t("quickOpen.footer.open")}</span>
          <span>
            {t("quickOpen.footer.pin", { shortcut: `${MOD_KEY}+Enter` })}
          </span>
          {index.truncated ? (
            <span>{t("quickOpen.footer.truncated")}</span>
          ) : null}
        </div>
      </Command>
    </CommandDialog>
  );
}

function QuickOpenGroup({
  heading,
  matches,
  remote,
  onOpen,
}: {
  heading: string;
  matches: QuickOpenMatch[];
  remote: boolean;
  onOpen: (match: QuickOpenMatch, pin: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <CommandGroup heading={heading}>
      {matches.map((match) => (
        <CommandItem
          key={match.rel}
          value={itemValue(match)}
          onSelect={() => onOpen(match, false)}
          className="text-[12.5px]"
        >
          <img
            src={fileIconUrl(match.name)}
            alt=""
            className="size-4 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {match.name}
          </span>
          <span className="max-w-[55%] truncate font-mono text-[10.5px] font-normal text-muted-foreground">
            {match.directory || "."}
          </span>
          <CommandShortcut className="flex items-center gap-1 normal-case tracking-normal">
            {match.recent ? (
              <HugeiconsIcon icon={Clock01Icon} size={12} strokeWidth={1.75} />
            ) : null}
            {remote ? (
              <>
                <HugeiconsIcon icon={CloudIcon} size={12} strokeWidth={1.75} />
                <span>{t("quickOpen.remote")}</span>
              </>
            ) : null}
          </CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function QuickOpenStatus({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CommandGroup>
      <CommandItem value="quick-open-status" disabled className="text-[12.5px]">
        {error ? (
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={14}
            strokeWidth={1.75}
            className="text-destructive"
          />
        ) : null}
        <span className={error ? "text-destructive" : "text-muted-foreground"}>
          {label}
        </span>
      </CommandItem>
      {onRetry ? (
        <CommandItem value="quick-open-retry" onSelect={onRetry}>
          {t("common.retry")}
        </CommandItem>
      ) : null}
    </CommandGroup>
  );
}

function itemValue(match: QuickOpenMatch): string {
  return `file:${match.rel}`;
}
