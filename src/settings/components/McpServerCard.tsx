import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/modules/i18n";
import type {
  McpCredentialStatus,
  McpServerConfig,
  McpServerView,
} from "@/modules/mcp/types";

type Props = {
  config: McpServerConfig;
  view: McpServerView | undefined;
  credentials: McpCredentialStatus | undefined;
  busy: boolean;
  onEdit: () => void;
  onEnabledChange: (enabled: boolean) => Promise<void>;
  onAutomaticReadChange: (toolName: string, enabled: boolean) => Promise<void>;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRestart: () => Promise<void>;
  onRevoke: () => Promise<void>;
  onAuthorize: () => Promise<void>;
  onRemove: () => Promise<void>;
};

export function McpServerCard(props: Props) {
  const { t } = useTranslation();
  const { config, view, credentials, busy } = props;
  const phase = view?.phase ?? (config.enabled ? "disconnected" : "disabled");
  const hasCredential =
    config.authMode === "bearer" ? credentials?.bearer : credentials?.oauth;

  return (
    <article className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{config.name}</h2>
            <Badge variant={phase === "error" ? "destructive" : "outline"}>
              {t(`settings.mcp.phase.${phase}`)}
            </Badge>
            <Badge variant="secondary">{t(`settings.mcp.transport.${config.transport.kind}`)}</Badge>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {config.transport.kind === "http" ? config.transport.endpoint : config.transport.executable}
          </p>
        </div>
        <Switch
          checked={config.enabled}
          disabled={busy}
          aria-label={t("settings.mcp.actions.enable")}
          onCheckedChange={(enabled) => void props.onEnabledChange(enabled).catch(() => {})}
        />
      </div>

      {view?.errorKind ? (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          {t(`settings.mcp.errors.${view.errorKind}`)}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
        {view?.protocolVersion ? <Badge variant="outline">MCP {view.protocolVersion}</Badge> : null}
        {view?.capabilities.map((capability) => (
          <Badge key={capability} variant="secondary">
            {t(`settings.mcp.capabilities.${capability}`)}
          </Badge>
        ))}
        {view?.permissions.map((permission) => (
          <Badge key={permission} variant="outline">
            {t(`settings.mcp.effects.${permission}`)}
          </Badge>
        ))}
      </div>

      {view?.scope ? (
        <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
          {t("settings.mcp.scope")}: {view.scope}
        </p>
      ) : null}

      {config.authMode !== "none" ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {hasCredential
            ? t("settings.mcp.credentials.stored")
            : t("settings.mcp.credentials.missing")}
        </p>
      ) : null}

      {view?.tools.length ? (
        <details className="mt-3 rounded-lg border border-border/40 bg-muted/10 p-2.5">
          <summary className="cursor-pointer text-xs font-medium">
            {t("settings.mcp.tools.title", { count: view.tools.length })}
          </summary>
          <div className="mt-2 grid gap-2">
            {view.tools.map((tool) => (
              <div key={tool.namespacedName} className="rounded-md border border-border/30 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px]">{tool.title ?? tool.name}</span>
                  {tool.effects.map((effect) => (
                    <Badge key={effect} variant="outline" className="h-4 px-1.5 text-[9px]">
                      {t(`settings.mcp.effects.${effect}`)}
                    </Badge>
                  ))}
                  {tool.effects.length === 1 && tool.effects[0] === "read" ? (
                    <div className="ml-auto flex items-center gap-1.5 text-[9px] text-muted-foreground">
                      <span>{t("settings.mcp.tools.automaticRead")}</span>
                      <Switch
                        checked={config.automaticReadTools?.includes(tool.name) ?? false}
                        disabled={busy}
                        aria-label={t("settings.mcp.tools.automaticRead")}
                        onCheckedChange={(enabled) =>
                          void props.onAutomaticReadChange(tool.name, enabled).catch(() => {})
                        }
                      />
                    </div>
                  ) : null}
                </div>
                {tool.description ? (
                  <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                    {tool.description}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {view?.resources.length ? (
        <details className="mt-3 rounded-lg border border-border/40 bg-muted/10 p-2.5">
          <summary className="cursor-pointer text-xs font-medium">
            {t("settings.mcp.resources.title", { count: view.resources.length })}
          </summary>
          <div className="mt-2 grid gap-2">
            {view.resources.map((resource) => (
              <div key={resource.name} className="rounded-md border border-border/30 p-2">
                <span className="font-mono text-[11px]">
                  {resource.title ?? resource.name}
                </span>
                {resource.description ? (
                  <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                    {resource.description}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {view?.prompts.length ? (
        <details className="mt-3 rounded-lg border border-border/40 bg-muted/10 p-2.5">
          <summary className="cursor-pointer text-xs font-medium">
            {t("settings.mcp.prompts.title", { count: view.prompts.length })}
          </summary>
          <div className="mt-2 grid gap-2">
            {view.prompts.map((prompt) => (
              <div key={prompt.name} className="rounded-md border border-border/30 p-2">
                <span className="font-mono text-[11px]">{prompt.title ?? prompt.name}</span>
                {prompt.description ? (
                  <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                    {prompt.description}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {config.enabled && phase !== "connected" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void props.onConnect().catch(() => {})}>
            {t("settings.mcp.actions.connect")}
          </Button>
        ) : null}
        {phase === "connected" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void props.onDisconnect().catch(() => {})}>
            {t("settings.mcp.actions.disconnect")}
          </Button>
        ) : null}
        {config.enabled ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void props.onRestart().catch(() => {})}>
            {t("settings.mcp.actions.restart")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={props.onEdit}>
          {t("common.edit")}
        </Button>
        {config.authMode !== "none" && hasCredential ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void props.onRevoke().catch(() => {})}>
            {t("settings.mcp.actions.revoke")}
          </Button>
        ) : null}
        {config.authMode === "oauth" && config.enabled && !hasCredential ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void props.onAuthorize().catch(() => {})}>
            {t("settings.mcp.actions.authorize")}
          </Button>
        ) : null}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" disabled={busy} className="text-destructive">
              {t("common.delete")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("settings.mcp.delete.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.mcp.delete.description", { name: config.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void props.onRemove().catch(() => {})}>
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}
