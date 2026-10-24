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
import { currentWorkspaceEnv, type WorkspaceEnv } from "@/modules/workspace";
import { File02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createEditorFile,
  newEditorFileTarget,
} from "@/modules/editor/lib/newEditorFile";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string | null;
  onCreated: (path: string, workspace: WorkspaceEnv) => void;
  workspace?: WorkspaceEnv;
  requestKey?: object | null;
  isCurrent?: () => boolean;
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
  workspace,
  requestKey,
  isCurrent,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("untitled.txt");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const binding = useMemo(
    () => ({ open, rootPath, workspace, requestKey }),
    [open, rootPath, workspace, requestKey],
  );
  type Owner = {
    binding: typeof binding;
    workspace: WorkspaceEnv;
    current: boolean;
  };
  const owner = useRef<Owner | null>(null);
  const pending = useRef(new Set<object>());
  const submission = useRef<{ owner: Owner } | null>(null);
  useLayoutEffect(() => {
    const receipt = {
      binding,
      workspace: binding.workspace ?? currentWorkspaceEnv(),
      current: binding.open,
    };
    owner.current = receipt;
    setSaving(false);
    return () => {
      receipt.current = false;
    };
  }, [binding]);

  useEffect(() => {
    if (!binding.open) return;
    const receipt = owner.current;
    setName("untitled.txt");
    setError(null);
    // Pre-select the basename so the user can quickly retype the filename
    // while keeping the extension handy.
    const timer = setTimeout(() => {
      if (!receipt?.current || owner.current !== receipt) return;
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const dot = el.value.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    }, 0);
    return () => clearTimeout(timer);
  }, [binding]);

  const changeOpen = (value: boolean) => {
    const receipt = owner.current;
    if (!receipt || receipt.binding !== binding) return;
    if (!value) receipt.current = false;
    onOpenChange(value);
  };

  const submit = async () => {
    const receipt = owner.current;
    const guard = () =>
      !!receipt?.current &&
      owner.current === receipt &&
      receipt.binding === binding &&
      (isCurrent?.() ?? true);
    if (!receipt || !guard() || submission.current?.owner === receipt) return;
    const target = newEditorFileTarget(rootPath, name);
    if (target.error) {
      setError(t(`editor.dialog.${target.error}`));
      return;
    }
    if (pending.current.size >= 256) {
      setError(t("feedback.somethingWentWrong"));
      return;
    }
    const operation = { owner: receipt };
    pending.current.add(operation);
    submission.current = operation;
    setError(null);
    setSaving(true);
    try {
      const path = await createEditorFile(
        target.root,
        target.name,
        receipt.workspace,
        guard,
      );
      if (!path || !guard()) return;
      onCreated(path, receipt.workspace);
      if (guard()) onOpenChange(false);
    } catch (e) {
      if (guard()) setError(String(e));
    } finally {
      pending.current.delete(operation);
      if (submission.current === operation) {
        submission.current = null;
        if (guard()) setSaving(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
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
          disabled={saving}
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
          <Button variant="ghost" onClick={() => changeOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
