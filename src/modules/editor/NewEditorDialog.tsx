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
import { useTranslation } from "@/modules/i18n";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { File02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string | null;
  onCreated: (path: string) => void;
};

function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function NewEditorDialog({
  open,
  onOpenChange,
  rootPath,
  onCreated,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("untitled.txt");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("untitled.txt");
    setError(null);
    // Pre-select the basename so the user can quickly retype the filename
    // while keeping the extension handy.
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const dot = el.value.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    }, 0);
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("editor.dialog.nameRequired"));
      return;
    }
    if (trimmed.includes("..")) {
      setError(t("editor.dialog.pathMustBeRelative"));
      return;
    }
    if (!rootPath) {
      setError(t("editor.dialog.noWorkspaceRoot"));
      return;
    }
    const path = trimmed.startsWith("/")
      ? trimmed
      : joinPath(rootPath, trimmed);
    try {
      await invoke("fs_create_file", {
        path,
        workspace: currentWorkspaceEnv(),
      });
      onCreated(path);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex gap-1.75">
            <HugeiconsIcon icon={File02Icon} size={16} strokeWidth={1.75} />
            {t("explorer.newFile")}
          </DialogTitle>
          <DialogDescription>
            {t("editor.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="example.ts"
        />
        {error ? (
          <div className="text-xs text-destructive">{error}</div>
        ) : (
          <div className="text-xs text-muted-foreground truncate">
            {rootPath ? joinPath(rootPath, name.trim() || "…") : "—"}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
