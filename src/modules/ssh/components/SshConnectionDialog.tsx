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
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/modules/i18n";
import {
  ServerStack03Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { SshPromptDialog } from "./SshPromptDialog";
import { addSshConnection, updateSshConnection } from "../sshStore";
import type {
  SshAuthType,
  SshConnection,
  SshProxyConfig,
  SshProxyType,
} from "../types";

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

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [authType, setAuthType] = useState<SshAuthType>("auto");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [identityFile, setIdentityFile] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Proxy state
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyType, setProxyType] = useState<SshProxyType>("http");
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("8080");
  const [proxyUser, setProxyUser] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [showProxyPassword, setShowProxyPassword] = useState(false);

  const [extraArgs, setExtraArgs] = useState("");
  const [initialDirectory, setInitialDirectory] = useState("");
  const [multiplexerMode, setMultiplexerMode] = useState<"none" | "auto" | "ask">("auto");
  const [tmuxSessionName, setTmuxSessionName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (connection) {
      setName(connection.name);
      setHost(connection.host);
      setUser(connection.user ?? "");
      setPort(String(connection.port ?? 22));
      setAuthType(connection.authType ?? "auto");
      setPassword(connection.password ?? "");
      setIdentityFile(connection.identityFile ?? "");
      setPassphrase(connection.passphrase ?? "");
      setProxyEnabled(Boolean(connection.proxy?.enabled));
      setProxyType(connection.proxy?.proxyType ?? "http");
      setProxyHost(connection.proxy?.host ?? "");
      setProxyPort(connection.proxy?.port ? String(connection.proxy.port) : "8080");
      setProxyUser(connection.proxy?.user ?? "");
      setProxyPassword(connection.proxy?.password ?? "");
      setExtraArgs(connection.extraArgs ?? "");
      setInitialDirectory(connection.initialDirectory ?? "");
      setMultiplexerMode(
        connection.multiplexerMode === "none" || connection.multiplexerMode === "ask" || connection.multiplexerMode === "auto"
          ? connection.multiplexerMode
          : "auto",
      );
      setTmuxSessionName(connection.tmuxSessionName ?? "");
    } else {
      setName("");
      setHost("");
      setUser("");
      setPort("22");
      setAuthType("auto");
      setPassword("");
      setIdentityFile("");
      setPassphrase("");
      setProxyEnabled(false);
      setProxyType("http");
      setProxyHost("");
      setProxyPort("8080");
      setProxyUser("");
      setProxyPassword("");
      setExtraArgs("");
      setInitialDirectory("");
      setMultiplexerMode("auto");
      setTmuxSessionName("");
    }
    setShowPassword(false);
    setShowPassphrase(false);
    setShowProxyPassword(false);
    setError(null);
    setTimeout(() => hostInputRef.current?.focus(), 50);
  }, [open, connection]);

  const save = async (autoConnect: boolean) => {
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setError(t("ssh.errors.hostRequired"));
      return;
    }

    const portText = port.trim();
    if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
      setError(t("ssh.errors.invalidPort"));
      return;
    }
    const finalPort = Number(portText);

    let proxyConfig: SshProxyConfig | undefined;
    if (proxyEnabled) {
      const trimmedProxyHost = proxyHost.trim();
      if (!trimmedProxyHost) {
        setError(t("ssh.errors.proxyHostRequired"));
        return;
      }
      const proxyPortText = proxyPort.trim();
      if (!/^\d+$/.test(proxyPortText) || Number(proxyPortText) < 1 || Number(proxyPortText) > 65535) {
        setError(t("ssh.errors.invalidProxyPort"));
        return;
      }
      proxyConfig = {
        enabled: true,
        proxyType,
        host: trimmedProxyHost,
        port: Number(proxyPortText),
        user: proxyUser.trim() || undefined,
        password: proxyPassword.trim() || undefined,
      };
    }

    const finalName = name.trim() || (user.trim() ? `${user.trim()}@${trimmedHost}` : trimmedHost);
    const sanitizedExtraArgs = extraArgs.trim()
      ? extraArgs.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
      : undefined;

    const payload: Omit<SshConnection, "id"> = {
      name: finalName,
      host: trimmedHost,
      user: user.trim() || undefined,
      port: finalPort,
      authType: authType !== "auto" ? authType : undefined,
      password: authType === "password" && password.trim() ? password.trim() : undefined,
      identityFile: (authType === "auto" || authType === "key") && identityFile.trim() ? identityFile.trim() : undefined,
      passphrase: (authType === "auto" || authType === "key") && passphrase.trim() ? passphrase.trim() : undefined,
      proxy: proxyConfig,
      extraArgs: sanitizedExtraArgs,
      initialDirectory: initialDirectory.trim() || undefined,
      multiplexerMode,
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
    <>
    <SshPromptDialog />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl border-border bg-popover text-popover-foreground">
        <DialogHeader className="p-5 pb-3 border-b border-border/40 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={ServerStack03Icon} size={18} strokeWidth={1.75} />
            {connection ? t("ssh.dialog.editTitle") : t("ssh.dialog.newTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("ssh.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
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

            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <Label className="text-[11px] font-medium text-foreground">
                {t("ssh.dialog.authType")}
              </Label>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: "auto", label: t("ssh.dialog.authAuto") },
                    { id: "password", label: t("ssh.dialog.authPassword") },
                    { id: "key", label: t("ssh.dialog.authKey") },
                    { id: "interactive", label: t("ssh.dialog.authInteractive") },
                  ] as const
                ).map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setAuthType(method.id)}
                    className={`rounded-md px-1 py-1.5 text-[10.5px] font-medium cursor-pointer transition-colors text-center border truncate ${
                      authType === method.id
                        ? "bg-secondary text-secondary-foreground border-border shadow-xs"
                        : "bg-transparent hover:bg-muted/60 text-muted-foreground border-transparent"
                    }`}
                    title={method.label}
                  >
                    {method.label}
                  </button>
                ))}
              </div>

              {authType === "password" && (
                <div className="flex flex-col gap-1 pt-1">
                  <Label htmlFor="ssh-password" className="text-[10.5px] text-muted-foreground">
                    {t("ssh.dialog.password")}
                  </Label>
                  <div className="relative flex items-center">
                    <Input
                      id="ssh-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("ssh.dialog.passwordPlaceholder")}
                      className="h-8 text-xs font-mono pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer"
                      tabIndex={-1}
                    >
                      <HugeiconsIcon
                        icon={showPassword ? ViewOffSlashIcon : ViewIcon}
                        size={14}
                      />
                    </button>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {t("ssh.dialog.passwordDescription")}
                  </span>
                </div>
              )}

              {(authType === "auto" || authType === "key") && (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="ssh-key" className="text-[10.5px] text-muted-foreground">
                      {t("ssh.dialog.identityFile")}
                    </Label>
                    <Input
                      id="ssh-key"
                      value={identityFile}
                      onChange={(e) => setIdentityFile(e.target.value)}
                      placeholder="~/.ssh/id_ed25519 or C:/keys/server.pem"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="ssh-passphrase" className="text-[10.5px] text-muted-foreground">
                      {t("ssh.dialog.passphrase")}
                    </Label>
                    <div className="relative flex items-center">
                      <Input
                        id="ssh-passphrase"
                        type={showPassphrase ? "text" : "password"}
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder={t("ssh.dialog.passphrasePlaceholder")}
                        className="h-8 text-xs font-mono pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassphrase(!showPassphrase)}
                        className="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer"
                        tabIndex={-1}
                      >
                        <HugeiconsIcon
                          icon={showPassphrase ? ViewOffSlashIcon : ViewIcon}
                          size={14}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <Label className="text-[11px] font-medium text-foreground">
                    {t("ssh.dialog.proxyTitle")}
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {t("ssh.dialog.proxyEnable")}
                  </span>
                </div>
                <Switch
                  checked={proxyEnabled}
                  onCheckedChange={setProxyEnabled}
                />
              </div>

              {proxyEnabled && (
                <div className="flex flex-col gap-2 pt-1 border-t border-border/40">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10.5px] text-muted-foreground">
                      {t("ssh.dialog.proxyType")}
                    </Label>
                    <div className="grid grid-cols-4 gap-1">
                      {(
                        [
                          { id: "http", label: t("ssh.dialog.proxyHttp") },
                          { id: "https", label: t("ssh.dialog.proxyHttps") },
                          { id: "socks5", label: t("ssh.dialog.proxySocks5") },
                          { id: "socks4", label: t("ssh.dialog.proxySocks4") },
                        ] as const
                      ).map((typeItem) => (
                        <button
                          key={typeItem.id}
                          type="button"
                          onClick={() => setProxyType(typeItem.id)}
                          className={`rounded-md px-1.5 py-1 text-[10.5px] font-medium cursor-pointer transition-colors text-center border truncate ${
                            proxyType === typeItem.id
                              ? "bg-secondary text-secondary-foreground border-border shadow-xs"
                              : "bg-transparent hover:bg-muted/60 text-muted-foreground border-transparent"
                          }`}
                        >
                          {typeItem.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 flex flex-col gap-1">
                      <Label htmlFor="ssh-proxy-host" className="text-[10.5px] text-muted-foreground">
                        {t("ssh.dialog.proxyHost")} *
                      </Label>
                      <Input
                        id="ssh-proxy-host"
                        value={proxyHost}
                        onChange={(e) => setProxyHost(e.target.value)}
                        placeholder="127.0.0.1 / proxy.company.com"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="ssh-proxy-port" className="text-[10.5px] text-muted-foreground">
                        {t("ssh.dialog.proxyPort")}
                      </Label>
                      <Input
                        id="ssh-proxy-port"
                        value={proxyPort}
                        onChange={(e) => setProxyPort(e.target.value)}
                        placeholder={proxyType.startsWith("socks") ? "1080" : "8080"}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="ssh-proxy-user" className="text-[10.5px] text-muted-foreground">
                        {t("ssh.dialog.proxyUser")}
                      </Label>
                      <Input
                        id="ssh-proxy-user"
                        value={proxyUser}
                        onChange={(e) => setProxyUser(e.target.value)}
                        placeholder={t("ssh.dialog.proxyUserPlaceholder")}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="ssh-proxy-password" className="text-[10.5px] text-muted-foreground">
                        {t("ssh.dialog.proxyPassword")}
                      </Label>
                      <div className="relative flex items-center">
                        <Input
                          id="ssh-proxy-password"
                          type={showProxyPassword ? "text" : "password"}
                          value={proxyPassword}
                          onChange={(e) => setProxyPassword(e.target.value)}
                          placeholder={t("ssh.dialog.proxyPasswordPlaceholder")}
                          className="h-8 text-xs font-mono pr-8"
                        />
                        <button
                          type="button"
                          onClick={() => setShowProxyPassword(!showProxyPassword)}
                          className="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer"
                          tabIndex={-1}
                        >
                          <HugeiconsIcon
                            icon={showProxyPassword ? ViewOffSlashIcon : ViewIcon}
                            size={14}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
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
          </div>

          <DialogFooter className="p-3.5 px-5 border-t border-border/40 bg-muted/15 shrink-0 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
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
    </>
  );
}
