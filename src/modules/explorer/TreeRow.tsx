import { cn } from "@/lib/utils";
import { t } from "@/modules/i18n";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { InlineInput } from "./InlineInput";
import { explorerGitTextClass } from "./lib/gitStatusColor";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { ExplorerEntryPreview } from "./ExplorerEntryPreview";
import type { WorkspaceEnv } from "@/modules/workspace";

export type RowActions = {
  toggle: (path: string) => void;
  beginRename: (path: string) => void;
  commitRename: (newName: string) => void | Promise<void>;
  cancelRename: () => void;
};

export type EntryRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  depth: number;
  actions: RowActions;
  renameInProgress: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isDropTarget?: boolean;
  onOpenFile: (path: string, pin?: boolean) => void;
  onSelectPath: (path: string, event?: React.MouseEvent) => void;
  gitStatusCode?: GitStatusCode | null;
  gitignored?: boolean;
  size: number;
  mtime: number;
  workspace: WorkspaceEnv;
};

function EntryRowImpl(props: EntryRowProps) {
  const {
    path,
    name,
    isDir,
    isExpanded,
    depth,
    actions,
    renameInProgress,
    isSelected,
    isRenaming,
    isDropTarget = false,
    onOpenFile,
    onSelectPath,
    gitStatusCode,
    gitignored = false,
    size,
    mtime,
    workspace,
  } = props;

  const iconUrl = isDir ? folderIconUrl(name, isExpanded) : fileIconUrl(name);
  const paddingLeft = 4 + depth * 10;

  if (isRenaming) {
    return (
      <div
        className="flex h-5.5 w-full min-w-0 items-center gap-1.5 px-1.5 text-[12px]"
        style={{ paddingLeft }}
      >
        <span className="size-3 shrink-0" />
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-3.5 shrink-0" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <InlineInput
          initial={name}
          onCommit={actions.commitRename}
          onCancel={actions.cancelRename}
        />
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    if (renameInProgress) return;
    onSelectPath(path, e);
    if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (isDir) actions.toggle(path);
      else onOpenFile(path);
    }
  };

  return (
    <ExplorerEntryPreview
      path={path}
      name={name}
      isDir={isDir}
      size={size}
      mtime={mtime}
      workspace={workspace}
    >
      <button
        type="button"
        data-fs-path={path}
        onClick={handleClick}
        onDoubleClick={() => !isDir && actions.beginRename(path)}
        className={cn(
          "group flex h-5.5 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-left text-[12px] transition-colors hover:bg-accent/70",
          isSelected
            ? "bg-primary/20 text-foreground font-medium"
            : gitignored
              ? "text-muted-foreground/70"
              : "text-foreground/85",
          isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/60",
        )}
        style={{ paddingLeft }}
      >
        <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground">
          {isDir ? (
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={11}
              strokeWidth={2.25}
              className={cn("transition-transform", isExpanded && "rotate-90")}
            />
          ) : null}
        </span>
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-3.5 shrink-0" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !isSelected &&
              !gitignored &&
              gitStatusCode &&
              explorerGitTextClass(gitStatusCode),
          )}
        >
          {name}
        </span>
      </button>
    </ExplorerEntryPreview>
  );
}

export const EntryRow = memo(EntryRowImpl);

export type PendingRowProps = {
  depth: number;
  kind: "file" | "dir";
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function PendingRow({
  depth,
  kind,
  onCommit,
  onCancel,
}: PendingRowProps) {
  return (
    <div
      className="flex h-5.5 w-full min-w-0 items-center gap-1.5 px-1.5 text-[12px]"
      style={{ paddingLeft: 4 + depth * 10 }}
    >
      <span className="size-3 shrink-0" />
      <img
        src={
          kind === "dir" ? folderIconUrl("", false) : fileIconUrl("untitled")
        }
        alt=""
        className="size-3.5 shrink-0 opacity-70"
      />
      <InlineInput
        initial=""
        placeholder={
          kind === "dir" ? t("explorer.newFolder") : t("explorer.newFile")
        }
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function StatusRow({
  depth,
  message,
  tone,
}: {
  depth: number;
  message: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "h-5.5 truncate px-2 text-[10.5px] leading-5.5",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      style={{ paddingLeft: 4 + depth * 10 + 16 }}
    >
      {message}
    </div>
  );
}
