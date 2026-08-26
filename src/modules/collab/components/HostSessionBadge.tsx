import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  banParticipant,
  type HostedTerminalView,
  hostedTerminalForLeaf,
  removeParticipant,
  setHostedParticipantControl,
  stopHostedShare,
  useCollabHostStore,
} from "@/modules/collab/lib/hostRuntime";
import { useTranslation } from "@/modules/i18n";
import {
  Alert02Icon,
  CancelCircleIcon,
  ComputerScreenShareIcon,
  Loading03Icon,
  UserMultiple02Icon,
  UserRemove01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback } from "react";

export function HostSessionBadge({ leafId }: { leafId: number }) {
  const session = useCollabHostStore((state) =>
    hostedTerminalForLeaf(state.sessions, leafId),
  );

  const handleStopSharing = useCallback(() => {
    if (!session) return;
    void stopHostedShare(session.ptyId).catch(() => {});
  }, [session]);

  if (!session) return null;

  return <HostSessionBadgeView session={session} onStop={handleStopSharing} />;
}

export function HostSessionBadgeView({
  session,
  onStop,
}: {
  session: HostedTerminalView;
  onStop: () => void;
}) {
  const { t } = useTranslation();

  const stopping = session.status === "stopping";
  const failed = session.status === "error";
  const participantLabel = `${t("collab.host.participants")}: ${session.participants.length}`;
  const requestedCount = session.participants.filter(
    (participant) => participant.controlRequested,
  ).length;
  const typingParticipant = session.participants.find(
    (participant) => participant.typing,
  );

  return (
    <aside
      role="status"
      aria-live="polite"
      className={
        failed
          ? "absolute right-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-destructive/35 bg-background/95 p-1.5 pl-2.5 text-[11px] shadow-lg backdrop-blur-md"
          : "absolute right-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-emerald-500/25 bg-background/95 p-1.5 pl-2.5 text-[11px] shadow-lg backdrop-blur-md"
      }
      title={failed ? (session.error ?? undefined) : undefined}
    >
      <HugeiconsIcon
        icon={failed ? Alert02Icon : ComputerScreenShareIcon}
        size={13}
        className={failed ? "text-destructive" : "text-emerald-400"}
      />
      <span className="min-w-0 truncate font-medium">
        {t("collab.host.sharedTerminal")}
      </span>
      {typingParticipant ? (
        <span className="max-w-36 truncate text-emerald-400">
          {typingParticipant.name}: {t("collab.host.typing")}
        </span>
      ) : null}
      <details className="group/participants relative">
        <summary
          className="list-none cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden"
          aria-label={`${t("collab.host.manageParticipants")}. ${participantLabel}`}
          title={
            session.participants
              .map((participant) => participant.name)
              .join(", ") || participantLabel
          }
        >
          <Badge
            variant="outline"
            className="h-5 gap-1 border-emerald-500/25 px-1.5 font-mono text-[10px] tabular-nums"
          >
            <HugeiconsIcon icon={UserMultiple02Icon} size={11} />
            {session.participants.length}
            {requestedCount > 0 ? (
              <span className="rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black">
                {requestedCount}
              </span>
            ) : null}
          </Badge>
        </summary>
        <div className="absolute right-0 top-7 z-50 w-80 rounded-2xl border border-border/60 bg-popover p-2 text-popover-foreground shadow-xl">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("collab.host.participants")}
          </p>
          {session.participants.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t("collab.host.noParticipants")}
            </p>
          ) : (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {session.participants.map((participant) => (
                <div
                  key={participant.id}
                  className="rounded-xl border border-border/40 bg-background/40 p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {participant.name}
                    </span>
                    {participant.typing ? (
                      <span className="shrink-0 text-[10px] font-medium text-emerald-400">
                        {t("collab.host.typing")}
                      </span>
                    ) : null}
                    <Badge
                      variant={
                        participant.controlRequested ? "default" : "outline"
                      }
                      className="text-[9px]"
                    >
                      {participant.controlRequested
                        ? t("collab.host.controlRequest")
                        : t(`collab.roles.${participant.role}`)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Button
                      size="xs"
                      variant={
                        participant.controlRequested ? "default" : "ghost"
                      }
                      onClick={() =>
                        void setHostedParticipantControl(
                          session.ptyId,
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
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        void removeParticipant(
                          session.ptyId,
                          participant.id,
                        ).catch(() => {})
                      }
                    >
                      <HugeiconsIcon icon={UserRemove01Icon} size={11} />
                      {t("collab.host.disconnectParticipant")}
                    </Button>
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={() =>
                        void banParticipant(
                          session.ptyId,
                          participant.id,
                        ).catch(() => {})
                      }
                    >
                      <HugeiconsIcon icon={CancelCircleIcon} size={11} />
                      {t("collab.host.banParticipant")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
      <Button
        type="button"
        size="xs"
        variant="destructive"
        disabled={stopping}
        onClick={onStop}
        aria-label={t("collab.host.stop")}
      >
        {stopping ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            size={11}
            className="animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {stopping ? t("collab.host.stopping") : t("collab.host.stop")}
      </Button>
    </aside>
  );
}
