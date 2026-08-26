import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useExtensionStore } from "@/modules/extensions";
import { useTranslation } from "@/modules/i18n";
import {
  AiScanIcon,
  ComputerTerminal02Icon,
  Delete02Icon,
  FolderOpenIcon,
  KeyboardIcon,
  PackageIcon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function ExtensionsSection() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const {
    extensions,
    activeExtensions,
    enabledIds,
    loading,
    init,
    scanExtensions,
    enableExtension,
    disableExtension,
    reloadExtension,
    deleteExtension,
    openFolder,
  } = useExtensionStore();

  useEffect(() => {
    void init();
  }, [init]);

  const filteredExtensions = extensions.filter((ext) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      ext.display_name.toLowerCase().includes(q) ||
      ext.name.toLowerCase().includes(q) ||
      ext.description.toLowerCase().includes(q) ||
      ext.publisher.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title={t("extensions.title")}
          description={t("extensions.description")}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void scanExtensions()}
            disabled={loading}
            className="h-8 gap-1.5 text-xs"
          >
            <HugeiconsIcon icon={RefreshIcon} size={14} className={loading ? "animate-spin" : ""} />
            <span>{t("extensions.reload")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openFolder()}
            className="h-8 gap-1.5 text-xs"
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={14} />
            <span>{t("extensions.openFolder")}</span>
          </Button>
        </div>
      </div>

      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="text"
          placeholder={t("extensions.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-8 text-xs"
        />
      </div>

      {filteredExtensions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 p-8 text-center bg-card/30">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <HugeiconsIcon icon={PackageIcon} size={24} />
          </div>
          <p className="text-sm font-medium text-foreground">
            {extensions.length === 0
              ? t("extensions.noInstalled")
              : t("extensions.noMatches")}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground max-w-md">
            {t("extensions.storageHint")} <code className="font-mono text-foreground">~/.voktty/extensions/</code>. {t("extensions.packageHint")} <code className="font-mono text-foreground">package.json</code>.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openFolder()}
            className="mt-4 h-8 gap-1.5 text-xs"
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={14} />
            <span>{t("extensions.openExtensionsFolder")}</span>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredExtensions.map((ext) => {
            const isEnabled = enabledIds.includes(ext.id);
            const activeInst = activeExtensions[ext.id];
            const hasError = activeInst?.status === "error";

            const commandsCount = ext.contributes.commands?.length ?? 0;
            const aiToolsCount =
              (ext.contributes.agentTools?.length ?? 0) +
              (ext.contributes.aiTools?.length ?? 0);
            const keybindingsCount = ext.contributes.keybindings?.length ?? 0;

            return (
              <div
                key={ext.id}
                className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-border"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                      <HugeiconsIcon icon={PackageIcon} size={20} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {ext.display_name}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                          v{ext.version}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {t("extensions.byPublisher", { publisher: ext.publisher })}
                        </span>
                      </div>
                      {ext.description && (
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          {ext.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isEnabled && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void reloadExtension(ext.id)}
                        title={t("extensions.reloadExtension")}
                        className="size-8 text-muted-foreground hover:text-foreground"
                      >
                        <HugeiconsIcon icon={RefreshIcon} size={15} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void deleteExtension(ext.id)}
                      title={t("extensions.removeExtension")}
                      className="size-8 text-muted-foreground hover:text-destructive"
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={15} />
                    </Button>
                    <Switch
                      checked={isEnabled}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          void enableExtension(ext.id);
                        } else {
                          void disableExtension(ext.id);
                        }
                      }}
                    />
                  </div>
                </div>

                {hasError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
                    {t("extensions.loadError")}: {activeInst.error}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                  {commandsCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted/50 px-2 py-0.5">
                      <HugeiconsIcon icon={ComputerTerminal02Icon} size={12} />
                      {t("extensions.commandsCount", { count: commandsCount })}
                    </span>
                  )}
                  {aiToolsCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-2 py-0.5">
                      <HugeiconsIcon icon={AiScanIcon} size={12} />
                      {t("extensions.toolsCount", { count: aiToolsCount })}
                    </span>
                  )}
                  {keybindingsCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted/50 px-2 py-0.5">
                      <HugeiconsIcon icon={KeyboardIcon} size={12} />
                      {t("extensions.shortcutsCount", { count: keybindingsCount })}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60 truncate max-w-xs">
                    {ext.id}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
