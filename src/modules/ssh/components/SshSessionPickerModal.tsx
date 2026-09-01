import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  ComputerTerminal01Icon,
  PlayIcon,
  ServerStack03Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RemoteMultiplexerProbe, RemoteMultiplexerSession, SshConnectionConfig } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: (SshConnectionConfig & { name?: string }) | null;
  probe: RemoteMultiplexerProbe | null;
  onSelect: (
    action: "attach" | "attach_force" | "grouped" | "new" | "none",
    sessionName?: string,
  ) => void;
};

export function SshSessionPickerModal({
  open,
  onOpenChange,
  connection,
  probe,
  onSelect,
}: Props) {
  const { t } = useTranslation();

  if (!connection || !probe) return null;

  const serverLabel = connection.name || `${connection.user ? `${connection.user}@` : ""}${connection.host}`;
  const sessions = probe.sessions;

  const handleSelect = (
    action: "attach" | "attach_force" | "grouped" | "new" | "none",
    sessionName?: string,
  ) => {
    onOpenChange(false);
    onSelect(action, sessionName);
  };

  const handleCreateNew = () => {
    const base = connection.tmuxSessionName?.trim() || "voktty";
    const newName = `${base}-${Date.now().toString().slice(-4)}`;
    handleSelect("new", newName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={ServerStack03Icon} size={18} strokeWidth={1.75} />
            {t("ssh.sessionPicker.title")}
          </DialogTitle>
          <DialogDescription>
            {t("ssh.sessionPicker.description")} <span className="font-mono text-foreground font-semibold">{serverLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto py-1">
          {sessions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("ssh.sessionPicker.activeSessionsTitle")} ({sessions.length})
              </span>

              {sessions.map((session: RemoteMultiplexerSession) => {
                const isAttached = session.isAttached || session.attachedCount > 0;
                return (
                  <div
                    key={session.name}
                    className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/60 p-3 transition-colors hover:border-border"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`flex size-7 items-center justify-center rounded-md ${
                          isAttached ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
                        }`}>
                          <HugeiconsIcon icon={ComputerTerminal01Icon} size={14} />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-mono font-semibold text-foreground">
                            {session.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {session.windowsCount} {t("ssh.sessionPicker.windows")} • {session.multiplexer}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isAttached ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                            <HugeiconsIcon icon={UserGroupIcon} size={11} />
                            {t("ssh.sessionPicker.attached")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
                            {t("ssh.sessionPicker.detached")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
                      {isAttached ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] gap-1 cursor-pointer"
                            onClick={() => handleSelect("attach", session.name)}
                          >
                            <HugeiconsIcon icon={UserGroupIcon} size={12} />
                            {t("ssh.sessionPicker.joinShared")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 text-[11px] gap-1 cursor-pointer"
                            onClick={() => handleSelect("attach_force", session.name)}
                          >
                            <HugeiconsIcon icon={PlayIcon} size={12} />
                            {t("ssh.sessionPicker.takeControl")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          className="h-7 text-[11px] gap-1 cursor-pointer"
                          onClick={() => handleSelect("attach", session.name)}
                        >
                          <HugeiconsIcon icon={PlayIcon} size={12} />
                          {t("ssh.sessionPicker.resume")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              {t("ssh.sessionPicker.noExistingSessions")}
            </div>
          )}

          <div className="flex flex-col gap-1.5 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-start gap-2 text-xs cursor-pointer"
              onClick={handleCreateNew}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} />
              <span>{t("ssh.sessionPicker.newSession")}</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 justify-start gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => handleSelect("none")}
            >
              <HugeiconsIcon icon={ComputerTerminal01Icon} size={14} />
              <span>{t("ssh.sessionPicker.directShell")}</span>
            </Button>
          </div>
        </div>

        <DialogFooter className="mt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
