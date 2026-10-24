import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isWindowsNativePath,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";
import {
  previewOpeningTarget,
  type PreviewDocumentAction,
} from "@/modules/preview/lib/previewOpeningTarget";

export { isWebPreviewablePath } from "@/modules/preview/lib/previewOpeningTarget";

type Props = {
  path: string;
  workspace: WorkspaceEnv;
  onOpenPreview: PreviewDocumentAction;
};

export function LivePreviewButton({ path, workspace, onOpenPreview }: Props) {
  const { t } = useTranslation();
  const binding = useMemo(
    () => ({ path, workspace, onOpenPreview }),
    [path, workspace, onOpenPreview],
  );
  const owner = useRef<object | null>(null);
  const pending = useRef<{ binding: object } | null>(null);
  const [busy, setBusy] = useState<object | null>(null);
  const loading = busy === binding;
  const supported =
    previewOpeningTarget(path, undefined, {
      root: null,
      env: isWindowsNativePath(path) ? LOCAL_WORKSPACE : workspace,
    })?.kind === "server";
  useLayoutEffect(() => {
    owner.current = binding;
    return () => {
      if (owner.current === binding) owner.current = null;
    };
  }, [binding]);

  const handleClick = async () => {
    if (
      !supported ||
      owner.current !== binding ||
      pending.current?.binding === binding
    )
      return;
    const receipt = { binding };
    pending.current = receipt;
    setBusy(binding);
    const current = () => owner.current === binding;
    try {
      await onOpenPreview(path, current);
    } catch {
      if (current()) toast.error(t("feedback.somethingWentWrong"));
    } finally {
      if (pending.current === receipt) {
        pending.current = null;
        if (current()) setBusy(null);
      }
    }
  };

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      onClick={() => void handleClick()}
      disabled={loading || !supported}
      title={
        supported ? t("tooltips.openLivePreview") : t("workspace.localMachine")
      }
      aria-label={t("tooltips.openLivePreview")}
      className={cn(
        "rounded-lg text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300",
        loading && "cursor-wait opacity-60",
      )}
    >
      <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
    </Button>
  );
}
