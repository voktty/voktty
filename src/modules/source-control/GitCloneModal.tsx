import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { native } from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import { Folder01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultParentDir?: string | null;
  onCloned?: (clonedPath: string) => void;
};

function extractRepoName(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const clean = trimmed.replace(/\/+$/, "").replace(/\.git$/, "");
  const lastSlash = clean.lastIndexOf("/");
  const lastColon = clean.lastIndexOf(":");
  const splitIdx = Math.max(lastSlash, lastColon);
  if (splitIdx >= 0 && splitIdx < clean.length - 1) {
    return clean.slice(splitIdx + 1);
  }
  return clean;
}

export function GitCloneModal({
  open,
  onOpenChange,
  defaultParentDir,
  onCloned,
}: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [targetName, setTargetName] = useState("");
  const [parentDir, setParentDir] = useState(defaultParentDir || "");
  const [customizedTarget, setCustomizedTarget] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl("");
      setTargetName("");
      setParentDir(defaultParentDir || "");
      setCustomizedTarget(false);
      setIsCloning(false);
      setError(null);
    }
  }, [open, defaultParentDir]);

  const handleUrlChange = useCallback(
    (newUrl: string) => {
      setUrl(newUrl);
      if (!customizedTarget) {
        setTargetName(extractRepoName(newUrl));
      }
    },
    [customizedTarget],
  );

  const handlePickParentDir = useCallback(async () => {
    try {
      const picked = await invoke<string | null>("fs_pick_folder", {
        defaultPath: parentDir || undefined,
      });
      if (picked) {
        setParentDir(picked);
      }
    } catch {
      /* noop */
    }
  }, [parentDir]);

  const canClone = useMemo(() => {
    return url.trim().length > 0 && parentDir.trim().length > 0 && !isCloning;
  }, [url, parentDir, isCloning]);

  const handleClone = useCallback(async () => {
    if (!canClone) return;
    setIsCloning(true);
    setError(null);

    try {
      const trimmedUrl = url.trim();
      const trimmedParent = parentDir.trim();
      const trimmedName = targetName.trim() || undefined;

      const clonedPath = await native.gitClone(
        trimmedUrl,
        trimmedParent,
        trimmedName,
      );

      toast.success(t("git.cloneSuccess", { path: clonedPath }));
      onOpenChange(false);
      onCloned?.(clonedPath);
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(msg || t("git.cloneFailed"));
    } finally {
      setIsCloning(false);
    }
  }, [canClone, url, parentDir, targetName, t, onOpenChange, onCloned]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-md border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <HugeiconsIcon icon={GitBranchIcon} size={18} className="text-primary" />
            {t("git.cloneModalTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("git.cloneModalDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-2 text-xs">
          <div className="space-y-1.5">
            <label className="font-medium text-foreground/90">
              {t("git.repoUrlLabel")}
            </label>
            <Input
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://github.com/user/repository.git"
              className="h-8 text-xs font-mono"
              autoFocus
              disabled={isCloning}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canClone) {
                  e.preventDefault();
                  void handleClone();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-foreground/90">
              {t("git.parentDirLabel")}
            </label>
            <div className="flex gap-2">
              <Input
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder="C:/Projects"
                className="h-8 text-xs font-mono flex-1"
                disabled={isCloning}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2.5 gap-1.5 shrink-0 text-xs"
                onClick={handlePickParentDir}
                disabled={isCloning}
              >
                <HugeiconsIcon icon={Folder01Icon} size={14} />
                {t("git.browseFolder")}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-foreground/90">
              {t("git.targetFolderLabel")}
            </label>
            <Input
              value={targetName}
              onChange={(e) => {
                setTargetName(e.target.value);
                setCustomizedTarget(true);
              }}
              placeholder={t("git.targetFolderPlaceholder")}
              className="h-8 text-xs font-mono"
              disabled={isCloning}
            />
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
            disabled={isCloning}
            className="text-xs"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleClone}
            disabled={!canClone}
            className="gap-2 text-xs font-medium"
          >
            {isCloning ? <Spinner className="size-3.5" /> : null}
            {isCloning ? t("git.cloning") : t("git.cloneAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
