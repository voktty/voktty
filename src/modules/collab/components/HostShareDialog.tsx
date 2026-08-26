import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  banParticipant,
  removeParticipant,
  setHostedParticipantControl,
  startHostedShare,
  stopHostedShare,
  useCollabHostStore,
} from "@/modules/collab/lib/hostRuntime";
import { verifyCloudflared } from "@/modules/collab/lib/requirements";
import type { CloudflaredStatus } from "@/modules/collab/types";
import { useTranslation } from "@/modules/i18n";
import {
  Alert02Icon,
  CancelCircleIcon,
  ComputerScreenShareIcon,
  Copy01Icon,
  Refresh01Icon,
  SquareLock01Icon,
  UserMultiple02Icon,
  UserRemove01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";

export type HostShareTarget = {
  leafId: number;
  ptyId: number;
  cols: number;
  rows: number;
  title: string;
  workspaceRoot: string | null;
};

type Props = {
  open: boolean;
  target: HostShareTarget | null;
  onOpenChange: (open: boolean) => void;
};

export function HostShareDialog({ open, target, onOpenChange }: Props) {
  const { t, language } = useTranslation();
  const hosted = useCollabHostStore((state) =>
    target ? state.sessions[target.ptyId] : undefined,
  );
  const [requirement, setRequirement] = useState<CloudflaredStatus | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [shareFiles, setShareFiles] = useState(false);
  const [copied, setCopied] = useState<"url" | "code" | "command" | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const checkRequirement = useCallback(async (path?: string) => {
    setChecking(true);
    try {
      setRequirement(await verifyCloudflared(path));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCopied(null);
    setShareFiles(false);
    void checkRequirement();
  }, [open, checkRequirement]);

  const copy = async (kind: "url" | "code" | "command", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const starting = hosted?.status === "starting";
  const stopping = hosted?.status === "stopping";
  const ready = hosted?.status === "ready" && hosted.share;
  const installCommand = requirement?.suggestion?.command;
  const expiresAtMs = ready ? ready.invite.expiresAtMs : null;
  const invitationExpired = expiresAtMs !== null && nowMs >= expiresAtMs;

  useEffect(() => {
    if (!expiresAtMs) return;
    setNowMs(Date.now());
    const delay = Math.max(0, expiresAtMs - Date.now() + 100);
    const timeout = window.setTimeout(() => setNowMs(Date.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [expiresAtMs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-full sm:max-w-xl max-w-xl flex flex-col gap-0 p-0 overflow-hidden border-border bg-card text-card-foreground shadow-2xl rounded-3xl">
        <DialogHeader className="p-6 pb-4 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 shrink-0">
              <HugeiconsIcon
                icon={ComputerScreenShareIcon}
                size={20}
                strokeWidth={1.8}
              />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold">
                {t("collab.host.title")}
              </DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-xs text-muted-foreground">
                {target?.title ?? t("collab.host.noTerminal")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {ready ? (
            <div className="space-y-5">
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={
                      invitationExpired
                        ? "size-2 shrink-0 rounded-full bg-amber-400"
                        : "size-2 shrink-0 animate-pulse rounded-full bg-emerald-400"
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">
                      {t(
                        invitationExpired
                          ? "collab.host.invitationExpired"
                          : "collab.host.live",
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {invitationExpired
                        ? t("collab.host.expiredDescription")
                        : t("collab.host.expires", {
                            time: new Date(
                              ready.invite.expiresAtMs,
                            ).toLocaleTimeString(language, {
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          })}
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="border-sky-500/30 text-sky-400 shrink-0 text-[11px] font-medium px-2.5 py-0.5 whitespace-nowrap bg-sky-500/5"
                >
                  <HugeiconsIcon
                    icon={SquareLock01Icon}
                    size={11}
                    className="mr-1 inline-block"
                  />
                  {t("collab.host.encrypted")}
                </Badge>
              </div>

              <CopyField
                label={t("collab.host.urlLabel")}
                value={ready.tunnel.connectionUrl}
                copied={copied === "url"}
                onCopy={() => void copy("url", ready.tunnel.connectionUrl)}
              />

              {hosted.fileCitationRoot ? (
                <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.05] p-3.5">
                  <p className="text-xs font-semibold text-foreground">
                    {t("collab.host.fileCitationsLive")}
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {hosted.fileCitationRoot}
                  </p>
                </div>
              ) : null}
              <CopyField
                label={t("collab.host.codeLabel")}
                value={ready.invite.inviteCode}
                copied={copied === "code"}
                disabled={invitationExpired}
                onCopy={() => void copy("code", ready.invite.inviteCode)}
              />

              <div className="rounded-2xl border border-border/60 overflow-hidden bg-background/30">
                <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2.5 bg-muted/20">
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <HugeiconsIcon
                      icon={UserMultiple02Icon}
                      size={15}
                      className="text-muted-foreground"
                    />
                    <span>{t("collab.host.participants")}</span>
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground bg-muted/40 rounded-full px-2 py-0.5">
                    {hosted.participants.length}
                  </span>
                </div>
                {hosted.participants.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("collab.host.noParticipants")}
                  </p>
                ) : (
                  <div className="divide-y divide-border/30 max-h-48 overflow-y-auto">
                    {hosted.participants.map((participant) => (
                      <div
                        key={participant.id}
                        className="flex items-center gap-2 px-3.5 py-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {participant.name}
                        </span>
                        {participant.typing ? (
                          <span className="shrink-0 text-[10px] font-medium text-emerald-400">
                            {t("collab.host.typing")}
                          </span>
                        ) : null}
                        <Badge variant="outline" className="text-[10px]">
                          {participant.controlRequested
                            ? t("collab.host.controlRequest")
                            : t(`collab.roles.${participant.role}`)}
                        </Badge>
                        {participant.role !== "host" ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                void setHostedParticipantControl(
                                  hosted.ptyId,
                                  participant.id,
                                  participant.role !== "controller",
                                ).catch(() => {})
                              }
                            >
                              {participant.role === "controller"
                                ? t("collab.host.revokeControl")
                                : t("collab.host.grantControl")}
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              title={t("collab.host.disconnectParticipant")}
                              onClick={() =>
                                void removeParticipant(
                                  hosted.ptyId,
                                  participant.id,
                                ).catch(() => {})
                              }
                            >
                              <HugeiconsIcon
                                icon={UserRemove01Icon}
                                size={13}
                              />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="destructive"
                              title={t("collab.host.banParticipant")}
                              onClick={() =>
                                void banParticipant(
                                  hosted.ptyId,
                                  participant.id,
                                ).catch(() => {})
                              }
                            >
                              <HugeiconsIcon
                                icon={CancelCircleIcon}
                                size={13}
                              />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {hosted.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {hosted.error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  size={15}
                  className="mt-0.5 shrink-0 text-amber-400"
                />
                <span>{t("collab.host.experimentalWarning")}</span>
              </div>

              {checking ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <Spinner />
                  {t("collab.host.checkingCloudflared")}
                </div>
              ) : requirement?.installed ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                  <p className="text-xs font-semibold text-emerald-400">
                    {t("collab.host.cloudflaredReady")}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {requirement.version ?? requirement.executable}
                  </p>
                </div>
              ) : (
                <div className="space-y-3.5 rounded-2xl border border-border/60 p-4 bg-background/30">
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {t("collab.host.cloudflaredMissing")}
                    </p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed">
                      {t("collab.host.installExplanation")}
                    </p>
                  </div>
                  {installCommand ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-background/70 p-2.5">
                      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px]">
                        {installCommand}
                      </code>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title={t("common.copy")}
                        onClick={() => void copy("command", installCommand)}
                      >
                        <HugeiconsIcon icon={Copy01Icon} size={13} />
                      </Button>
                    </div>
                  ) : null}
                  <Input
                    value={customPath}
                    onChange={(event) => setCustomPath(event.target.value)}
                    placeholder={t("collab.host.customPathPlaceholder")}
                    className="h-8.5 font-mono text-xs rounded-xl"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 rounded-xl"
                    onClick={() => void checkRequirement(customPath)}
                  >
                    <HugeiconsIcon icon={Refresh01Icon} size={13} />
                    {t("collab.host.verifyAgain")}
                  </Button>
                </div>
              )}

              <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/30 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">
                    {t("collab.host.fileCitationsTitle")}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {target?.workspaceRoot
                      ? t("collab.host.fileCitationsDescription")
                      : t("collab.host.fileCitationsUnavailable")}
                  </p>
                  {target?.workspaceRoot ? (
                    <p className="mt-2 truncate font-mono text-[10.5px] text-muted-foreground">
                      {target.workspaceRoot}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={shareFiles}
                  disabled={!target?.workspaceRoot || starting}
                  aria-label={t("collab.host.fileCitationsTitle")}
                  onCheckedChange={setShareFiles}
                />
              </div>

              {hosted?.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {hosted.error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="p-4 px-6 border-t border-border/40 bg-muted/10 shrink-0 sm:justify-end">
          {ready && target ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={stopping}
              onClick={() => void stopHostedShare(target.ptyId).catch(() => {})}
              className="rounded-xl px-4 font-medium"
            >
              {stopping ? t("collab.host.stopping") : t("collab.host.stop")}
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="rounded-xl"
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                className="gap-1.5 rounded-xl px-4"
                disabled={
                  !target || !requirement?.installed || checking || starting
                }
                onClick={() =>
                  target &&
                  void startHostedShare(
                    {
                      leafId: target.leafId,
                      ptyId: target.ptyId,
                      cols: target.cols,
                      rows: target.rows,
                      title: target.title,
                      fileCitationRoot: shareFiles
                        ? target.workspaceRoot
                        : null,
                    },
                    customPath,
                  ).catch(() => {})
                }
              >
                {starting ? (
                  <Spinner />
                ) : (
                  <HugeiconsIcon icon={SquareLock01Icon} size={14} />
                )}
                {starting ? t("collab.host.starting") : t("collab.host.start")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyField({
  label,
  value,
  copied,
  disabled = false,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  disabled?: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/50 p-2.5">
        <code className="min-w-0 flex-1 overflow-x-auto break-all font-mono text-xs select-all text-foreground">
          {value}
        </code>
        <Button
          size="xs"
          variant="ghost"
          className="gap-1.5 shrink-0 rounded-lg text-xs font-medium"
          disabled={disabled}
          onClick={onCopy}
        >
          <HugeiconsIcon icon={Copy01Icon} size={12} />
          <span>{copied ? t("common.copied") : t("common.copy")}</span>
        </Button>
      </div>
    </div>
  );
}
