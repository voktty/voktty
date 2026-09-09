import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  Download01Icon,
  FolderCloudIcon,
  LinkSquare02Icon,
  Refresh01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { hostLabel, parseRemoteWebUrl } from "../lib/remoteWebUrl";

type Props = {
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
  currentBranch?: string;
};

const DEFAULT_REMOTE_NAME = "origin";

export const GitRemotesView = memo(function GitRemotesView({
  repoRoot,
  workspaceEnv,
}: Props) {
  const { t } = useTranslation();
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const loadRemote = useCallback(async () => {
    try {
      setLoading(true);
      const url = await native.gitRemoteUrl(repoRoot, undefined, workspaceEnv);
      setRemoteUrl(url);
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to load remote"
      );
    } finally {
      setLoading(false);
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    void loadRemote();
  }, [loadRemote]);

  const remoteWebInfo = remoteUrl ? parseRemoteWebUrl(remoteUrl) : null;

  const handleFetch = useCallback(async () => {
    try {
      setActionLoading(true);
      await native.gitFetch(repoRoot, workspaceEnv);
      toast.success(t("gitHistory.remotes.fetchSuccess"));
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to fetch"
      );
    } finally {
      setActionLoading(false);
    }
  }, [repoRoot, workspaceEnv, t]);

  const handlePull = useCallback(async () => {
    try {
      setActionLoading(true);
      await native.gitPullFfOnly(repoRoot, workspaceEnv);
      toast.success(t("gitHistory.remotes.pullSuccess"));
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to pull"
      );
    } finally {
      setActionLoading(false);
    }
  }, [repoRoot, workspaceEnv, t]);

  const handlePush = useCallback(async () => {
    try {
      setActionLoading(true);
      await native.gitPush(repoRoot, workspaceEnv);
      toast.success(t("gitHistory.remotes.pushSuccess"));
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to push"
      );
    } finally {
      setActionLoading(false);
    }
  }, [repoRoot, workspaceEnv, t]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden select-none text-xs">
      <div className="flex items-center justify-between p-3 border-b border-border/40">
        <div className="font-semibold text-muted-foreground uppercase tracking-wider">
          {t("gitHistory.remotes.title")}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadRemote}
          disabled={loading}
          className="h-7 px-2.5 gap-1.5 text-xs"
        >
          <HugeiconsIcon
            icon={Refresh01Icon}
            size={13}
            className={cn(loading && "animate-spin")}
          />
          <span>{t("gitHistory.remotes.refresh")}</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading && !remoteUrl ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>{t("gitHistory.remotes.loading")}</span>
          </div>
        ) : !remoteUrl ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground gap-2">
            <HugeiconsIcon icon={FolderCloudIcon} size={32} className="opacity-40" />
            <p>{t("gitHistory.remotes.noRemote")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Remote Card */}
            <div className="p-3.5 rounded-md border border-border/40 bg-card/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={FolderCloudIcon} size={15} className="text-primary" />
                  <span className="font-semibold text-sm text-foreground">{DEFAULT_REMOTE_NAME}</span>
                  {remoteWebInfo && (
                    <span className="text-[11px] rounded-sm bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {hostLabel(remoteWebInfo)}
                    </span>
                  )}
                </div>

                {remoteWebInfo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openUrl(remoteWebInfo.baseUrl)}
                    className="h-7 px-2 gap-1 text-xs"
                  >
                    <HugeiconsIcon icon={LinkSquare02Icon} size={13} />
                    <span>{t("gitHistory.remotes.openInBrowser")}</span>
                  </Button>
                )}
              </div>

              <div className="font-mono text-muted-foreground break-all bg-muted/20 p-2 rounded">
                {remoteUrl}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFetch}
                  disabled={actionLoading}
                  className="h-7 px-2.5 gap-1.5"
                >
                  <HugeiconsIcon icon={Refresh01Icon} size={13} />
                  <span>{t("gitHistory.remotes.fetchAll")}</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePull}
                  disabled={actionLoading}
                  className="h-7 px-2.5 gap-1.5"
                >
                  <HugeiconsIcon icon={Download01Icon} size={13} />
                  <span>{t("gitHistory.remotes.pull")}</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePush}
                  disabled={actionLoading}
                  className="h-7 px-2.5 gap-1.5"
                >
                  <HugeiconsIcon icon={Upload01Icon} size={13} />
                  <span>{t("gitHistory.remotes.push")}</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
