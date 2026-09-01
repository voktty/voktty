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
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/modules/i18n";
import { useVaultStore } from "@/modules/vault";
import { Key01Icon, ServerStack03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addSshConnection, updateSshConnection } from "../sshStore";
import type { SshConnection } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: SshConnection | null;
  onSaved?: (conn: SshConnection, autoConnect: boolean) => void;
};

export function SshConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const { isUnlocked, items: vaultItems } = useVaultStore();

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [extraArgs, setExtraArgs] = useState("");
  const [initialDirectory, setInitialDirectory] = useState("");
  const [multiplexerMode, setMultiplexerMode] = useState<"none" | "auto" | "ask">("none");
  const [tmuxSessionName, setTmuxSessionName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);

  const vaultSshKeys = useMemo(() => {
    return vaultItems.filter((item) => item.type === "ssh_key");
  }, [vaultItems]);

  useEffect(() => {
    if (!open) return;
    if (connection) {
      setName(connection.name);
      setHost(connection.host);
      setUser(connection.user ?? "");
      setPort(String(connection.port ?? 22));
      setIdentityFile(connection.identityFile ?? "");
      setExtraArgs(connection.extraArgs ?? "");
      setInitialDirectory(connection.initialDirectory ?? "");
      setMultiplexerMode(
        connection.multiplexerMode === "ask" || connection.multiplexerMode === "auto"
          ? connection.multiplexerMode
          : "none",
      );
      setTmuxSessionName(connection.tmuxSessionName ?? "");
    } else {
      setName("");
      setHost("");
      setUser("");
      setPort("22");
      setIdentityFile("");
      setExtraArgs("");
      setInitialDirectory("");
      setMultiplexerMode("none");
      setTmuxSessionName("");
    }
    setError(null);
    setTimeout(() => hostInputRef.current?.focus(), 50);
  }, [open, connection]);

  const save = async (autoConnect: boolean) => {
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setError(t("ssh.errors.hostRequired"));
      return;
    }

    const parsedPort = parseInt(port.trim(), 10);
    const finalPort = !Number.isNaN(parsedPort) && parsedPort > 0 ? parsedPort : 22;
    const finalName = name.trim() || (user.trim() ? `${user.trim()}@${trimmedHost}` : trimmedHost);
    const sanitizedExtraArgs = extraArgs.trim()
      ? extraArgs.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
      : undefined;

    const payload: Omit<SshConnection, "id"> = {
      name: finalName,
      host: trimmedHost,
      user: user.trim() || undefined,
      port: finalPort,
      identityFile: identityFile.trim() || undefined,
      extraArgs: sanitizedExtraArgs,
      initialDirectory: initialDirectory.trim() || undefined,
      multiplexerMode: multiplexerMode !== "none" ? multiplexerMode : undefined,
      tmuxSessionName: tmuxSessionName.trim() || undefined,
    };

    try {
      let saved: SshConnection;
      if (connection) {
        await updateSshConnection(connection.id, payload);
        saved = { ...payload, id: connection.id };
      } else {
        saved = await addSshConnection(payload);
      }
      onOpenChange(false);
      onSaved?.(saved, autoConnect);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleOrAppendArg = (arg: string) => {
    setExtraArgs((prev) => {
      const current = prev.trim();
      if (!current) return arg;
      if (current.includes(arg)) {
        return current.replace(arg, "").replace(/\s+/g, " ").trim();
      }
      return `${current} ${arg}`.trim();
    });
  };

  const handleToggleBypassHostKey = () => {
    const bypassFlags = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null";
    setExtraArgs((prev) => {
      const current = prev.trim();
      if (current.includes("StrictHostKeyChecking=no")) {
        return current
          .replace(/-o\s+StrictHostKeyChecking=no/g, "")
          .replace(/-o\s+UserKnownHostsFile=\/dev\/null/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }
      return current ? `${current} ${bypassFlags}` : bypassFlags;
    });
  };

  const handleAddHostKeyAlias = () => {
    const alias = name.trim() || host.trim() || "alias";
    const flag = `-o HostKeyAlias=${alias}`;
    setExtraArgs((prev) => {
      const current = prev.trim();
      if (current.includes("HostKeyAlias=")) {
        return current.replace(/-o\s+HostKeyAlias=[^\s]+/g, flag).trim();
      }
      return current ? `${current} ${flag}` : flag;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={ServerStack03Icon} size={18} strokeWidth={1.75} />
            {connection ? t("ssh.dialog.editTitle") : t("ssh.dialog.newTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("ssh.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="ssh-host" className="text-[11px] text-muted-foreground">
                {t("ssh.dialog.host")} *
              </Label>
              <Input
                id="ssh-host"
                ref={hostInputRef}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100 / server.com"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ssh-port" className="text-[11px] text-muted-foreground">
                {t("ssh.dialog.port")}
              </Label>
              <Input
                id="ssh-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ssh-name" className="text-[11px] text-muted-foreground">
                {t("ssh.dialog.name")}
              </Label>
              <Input
                id="ssh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("ssh.dialog.namePlaceholder")}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ssh-user" className="text-[11px] text-muted-foreground">
                {t("ssh.dialog.user")}
              </Label>
              <Input
                id="ssh-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="root / ubuntu"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ssh-key" className="text-[11px] text-muted-foreground">
              {t("ssh.dialog.identityFile")}
            </Label>
            <Input
              id="ssh-key"
              value={identityFile}
              onChange={(e) => setIdentityFile(e.target.value)}
              placeholder="~/.ssh/id_ed25519 or C:/keys/server.pem"
              className="h-8 text-xs font-mono"
            />
            {isUnlocked && vaultSshKeys.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-1">
                <span className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                  <HugeiconsIcon icon={Key01Icon} size={11} />
                  {t("ssh.dialog.fromVault")}:
                </span>
                {vaultSshKeys.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setIdentityFile(`~/.ssh/${k.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`)}
                    className="rounded bg-muted/70 hover:bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground cursor-pointer transition-colors"
                  >
                    {k.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="ssh-args" className="text-[11px] text-muted-foreground">
                {t("ssh.dialog.extraArgs")}
              </Label>
              <span className="text-[10px] text-muted-foreground/70">
                {t("ssh.dialog.extraArgsHint")}
              </span>
            </div>
            <textarea
              id="ssh-args"
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              placeholder={t("ssh.dialog.extraArgsPlaceholder")}
              rows={2}
              className="w-full resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs font-mono shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[10px] text-muted-foreground">
                {t("ssh.dialog.quickPresets")}
              </span>
              <button
                type="button"
                onClick={handleToggleBypassHostKey}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                  extraArgs.includes("StrictHostKeyChecking=no")
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    : "bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
              >
                {t("ssh.dialog.presetBypassHostKey")}
              </button>
              <button
                type="button"
                onClick={handleAddHostKeyAlias}
                className="rounded bg-muted/70 hover:bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                title={`-o HostKeyAlias=${name.trim() || host.trim() || "alias"}`}
              >
                +{t("ssh.dialog.presetHostKeyAlias")}
              </button>
              <button
                type="button"
                onClick={() => toggleOrAppendArg("-o LogLevel=ERROR")}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                  extraArgs.includes("LogLevel=ERROR")
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : "bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title="-o LogLevel=ERROR"
              >
                {t("ssh.dialog.presetLogLevelError")}
              </button>
              <button
                type="button"
                onClick={() => toggleOrAppendArg("-A")}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                  extraArgs.split(/\s+/).includes("-A")
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title="-A (ForwardAgent yes)"
              >
                -A
              </button>
              <button
                type="button"
                onClick={() => toggleOrAppendArg("-C")}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                  extraArgs.split(/\s+/).includes("-C")
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title="-C (Compression yes)"
              >
                -C
              </button>
            </div>
            <span className="text-[10px] leading-relaxed text-muted-foreground">
              {t("ssh.dialog.extraArgsDescription")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-medium text-foreground">
                {t("ssh.dialog.multiplexerTitle")}
              </Label>
              <span className="text-[10px] font-mono text-muted-foreground/70">
                {t("ssh.dialog.multiplexerBadge")}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t("ssh.dialog.multiplexerDescription")}
            </p>
            <div className="grid grid-cols-3 gap-1 pt-1">
              <button
                type="button"
                onClick={() => setMultiplexerMode("none")}
                className={`rounded-md px-2 py-1.5 text-xs font-medium cursor-pointer transition-colors text-center border ${
                  multiplexerMode === "none"
                    ? "bg-secondary text-secondary-foreground border-border shadow-xs"
                    : "bg-transparent hover:bg-muted/60 text-muted-foreground border-transparent"
                }`}
              >
                {t("ssh.dialog.multiplexerDisabled")}
              </button>
              <button
                type="button"
                onClick={() => setMultiplexerMode("auto")}
                className={`rounded-md px-2 py-1.5 text-xs font-medium cursor-pointer transition-colors text-center border ${
                  multiplexerMode === "auto"
                    ? "bg-secondary text-secondary-foreground border-border shadow-xs"
                    : "bg-transparent hover:bg-muted/60 text-muted-foreground border-transparent"
                }`}
              >
                {t("ssh.dialog.multiplexerAuto")}
              </button>
              <button
                type="button"
                onClick={() => setMultiplexerMode("ask")}
                className={`rounded-md px-2 py-1.5 text-xs font-medium cursor-pointer transition-colors text-center border ${
                  multiplexerMode === "ask"
                    ? "bg-secondary text-secondary-foreground border-border shadow-xs"
                    : "bg-transparent hover:bg-muted/60 text-muted-foreground border-transparent"
                }`}
              >
                {t("ssh.dialog.multiplexerAsk")}
              </button>
            </div>
            {multiplexerMode !== "none" && (
              <div className="flex flex-col gap-1 pt-1">
                <Label htmlFor="ssh-tmux-name" className="text-[10.5px] text-muted-foreground">
                  {t("ssh.dialog.tmuxSessionName")}
                </Label>
                <Input
                  id="ssh-tmux-name"
                  value={tmuxSessionName}
                  onChange={(e) => setTmuxSessionName(e.target.value)}
                  placeholder={name.trim() ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") : "voktty"}
                  className="h-7 text-xs font-mono"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ssh-initial-directory" className="text-[11px] text-muted-foreground">
              {t("ssh.dialog.initialDirectory")}
            </Label>
            <Input
              id="ssh-initial-directory"
              value={initialDirectory}
              onChange={(e) => setInitialDirectory(e.target.value)}
              placeholder="/srv/project or ~/project"
              className="h-8 text-xs font-mono"
            />
            <span className="text-[10px] leading-relaxed text-muted-foreground">
              {t("ssh.dialog.initialDirectoryDescription")}
            </span>
          </div>

          {error && (
            <div className="text-[11px] text-destructive">
              {error}
            </div>
          )}

          <DialogFooter className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void save(false)}
            >
              {t("common.save")}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void save(true)}
            >
              {t("ssh.dialog.saveAndConnect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
