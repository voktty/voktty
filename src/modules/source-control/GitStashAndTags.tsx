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
import { useWorkspaceEnvStore } from "@/modules/workspace";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function formatWhen(timestampSecs: number): string {
  if (!timestampSecs) return "";
  return new Date(timestampSecs * 1000).toLocaleString();
}

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

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
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [entries, setEntries] = useState<GitStashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    if (!repoRoot) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await native.gitStashList(repoRoot, workspaceEnv);
      if (id !== requestRef.current) return;
      setEntries(result);
    } catch (err) {
      if (id !== requestRef.current) return;
      setError(errorMessage(err));
      setEntries([]);
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const runAction = useCallback(
    async (
      index: number,
      action: (root: string, i: number) => Promise<void>,
      successKey: string,
    ) => {
      if (!repoRoot || busyIndex !== null) return;
      setBusyIndex(index);
      try {
        await action(repoRoot, index);
        toast.success(t(successKey));
        onRefresh();
        await load();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusyIndex(null);
      }
    },
    [busyIndex, load, onRefresh, repoRoot, t],
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
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
              onClick={() => {
                setOpen(false);
                setSaveOpen(true);
              }}
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
                  {busyIndex === entry.index ? (
                    <Spinner className="size-3 shrink-0" />
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={t("git.stash.apply")}
                        onClick={() =>
                          void runAction(
                            entry.index,
                            (root, i) => native.gitStashApply(root, i, workspaceEnv),
                            "git.stash.applySuccess",
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
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
                        onClick={() =>
                          void runAction(
                            entry.index,
                            (root, i) => native.gitStashPop(root, i, workspaceEnv),
                            "git.stash.popSuccess",
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
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
                        onClick={() =>
                          void runAction(
                            entry.index,
                            (root, i) => native.gitStashDrop(root, i, workspaceEnv),
                            "git.stash.dropSuccess",
                          )
                        }
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
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
      <StashSaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        repoRoot={repoRoot}
        onSaved={() => {
          onRefresh();
          void load();
        }}
      />
    </>
  );
}

function StashSaveDialog({
  open,
  onOpenChange,
  repoRoot,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMessage("");
      setIncludeUntracked(false);
      setSaving(false);
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    if (!repoRoot || saving) return;
    setSaving(true);
    try {
      await native.gitStashSave(
        repoRoot,
        message.trim() || undefined,
        includeUntracked,
        workspaceEnv,
      );
      toast.success(t("git.stash.saveSuccess"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [includeUntracked, message, onOpenChange, onSaved, repoRoot, saving, t, workspaceEnv]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-xs"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !repoRoot}
            className="gap-2 text-xs font-medium"
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
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [tags, setTags] = useState<GitTagEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    if (!repoRoot) {
      setTags([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await native.gitTagList(repoRoot, workspaceEnv);
      if (id !== requestRef.current) return;
      setTags(result);
    } catch (err) {
      if (id !== requestRef.current) return;
      setError(errorMessage(err));
      setTags([]);
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleDelete = useCallback(
    async (name: string) => {
      if (!repoRoot || busyName) return;
      setBusyName(name);
      try {
        await native.gitTagDelete(repoRoot, name, workspaceEnv);
        toast.success(t("git.tags.deleteSuccess", { name }));
        onRefresh();
        await load();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusyName(null);
      }
    },
    [busyName, load, onRefresh, repoRoot, t, workspaceEnv],
  );

  const handlePush = useCallback(
    async (name: string) => {
      if (!repoRoot || busyName) return;
      setBusyName(name);
      try {
        await native.gitTagPush(repoRoot, name, undefined, workspaceEnv);
        toast.success(t("git.tags.pushSuccess", { name }));
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusyName(null);
      }
    },
    [busyName, repoRoot, t, workspaceEnv],
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
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
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
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
                        onClick={() => void handlePush(tag.name)}
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                      >
                        <HugeiconsIcon icon={Upload01Icon} size={13} strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        title={t("git.tags.delete")}
                        onClick={() => void handleDelete(tag.name)}
                        className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
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
      <TagCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        repoRoot={repoRoot}
        headSha={headSha}
        onCreated={() => {
          onRefresh();
          void load();
        }}
      />
    </>
  );
}

function TagCreateDialog({
  open,
  onOpenChange,
  repoRoot,
  headSha,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string | null;
  headSha: string | null;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setMessage("");
      setCreating(false);
      setError(null);
    }
  }, [open]);

  const canCreate = name.trim().length > 0 && !creating && !!repoRoot;

  const handleCreate = useCallback(async () => {
    if (!repoRoot || !canCreate) return;
    setCreating(true);
    setError(null);
    try {
      await native.gitTagCreate(
        repoRoot,
        name.trim(),
        undefined,
        message.trim() || undefined,
        workspaceEnv,
      );
      toast.success(t("git.tags.createSuccess", { name: name.trim() }));
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }, [canCreate, message, name, onCreated, onOpenChange, repoRoot, t, workspaceEnv]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
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
          >
            {creating ? <Spinner className="size-3.5" /> : null}
            {creating ? t("common.loading") : t("git.tags.createAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
