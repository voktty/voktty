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
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  ComputerTerminal01Icon,
  Loading03Icon,
  PlayIcon,
  RefreshIcon,
  ServerStack03Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import {
  probeSshMultiplexer,
  type RemoteMultiplexerProbe,
  type RemoteMultiplexerSession,
  type SshConnectionConfig,
} from "../types";

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

function getNextAvailableSessionName(base: string, existing: string[]): string {
  const set = new Set(existing.map((s) => s.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  let counter = 1;
  while (set.has(`${base}-${counter}`.toLowerCase())) {
    counter++;
  }
  return `${base}-${counter}`;
}

export function SshSessionPickerModal({
  open,
  onOpenChange,
  connection,
  probe: initialProbe,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const [currentProbe, setCurrentProbe] = useState<RemoteMultiplexerProbe | null>(initialProbe);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [customSessionName, setCustomSessionName] = useState("");

  useEffect(() => {
    setCurrentProbe(initialProbe);
  }, [initialProbe]);

  useEffect(() => {
    if (!open) {
      setShowNewInput(false);
      setCustomSessionName("");
      return;
    }
    if (connection) {
      const existing = (currentProbe?.sessions ?? []).map((s) => s.name);
      const base = connection.tmuxSessionName?.trim() || "voktty";
      const suggested = getNextAvailableSessionName(base, existing);
      setCustomSessionName(suggested);
    }
  }, [open, connection, currentProbe]);

  if (!connection || !currentProbe) return null;

  const serverLabel =
    connection.name ||
    `${connection.user ? `${connection.user}@` : ""}${connection.host}`;
  const sessions = currentProbe.sessions;

  const handleSelect = (
    action: "attach" | "attach_force" | "grouped" | "new" | "none",
    sessionName?: string,
  ) => {
    onOpenChange(false);
    onSelect(action, sessionName);
  };

  const handleRefresh = async () => {
    if (!connection || refreshing) return;
    setRefreshing(true);
    try {
      const updated = await probeSshMultiplexer(connection);
      setCurrentProbe(updated);
    } catch {
      // Keep existing probe if refresh fails
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = customSessionName.trim() || connection.tmuxSessionName?.trim() || "voktty";
    handleSelect("new", finalName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl border-border bg-popover text-popover-foreground">
        <DialogHeader className="p-5 pb-3 border-b border-border/40 shrink-0">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2">
              <HugeiconsIcon
                icon={ServerStack03Icon}
                size={18}
                strokeWidth={1.75}
              />
              {t("ssh.sessionPicker.title")}
            </DialogTitle>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title={t("ssh.sessionPicker.refresh")}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 cursor-pointer transition-colors"
            >
              <HugeiconsIcon
                icon={refreshing ? Loading03Icon : RefreshIcon}
                size={14}
                className={refreshing ? "animate-spin text-primary" : ""}
              />
            </button>
          </div>
          <DialogDescription className="text-xs">
            {t("ssh.sessionPicker.description")}{" "}
            <span className="font-mono text-foreground font-semibold">
              {serverLabel}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3.5">
          {sessions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("ssh.sessionPicker.activeSessionsTitle")} ({sessions.length})
              </span>

              {sessions.map((session: RemoteMultiplexerSession) => {
                const isAttached =
                  session.isAttached || session.attachedCount > 0;
                return (
                  <div
                    key={session.name}
                    className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/60 p-3 transition-colors hover:border-border"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex size-7 items-center justify-center rounded-md ${
                            isAttached
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-emerald-500/10 text-emerald-400"
                          }`}
                        >
                          <HugeiconsIcon
                            icon={ComputerTerminal01Icon}
                            size={14}
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-mono font-semibold text-foreground">
                            {session.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {session.windowsCount}{" "}
                            {t("ssh.sessionPicker.windows")} •{" "}
                            {session.multiplexer}
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
                            <HugeiconsIcon
                              icon={CheckmarkCircle02Icon}
                              size={11}
                            />
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
                            onClick={() =>
                              handleSelect("attach_force", session.name)
                            }
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

          <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
            {showNewInput ? (
              <form
                onSubmit={handleCreateSubmit}
                className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-2"
              >
                <Input
                  autoFocus
                  value={customSessionName}
                  onChange={(e) => setCustomSessionName(e.target.value)}
                  placeholder={t("ssh.sessionPicker.customSessionPlaceholder")}
                  className="h-7 text-xs font-mono flex-1"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-7 text-[11px] gap-1 cursor-pointer"
                >
                  <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
                  {t("ssh.sessionPicker.createAndConnect")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] cursor-pointer"
                  onClick={() => setShowNewInput(false)}
                >
                  {t("common.cancel")}
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 justify-start gap-2 text-xs cursor-pointer"
                onClick={() => setShowNewInput(true)}
              >
                <HugeiconsIcon icon={Add01Icon} size={14} />
                <span>{t("ssh.sessionPicker.newSession")}</span>
              </Button>
            )}

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

        <DialogFooter className="p-3.5 px-5 border-t border-border/40 bg-muted/15 shrink-0 flex items-center justify-end">
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
