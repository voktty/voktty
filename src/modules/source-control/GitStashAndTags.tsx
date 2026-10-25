import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  native,
  type GitStashEntry,
  type GitTagEntry,
} from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import {
  useGitCollectionMenu,
  type GitCollectionMenu,
} from "@/modules/source-control/useGitCollectionMenu";
import {
  Archive01Icon,
  ArchiveArrowUpIcon,
  ArchiveRestoreIcon,
  PlusSignIcon,
  RemoveSquareIcon,
  Tag01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

function formatWhen(timestampSecs: number): string {
  if (!timestampSecs) return "";
  return new Date(timestampSecs * 1000).toLocaleString();
}

const stashKey = (entry: GitStashEntry) => String(entry.index);
const tagKey = (entry: GitTagEntry) => entry.name;

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

export function StashDropdown({
  repoRoot,
  onRefresh,
}: {
  repoRoot: string | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const control = useGitCollectionMenu({
    repoRoot,
    load: native.gitStashList,
    keyOf: stashKey,
    onRefresh,
  });
  const { items: entries, loading, error, busyKey } = control;

  return (
    <>
      <DropdownMenu open={control.menuOpen} onOpenChange={control.setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!repoRoot}
            title={t("git.stash.title")}
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <HugeiconsIcon icon={Archive01Icon} size={13} strokeWidth={1.85} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="flex items-center justify-between px-2 py-1">
            <DropdownMenuLabel className="p-0 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
              {t("git.stash.title")}
            </DropdownMenuLabel>
            <Button
              size="xs"
              variant="ghost"
              className="h-6 cursor-pointer gap-1 px-1.5 text-[11px]"
              disabled={busyKey !== null}
              onClick={control.openDialog}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
              {t("git.stash.new")}
            </Button>
          </div>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-[11px] leading-snug text-destructive">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">
              {t("git.stash.empty")}
            </div>
          ) : (
            <DropdownMenuGroup>
              {entries.map((entry) => (
                <div
                  key={entry.index}
                  className="flex items-center gap-1 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] leading-snug">
                      {entry.message || t("git.stash.unnamed")}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {formatWhen(entry.timestampSecs)}
                    </div>
                  </div>
                  {busyKey === String(entry.index) ? (
                    <Spinner className="size-3 shrink-0" />
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={t("git.stash.apply")}
                        aria-description={
                          control.actionPending
                            ? t("git.waitActionFinish")
                            : undefined
                        }
                        disabled={control.actionPending}
                        onClick={() =>
                          void control.runEntry(
                            String(entry.index),
                            (root, workspace) =>
                              native.gitStashApply(
                                root,
                                entry.index,
                                workspace,
                              ),
                            t("git.stash.applySuccess"),
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <HugeiconsIcon
                          icon={ArchiveArrowUpIcon}
                          size={13}
                          strokeWidth={1.8}
                        />
                      </button>
                      <button
                        type="button"
                        title={t("git.stash.pop")}
                        aria-description={
                          control.actionPending
                            ? t("git.waitActionFinish")
                            : undefined
                        }
                        disabled={control.actionPending}
                        onClick={() =>
                          void control.runEntry(
                            String(entry.index),
                            (root, workspace) =>
                              native.gitStashPop(root, entry.index, workspace),
                            t("git.stash.popSuccess"),
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <HugeiconsIcon
                          icon={ArchiveRestoreIcon}
                          size={13}
                          strokeWidth={1.8}
                        />
                      </button>
                      <button
                        type="button"
                        title={t("git.stash.drop")}
                        aria-description={
                          control.actionPending
                            ? t("git.waitActionFinish")
                            : undefined
                        }
                        disabled={control.actionPending}
                        onClick={() =>
                          void control.runEntry(
                            String(entry.index),
                            (root, workspace) =>
                              native.gitStashDrop(root, entry.index, workspace),
                            t("git.stash.dropSuccess"),
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <HugeiconsIcon
                          icon={RemoveSquareIcon}
                          size={13}
                          strokeWidth={1.8}
                        />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {control.dialogKey !== null && (
        <StashSaveDialog key={control.dialogKey} control={control} />
      )}
    </>
  );
}

function StashSaveDialog({
  control,
}: {
  control: GitCollectionMenu<GitStashEntry>;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const saving = control.busyKey !== null;
  const handleSave = () =>
    control.submitDialog(
      (root, workspace) =>
        native.gitStashSave(
          root,
          message.trim() || undefined,
          includeUntracked,
          workspace,
        ),
      t("git.stash.saveSuccess"),
    );

  return (
    <Dialog open onOpenChange={control.setDialogOpen}>
      <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-md border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={Archive01Icon} size={18} className="text-primary" />
            {t("git.stash.newTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("git.stash.newDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5 py-2 text-xs">
          <div className="space-y-1.5">
            <label className="font-medium text-foreground/90">
              {t("git.stash.messageLabel")}
            </label>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("git.stash.messagePlaceholder")}
              className="h-8 text-xs"
              autoFocus
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-foreground/90">
            <Checkbox
              checked={includeUntracked}
              onCheckedChange={(checked) => setIncludeUntracked(checked === true)}
              disabled={saving}
            />
            {t("git.stash.includeUntracked")}
          </label>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => control.setDialogOpen(false)}
            disabled={saving}
            className="text-xs"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={control.actionPending}
            className="gap-2 text-xs font-medium"
            title={
              control.actionPending && !saving
                ? t("git.waitActionFinish")
                : undefined
            }
          >
            {saving ? <Spinner className="size-3.5" /> : null}
            {saving ? t("common.loading") : t("git.stash.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function TagDropdown({
  repoRoot,
  headSha,
  onRefresh,
}: {
  repoRoot: string | null;
  headSha: string | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const control = useGitCollectionMenu({
    repoRoot,
    contextKey: headSha ?? "",
    load: native.gitTagList,
    keyOf: tagKey,
    onRefresh,
  });
  const { items: tags, loading, error, busyKey: busyName } = control;

  return (
    <>
      <DropdownMenu open={control.menuOpen} onOpenChange={control.setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!repoRoot}
            title={t("git.tags.title")}
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <HugeiconsIcon icon={Tag01Icon} size={13} strokeWidth={1.85} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="flex items-center justify-between px-2 py-1">
            <DropdownMenuLabel className="p-0 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
              {t("git.tags.title")}
            </DropdownMenuLabel>
            <Button
              size="xs"
              variant="ghost"
              className="h-6 cursor-pointer gap-1 px-1.5 text-[11px]"
              disabled={busyName !== null}
              onClick={control.openDialog}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
              {t("git.tags.new")}
            </Button>
          </div>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-[11px] leading-snug text-destructive">
              {error}
            </div>
          ) : tags.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">
              {t("git.tags.empty")}
            </div>
          ) : (
            <DropdownMenuGroup>
              {tags.map((tag) => (
                <div key={tag.name} className="flex items-center gap-1 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium leading-snug">
                        {tag.name}
                      </span>
                      <span className="shrink-0 rounded bg-muted/65 px-1 py-0.5 font-mono text-[9.5px] leading-none text-muted-foreground">
                        {tag.sha.slice(0, 7)}
                      </span>
                    </div>
                    {tag.message ? (
                      <div className="truncate text-[10px] text-muted-foreground">
                        {tag.message}
                      </div>
                    ) : null}
                  </div>
                  {busyName === tag.name ? (
                    <Spinner className="size-3 shrink-0" />
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={t("git.tags.push")}
                        aria-description={
                          control.actionPending
                            ? t("git.waitActionFinish")
                            : undefined
                        }
                        disabled={control.actionPending}
                        onClick={() =>
                          void control.runEntry(
                            tag.name,
                            (root, workspace) =>
                              native.gitTagPush(
                                root,
                                tag.name,
                                undefined,
                                workspace,
                              ),
                            t("git.tags.pushSuccess", { name: tag.name }),
                            false,
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <HugeiconsIcon icon={Upload01Icon} size={13} strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        title={t("git.tags.delete")}
                        aria-description={
                          control.actionPending
                            ? t("git.waitActionFinish")
                            : undefined
                        }
                        disabled={control.actionPending}
                        onClick={() =>
                          void control.runEntry(
                            tag.name,
                            (root, workspace) =>
                              native.gitTagDelete(root, tag.name, workspace),
                            t("git.tags.deleteSuccess", { name: tag.name }),
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <HugeiconsIcon icon={RemoveSquareIcon} size={13} strokeWidth={1.8} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {control.dialogKey !== null && (
        <TagCreateDialog
          key={control.dialogKey}
          control={control}
          headSha={headSha}
        />
      )}
    </>
  );
}

function TagCreateDialog({
  control,
  headSha,
}: {
  control: GitCollectionMenu<GitTagEntry>;
  headSha: string | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const creating = control.busyKey !== null;
  const error = control.dialogError;
  const canCreate =
    name.trim().length > 0 && !creating && !control.actionPending;
  const handleCreate = () => {
    if (!canCreate) return;
    const capturedName = name.trim();
    const capturedMessage = message.trim() || undefined;
    return control.submitDialog(
      (root, workspace) =>
        native.gitTagCreate(
          root,
          capturedName,
          undefined,
          capturedMessage,
          workspace,
        ),
      t("git.tags.createSuccess", { name: capturedName }),
      true,
    );
  };

  return (
    <Dialog open onOpenChange={control.setDialogOpen}>
      <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-md border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={Tag01Icon} size={18} className="text-primary" />
            {t("git.tags.newTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {headSha
              ? t("git.tags.newDescAt", { sha: headSha.slice(0, 7) })
              : t("git.tags.newDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5 py-2 text-xs">
          <div className="space-y-1.5">
            <label className="font-medium text-foreground/90">
              {t("git.tags.nameLabel")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("git.tags.namePlaceholder")}
              className="h-8 text-xs font-mono"
              autoFocus
              disabled={creating}
            />
          </div>
          <div className="space-y-1.5">
            <label className="font-medium text-foreground/90">
              {t("git.tags.messageLabel")}
            </label>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("git.tags.messagePlaceholder")}
              className="h-8 text-xs"
              disabled={creating}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
            <p className="text-[10.5px] text-muted-foreground">
              {t("git.tags.messageHint")}
            </p>
          </div>
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] leading-relaxed text-destructive">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => control.setDialogOpen(false)}
            disabled={creating}
            className="text-xs"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className="gap-2 text-xs font-medium"
            title={
              control.actionPending && !creating
                ? t("git.waitActionFinish")
                : undefined
            }
          >
            {creating ? <Spinner className="size-3.5" /> : null}
            {creating ? t("common.loading") : t("git.tags.createAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
