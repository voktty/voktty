import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  type GitStashEntry,
  type GitTagEntry,
  native,
} from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useTranslation } from "@/modules/i18n";
import {
  Archive01Icon,
  Delete02Icon,
  Download01Icon,
  PlusSignIcon,
  Refresh01Icon,
  Search01Icon,
  Tag01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
};

function formatStashRef(index: number): string {
  return `stash@{${index}}`;
}

export const GitTagsStashesView = memo(function GitTagsStashesView({
  repoRoot,
  workspaceEnv,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"tags" | "stashes">("tags");
  const [tags, setTags] = useState<GitTagEntry[]>([]);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Tag creation state
  const [newTagName, setNewTagName] = useState("");
  const [newTagMsg, setNewTagMsg] = useState("");

  // Stash creation state
  const [newStashMsg, setNewStashMsg] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);

  // Delete confirmation
  const [deleteTagTarget, setDeleteTagTarget] = useState<string | null>(null);
  const [dropStashIndex, setDropStashIndex] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [tagsRes, stashesRes] = await Promise.all([
        native.gitTagList(repoRoot, workspaceEnv),
        native.gitStashList(repoRoot, workspaceEnv),
      ]);
      setTags(tagsRes || []);
      setStashes(stashesRes || []);
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to load data"
      );
    } finally {
      setLoading(false);
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredTags = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.toLowerCase();
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.message && t.message.toLowerCase().includes(q))
    );
  }, [tags, search]);

  const filteredStashes = useMemo(() => {
    if (!search.trim()) return stashes;
    const q = search.toLowerCase();
    return stashes.filter(
      (s) =>
        s.message.toLowerCase().includes(q) ||
        s.sha.toLowerCase().includes(q)
    );
  }, [stashes, search]);

  // Tag actions
  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) {
      toast.error(t("gitHistory.tagsStashes.tagNamePlaceholder"));
      return;
    }
    try {
      setActionLoading(true);
      await native.gitTagCreate(
        repoRoot,
        name,
        undefined,
        newTagMsg.trim() || undefined,
        workspaceEnv
      );
      toast.success(t("gitHistory.tagsStashes.tagCreated", { name }));
      setNewTagName("");
      setNewTagMsg("");
      await loadData();
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to create tag"
      );
    } finally {
      setActionLoading(false);
    }
  }, [newTagName, newTagMsg, repoRoot, workspaceEnv, loadData, t]);

  const handleDeleteTag = useCallback(async () => {
    if (!deleteTagTarget) return;
    try {
      setActionLoading(true);
      await native.gitTagDelete(repoRoot, deleteTagTarget, workspaceEnv);
      toast.success(t("gitHistory.tagsStashes.tagDeleted", { name: deleteTagTarget }));
      setDeleteTagTarget(null);
      await loadData();
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to delete tag"
      );
    } finally {
      setActionLoading(false);
    }
  }, [deleteTagTarget, repoRoot, workspaceEnv, loadData, t]);

  const handlePushTag = useCallback(
    async (tagName: string) => {
      try {
        setActionLoading(true);
        await native.gitTagPush(repoRoot, tagName, undefined, workspaceEnv);
        toast.success(t("gitHistory.tagsStashes.tagPushed", { name: tagName }));
      } catch (err) {
        toast.error(
          typeof err === "string" ? err : (err as Error).message || "Failed to push tag"
        );
      } finally {
        setActionLoading(false);
      }
    },
    [repoRoot, workspaceEnv, t]
  );

  // Stash actions
  const handleSaveStash = useCallback(async () => {
    try {
      setActionLoading(true);
      await native.gitStashSave(
        repoRoot,
        newStashMsg.trim() || undefined,
        includeUntracked,
        workspaceEnv
      );
      toast.success(t("gitHistory.tagsStashes.stashChanges"));
      setNewStashMsg("");
      await loadData();
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to save stash"
      );
    } finally {
      setActionLoading(false);
    }
  }, [repoRoot, newStashMsg, includeUntracked, workspaceEnv, loadData, t]);

  const handleApplyStash = useCallback(
    async (index: number) => {
      try {
        setActionLoading(true);
        await native.gitStashApply(repoRoot, index, workspaceEnv);
        toast.success(t("gitHistory.tagsStashes.stashApplied", { index }));
      } catch (err) {
        toast.error(
          typeof err === "string" ? err : (err as Error).message || "Failed to apply stash"
        );
      } finally {
        setActionLoading(false);
      }
    },
    [repoRoot, workspaceEnv, t]
  );

  const handlePopStash = useCallback(
    async (index: number) => {
      try {
        setActionLoading(true);
        await native.gitStashPop(repoRoot, index, workspaceEnv);
        toast.success(t("gitHistory.tagsStashes.stashPopped", { index }));
        await loadData();
      } catch (err) {
        toast.error(
          typeof err === "string" ? err : (err as Error).message || "Failed to pop stash"
        );
      } finally {
        setActionLoading(false);
      }
    },
    [repoRoot, workspaceEnv, loadData, t]
  );

  const handleDropStash = useCallback(async () => {
    if (dropStashIndex === null) return;
    try {
      setActionLoading(true);
      await native.gitStashDrop(repoRoot, dropStashIndex, workspaceEnv);
      toast.success(t("gitHistory.tagsStashes.stashDropped", { index: dropStashIndex }));
      setDropStashIndex(null);
      await loadData();
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to drop stash"
      );
    } finally {
      setActionLoading(false);
    }
  }, [dropStashIndex, repoRoot, workspaceEnv, loadData, t]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden select-none text-xs">
      {/* Tab & Action Bar */}
      <div className="flex items-center justify-between p-3 border-b border-border/40 gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border/50 bg-muted/20 p-0.5">
            <button
              type="button"
              onClick={() => setTab("tags")}
              className={cn(
                "rounded-sm px-2.5 py-1 font-medium transition-colors",
                tab === "tags"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={Tag01Icon} size={13} />
                <span>
                  {t("gitHistory.tagsStashes.tags")} ({tags.length})
                </span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setTab("stashes")}
              className={cn(
                "rounded-sm px-2.5 py-1 font-medium transition-colors",
                tab === "stashes"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={Archive01Icon} size={13} />
                <span>
                  {t("gitHistory.tagsStashes.stashes")} ({stashes.length})
                </span>
              </div>
            </button>
          </div>

          <div className="relative w-48">
            <HugeiconsIcon
              icon={Search01Icon}
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("gitHistory.branches.searchPlaceholder")}
              className="h-7 pl-7 text-xs bg-muted/20 border-border/40"
            />
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="h-7 px-2.5 gap-1.5 text-xs"
        >
          <HugeiconsIcon
            icon={Refresh01Icon}
            size={13}
            className={cn(loading && "animate-spin")}
          />
          <span>{t("gitHistory.tagsStashes.refresh")}</span>
        </Button>
      </div>

      {/* Create Forms */}
      <div className="p-3 border-b border-border/30 bg-muted/05">
        {tab === "tags" ? (
          <div className="flex items-center gap-2 max-w-xl">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder={t("gitHistory.tagsStashes.tagNamePlaceholder")}
              className="h-7 font-mono w-48 text-xs"
            />
            <Input
              value={newTagMsg}
              onChange={(e) => setNewTagMsg(e.target.value)}
              placeholder={t("gitHistory.tagsStashes.tagMessagePlaceholder")}
              className="h-7 flex-1 text-xs"
            />
            <Button
              size="sm"
              onClick={handleCreateTag}
              disabled={actionLoading || !newTagName.trim()}
              className="h-7 px-2.5 gap-1.5 text-xs shrink-0"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} />
              <span>{t("gitHistory.tagsStashes.createTag")}</span>
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 max-w-xl">
            <Input
              value={newStashMsg}
              onChange={(e) => setNewStashMsg(e.target.value)}
              placeholder={t("gitHistory.tagsStashes.stashMessagePlaceholder")}
              className="h-7 flex-1 text-xs"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={(e) => setIncludeUntracked(e.target.checked)}
                className="rounded-sm"
              />
              <span>{t("gitHistory.tagsStashes.includeUntracked")}</span>
            </label>
            <Button
              size="sm"
              onClick={handleSaveStash}
              disabled={actionLoading}
              className="h-7 px-2.5 gap-1.5 text-xs shrink-0"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} />
              <span>{t("gitHistory.tagsStashes.stashChanges")}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Content List */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && (tab === "tags" ? tags.length : stashes.length) === 0 ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>{t("gitHistory.tagsStashes.loading")}</span>
          </div>
        ) : tab === "tags" ? (
          filteredTags.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("gitHistory.tagsStashes.noTags")}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredTags.map((tag) => (
                <div
                  key={tag.name}
                  className="flex items-center justify-between p-2.5 rounded-md border border-border/40 bg-card/30 hover:bg-card/60 transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={Tag01Icon} size={13} className="text-primary" />
                      <span className="font-mono font-semibold text-foreground">
                        {tag.name}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {tag.sha.slice(0, 7)}
                      </span>
                    </div>
                    {tag.message && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {tag.message}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePushTag(tag.name)}
                      disabled={actionLoading}
                      className="h-7 px-2 gap-1 text-[11px]"
                      title={t("gitHistory.tagsStashes.pushTag")}
                    >
                      <HugeiconsIcon icon={Upload01Icon} size={13} />
                      <span>{t("gitHistory.tagsStashes.push")}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTagTarget(tag.name)}
                      disabled={actionLoading}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filteredStashes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t("gitHistory.tagsStashes.noStashes")}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredStashes.map((stash) => (
              <div
                key={stash.index}
                className="flex items-center justify-between p-2.5 rounded-md border border-border/40 bg-card/30 hover:bg-card/60 transition-colors"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={Archive01Icon} size={13} className="text-amber-500" />
                    <span className="font-mono font-semibold text-foreground">
                      {formatStashRef(stash.index)}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {stash.sha.slice(0, 7)}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {stash.message}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleApplyStash(stash.index)}
                    disabled={actionLoading}
                    className="h-7 px-2 text-[11px]"
                  >
                    {t("gitHistory.tagsStashes.apply")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePopStash(stash.index)}
                    disabled={actionLoading}
                    className="h-7 px-2 gap-1 text-[11px]"
                  >
                    <HugeiconsIcon icon={Download01Icon} size={13} />
                    <span>{t("gitHistory.tagsStashes.pop")}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDropStashIndex(stash.index)}
                    disabled={actionLoading}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Tag Dialog */}
      <AlertDialog
        open={Boolean(deleteTagTarget)}
        onOpenChange={(open) => !open && setDeleteTagTarget(null)}
      >
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gitHistory.tagsStashes.deleteTagTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("gitHistory.tagsStashes.deleteTagDesc", { name: deleteTagTarget ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("gitHistory.tagsStashes.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTag}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("gitHistory.tagsStashes.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Drop Stash Dialog */}
      <AlertDialog
        open={dropStashIndex !== null}
        onOpenChange={(open) => !open && setDropStashIndex(null)}
      >
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gitHistory.tagsStashes.dropStashTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("gitHistory.tagsStashes.dropStashDesc", { index: dropStashIndex ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("gitHistory.tagsStashes.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDropStash()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("gitHistory.tagsStashes.drop")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
