import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import { useMcpStore } from "@/modules/mcp";
import type { McpServerConfig } from "@/modules/mcp/types";
import { Add01Icon, ServerStack03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { McpServerCard } from "../components/McpServerCard";
import { McpServerForm } from "../components/McpServerForm";
import { SectionHeader } from "../components/SectionHeader";

export function McpSection() {
  const { t } = useTranslation();
  const store = useMcpStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    void store.init();
  }, [store.init]);

  const openForm = (config: McpServerConfig | null) => {
    store.clearError();
    setEditing(config);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title={t("settings.mcp.title")} description={t("settings.mcp.description")} />
        <Button size="sm" onClick={() => openForm(null)}>
          <HugeiconsIcon icon={Add01Icon} size={13} />
          {t("settings.mcp.addServer")}
        </Button>
      </div>

      {store.errorKind ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {t(`settings.mcp.errors.${store.errorKind}`)}
        </div>
      ) : null}

      {store.loading ? (
        <div className="rounded-xl border border-border/40 bg-card/40 p-6 text-center text-xs text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : store.configs.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-10 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted/60">
            <HugeiconsIcon icon={ServerStack03Icon} size={20} />
          </div>
          <h2 className="text-sm font-semibold">{t("settings.mcp.empty.title")}</h2>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {t("settings.mcp.empty.description")}
          </p>
          <Button className="mt-4" size="sm" onClick={() => openForm(null)}>
            {t("settings.mcp.addServer")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {store.configs.map((config) => (
            <McpServerCard
              key={config.id}
              config={config}
              view={store.views[config.id]}
              credentials={store.credentials[config.id]}
              busy={store.busyIds.includes(config.id)}
              onEdit={() => openForm(config)}
              onEnabledChange={(enabled) => store.setEnabled(config.id, enabled)}
              onAutomaticReadChange={(toolName, enabled) =>
                store.setAutomaticRead(config.id, toolName, enabled)
              }
              onConnect={() => store.connect(config.id)}
              onDisconnect={() => store.disconnect(config.id)}
              onRestart={() => store.restart(config.id)}
              onRevoke={() => store.revokeCredentials(config.id)}
              onAuthorize={() => store.authorizeOAuth(config.id)}
              onRemove={() => store.removeServer(config.id)}
            />
          ))}
        </div>
      )}

      <McpServerForm
        open={formOpen}
        config={editing}
        credentialStored={
          editing?.authMode === "bearer" && Boolean(store.credentials[editing.id]?.bearer)
        }
        onOpenChange={setFormOpen}
        onSave={store.saveServer}
      />
    </div>
  );
}
