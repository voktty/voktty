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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/modules/i18n";
import { mcpServerSchema } from "@/modules/mcp/mcp.schema";
import type { McpAuthMode, McpServerConfig } from "@/modules/mcp/types";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  config: McpServerConfig | null;
  credentialStored: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: McpServerConfig, bearerToken?: string) => Promise<void>;
};

type TransportKind = "stdio" | "http";

export function McpServerForm({
  open,
  config,
  credentialStored,
  onOpenChange,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [transportKind, setTransportKind] = useState<TransportKind>("stdio");
  const [authMode, setAuthMode] = useState<McpAuthMode>("none");
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [authorizedRoot, setAuthorizedRoot] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  const [bearerToken, setBearerToken] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthScopes, setOauthScopes] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(config?.name ?? "");
    setId(config?.id ?? "");
    setTransportKind(config?.transport.kind ?? "stdio");
    setAuthMode(config?.authMode ?? "none");
    setExecutable(config?.transport.kind === "stdio" ? config.transport.executable : "");
    setArgs(config?.transport.kind === "stdio" ? config.transport.args.join("\n") : "");
    setCwd(config?.transport.kind === "stdio" ? config.transport.cwd : "");
    setAuthorizedRoot(
      config?.transport.kind === "stdio" ? config.transport.authorizedRoot : "",
    );
    setEndpoint(config?.transport.kind === "http" ? config.transport.endpoint : "");
    setAllowPrivateNetwork(
      config?.transport.kind === "http" && config.transport.allowPrivateNetwork,
    );
    setBearerToken("");
    setOauthClientId(config?.oauthClientId ?? "");
    setOauthScopes(config?.oauthScopes?.join(" ") ?? "");
    setInvalid(false);
  }, [config, open]);

  const submit = async () => {
    const candidate: McpServerConfig =
      transportKind === "stdio"
        ? {
            id,
            name,
            enabled: config?.enabled ?? false,
            authMode: "none",
            transport: {
              kind: "stdio",
              executable,
              args: args
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
              cwd,
              authorizedRoot,
            },
          }
        : {
            id,
            name,
            enabled: config?.enabled ?? false,
            authMode,
            ...(authMode === "oauth"
              ? {
                  oauthClientId,
                  oauthScopes: oauthScopes.split(/\s+/).filter(Boolean),
                }
              : {}),
            transport: { kind: "http", endpoint, allowPrivateNetwork },
          };
    if (!mcpServerSchema.safeParse(candidate).success) {
      setInvalid(true);
      return;
    }
    setSaving(true);
    setInvalid(false);
    try {
      await onSave(candidate, bearerToken || undefined);
      onOpenChange(false);
    } catch {
      // The section surfaces the localized native error state.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(config ? "settings.mcp.form.editTitle" : "settings.mcp.form.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("settings.mcp.form.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.mcp.form.name")} htmlFor="mcp-name">
              <Input id="mcp-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t("settings.mcp.form.id")} htmlFor="mcp-id">
              <Input
                id="mcp-id"
                value={id}
                disabled={Boolean(config)}
                onChange={(event) => setId(event.target.value)}
                placeholder={t("settings.mcp.form.idPlaceholder")}
                className="font-mono"
              />
            </Field>
          </div>

          <Field label={t("settings.mcp.form.transport")} htmlFor="mcp-transport">
            <Select
              value={transportKind}
              onValueChange={(value) => {
                const kind = value as TransportKind;
                setTransportKind(kind);
                if (kind === "stdio") setAuthMode("none");
              }}
            >
              <SelectTrigger id="mcp-transport" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">{t("settings.mcp.transport.stdio")}</SelectItem>
                <SelectItem value="http">{t("settings.mcp.transport.http")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {transportKind === "stdio" ? (
            <>
              <Field label={t("settings.mcp.form.executable")} htmlFor="mcp-executable">
                <Input
                  id="mcp-executable"
                  value={executable}
                  onChange={(event) => setExecutable(event.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t("settings.mcp.form.args")} htmlFor="mcp-args">
                <Textarea
                  id="mcp-args"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  className="min-h-20 font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("settings.mcp.form.argsHint")}
                </p>
              </Field>
              <Field label={t("settings.mcp.form.cwd")} htmlFor="mcp-cwd">
                <Input
                  id="mcp-cwd"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t("settings.mcp.form.authorizedRoot")} htmlFor="mcp-root">
                <Input
                  id="mcp-root"
                  value={authorizedRoot}
                  onChange={(event) => setAuthorizedRoot(event.target.value)}
                  className="font-mono"
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("settings.mcp.form.endpoint")} htmlFor="mcp-endpoint">
                <Input
                  id="mcp-endpoint"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://mcp.example.com"
                  className="font-mono"
                />
              </Field>
              <Field label={t("settings.mcp.form.authMode")} htmlFor="mcp-auth">
                <Select value={authMode} onValueChange={(value) => setAuthMode(value as McpAuthMode)}>
                  <SelectTrigger id="mcp-auth" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("settings.mcp.auth.none")}</SelectItem>
                    <SelectItem value="bearer">{t("settings.mcp.auth.bearer")}</SelectItem>
                    <SelectItem value="oauth">{t("settings.mcp.auth.oauth")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {authMode === "bearer" ? (
                <Field label={t("settings.mcp.form.bearerToken")} htmlFor="mcp-token">
                  <Input
                    id="mcp-token"
                    type="password"
                    autoComplete="off"
                    value={bearerToken}
                    onChange={(event) => setBearerToken(event.target.value)}
                    placeholder={
                      credentialStored
                        ? t("settings.mcp.form.credentialStored")
                        : t("settings.mcp.form.bearerPlaceholder")
                    }
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {t("settings.mcp.form.secretHint")}
                  </p>
                </Field>
              ) : null}
              {authMode === "oauth" ? (
                <div className="grid gap-3 rounded-lg border border-border/50 bg-muted/20 p-3">
                  <Field label={t("settings.mcp.form.oauthClientId")} htmlFor="mcp-oauth-client">
                    <Input
                      id="mcp-oauth-client"
                      value={oauthClientId}
                      onChange={(event) => setOauthClientId(event.target.value)}
                      className="font-mono"
                    />
                  </Field>
                  <Field label={t("settings.mcp.form.oauthScopes")} htmlFor="mcp-oauth-scopes">
                    <Input
                      id="mcp-oauth-scopes"
                      value={oauthScopes}
                      onChange={(event) => setOauthScopes(event.target.value)}
                      className="font-mono"
                    />
                  </Field>
                  <p className="text-[10px] text-muted-foreground">
                    {t("settings.mcp.form.oauthHint")}
                  </p>
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                <div>
                  <Label htmlFor="mcp-private">{t("settings.mcp.form.privateNetwork")}</Label>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {t("settings.mcp.form.privateNetworkHint")}
                  </p>
                </div>
                <Switch
                  id="mcp-private"
                  checked={allowPrivateNetwork}
                  onCheckedChange={setAllowPrivateNetwork}
                />
              </div>
            </>
          )}

          {invalid ? (
            <p role="alert" className="text-xs text-destructive">
              {t("settings.mcp.form.invalid")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? t("dialog.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
