import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/modules/i18n";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone } from "../chrome/icons";
import {
  type HarnessSessionSnapshot,
  listHarnessSessionSnapshots,
  sendHarnessSessionMessage,
} from "../lib/harnessControlBridge";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BroadcastToAgentsDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<HarnessSessionSnapshot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const snapshots = listHarnessSessionSnapshots();
    setSessions(snapshots);
    setSelected(new Set(snapshots.map((session) => session.sessionId)));
    setText("");
  }, [open]);

  const toggle = (sessionId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  };

  const handleSend = async () => {
    const targets = sessions.filter((session) =>
      selected.has(session.sessionId),
    );
    if (targets.length === 0 || !text.trim()) return;
    setSending(true);
    try {
      const results = await Promise.allSettled(
        targets.map((session) =>
          sendHarnessSessionMessage(session.sessionId, text),
        ),
      );
      const sent = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failed = results.length - sent;
      if (failed === 0) {
        toast.success(t("harness.broadcast.resultAllSent", { count: sent }));
      } else {
        toast.warning(t("harness.broadcast.resultPartial", { sent, failed }));
      }
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg flex flex-col p-6">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Megaphone size={18} strokeWidth={1.9} />
            <DialogTitle className="text-base font-semibold">
              {t("harness.broadcast.title")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("harness.broadcast.description")}
          </DialogDescription>
        </DialogHeader>

        {sessions.length === 0 ? (
          <p className="py-6 text-center text-[11.5px] text-muted-foreground">
            {t("harness.broadcast.noSessions")}
          </p>
        ) : (
          <ScrollArea className="max-h-48 rounded-md border border-border/60">
            <ul className="divide-y divide-border/40">
              {sessions.map((session) => (
                <li
                  key={session.sessionId}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <Checkbox
                    checked={selected.has(session.sessionId)}
                    onCheckedChange={(checked) =>
                      toggle(session.sessionId, checked === true)
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-foreground">
                      {session.title}
                    </div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {session.harness} · {session.cwd}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("harness.broadcast.placeholder")}
          rows={3}
          disabled={sessions.length === 0}
        />

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={sending || selected.size === 0 || !text.trim()}
            onClick={() => void handleSend()}
          >
            {sending ? <Spinner className="size-3.5" /> : null}
            {t("harness.broadcast.send", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
