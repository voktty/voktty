import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  releaseGuestControl,
  requestGuestControl,
  useCollabGuestStore,
} from "@/modules/collab/lib/guestRuntime";
import { useTranslation } from "@/modules/i18n";
import {
  Alert02Icon,
  ComputerScreenShareIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function GuestSessionBadge({
  leafId,
  onReconnect,
}: {
  leafId: number;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  const session = useCollabGuestStore((state) => state.sessions[leafId]);
  if (!session) return null;

  const connected = session.status === "connected";
  const controls = session.role === "controller";
  const pending =
    session.status === "connecting" || session.status === "reconnecting";
  const failed = session.status === "failed";
  const statusLabel = failed
    ? t("collab.guest.connectionFailed")
    : session.status === "disconnected"
      ? t("collab.guest.disconnected")
      : t("collab.guest.sharedTerminal");
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute right-3 top-3 z-30 flex items-center gap-2 rounded-xl border border-sky-500/25 bg-background/90 p-1.5 pl-2.5 text-[11px] shadow-lg backdrop-blur-md"
    >
      <HugeiconsIcon
        icon={failed ? Alert02Icon : pending ? Loading03Icon : ComputerScreenShareIcon}
        size={13}
        className={
          failed
            ? "text-destructive"
            : pending
              ? "animate-spin text-sky-400 motion-reduce:animate-none"
              : "text-sky-400"
        }
      />
      <span className={failed ? "font-medium text-destructive" : "font-medium"}>
        {statusLabel}
      </span>
      <Badge
        variant={controls ? "default" : "outline"}
        className="h-5 px-1.5 text-[10px]"
      >
        {t(`collab.roles.${session.role}`)}
      </Badge>
      {connected ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={session.controlRequested}
          onClick={() =>
            void (
              controls
                ? releaseGuestControl(leafId)
                : requestGuestControl(leafId)
            ).catch(() => {})
          }
        >
          {session.controlRequested
            ? t("collab.guest.controlRequested")
            : controls
              ? t("collab.guest.releaseControl")
              : t("collab.guest.requestControl")}
        </Button>
      ) : (
        <Button type="button" size="xs" variant="ghost" onClick={onReconnect}>
          {t("collab.guest.reconnect")}
        </Button>
      )}
    </div>
  );
}
