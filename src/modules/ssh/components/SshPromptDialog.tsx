import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/modules/i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useSyncExternalStore } from "react";
import { currentSshPrompts, subscribeSshPrompts } from "../promptQueue";

type SshPrompt = { id: string; message: string; confirm: boolean };

export function SshPromptDialog() {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<SshPrompt[]>([]);
  const nativePrompts = useSyncExternalStore(subscribeSshPrompts, currentSshPrompts);
  const [answer, setAnswer] = useState("");
  const prompt = prompts[0] ?? nativePrompts[0];

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void listen<SshPrompt>("voktty:ssh-prompt", (event) => {
      if (mounted) setPrompts((current) => [...current, event.payload]);
    }).then((cleanup) => {
      if (mounted) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const respond = (value: string | null) => {
    if (!prompt) return;
    if (prompts.length > 0) {
      void invoke("remote_ssh_prompt_answer", { id: prompt.id, answer: value }).catch(() => undefined);
      setPrompts((current) => current.slice(1));
    } else {
      nativePrompts[0]?.respond(value);
    }
    setAnswer("");
  };

  return (
    <Dialog open={Boolean(prompt)} onOpenChange={(open) => { if (!open) respond(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{prompt?.confirm ? t("ssh.prompt.hostKeyTitle") : t("ssh.prompt.authTitle")}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap break-words">{prompt?.message}</DialogDescription>
        </DialogHeader>
        {!prompt?.confirm && (
          <form onSubmit={(event) => { event.preventDefault(); respond(answer); }}>
            <Input
              type="password"
              autoFocus
              autoComplete="off"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              aria-label={t("ssh.prompt.secretLabel")}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => respond(null)}>{t("common.cancel")}</Button>
              <Button type="submit">{t("common.confirm")}</Button>
            </DialogFooter>
          </form>
        )}
        {prompt?.confirm && (
          <DialogFooter>
            <Button variant="outline" onClick={() => respond(null)}>{t("common.reject")}</Button>
            <Button onClick={() => respond("yes")}>{t("common.accept")}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
