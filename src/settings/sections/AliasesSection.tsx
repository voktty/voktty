import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import type { AliasFilter } from "@/modules/aliases/store/aliasStore";
import { useAliasStore } from "@/modules/aliases/store/aliasStore";
import type { ResolvedAlias } from "@/modules/aliases/types";
import {
  Add01Icon,
  CommandLineIcon,
  Delete02Icon,
  Edit01Icon,
  FolderOpenIcon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "../components/SectionHeader";
import { AliasDialog } from "@/modules/aliases/components/AliasDialog";

// ─── Filter tabs ─────────────────────────────────────────────────────────────

const FILTERS: AliasFilter[] = ["all", "factory", "custom", "enabled", "disabled"];

// ─── Main component ───────────────────────────────────────────────────────────

export function AliasesSection() {
  const { t } = useTranslation();
  const {
    effective,
    configPath,
    isLoading,
    searchQuery,
    filter,
    fetchAliases,
    toggleAlias,
    resetAlias,
    deleteAlias,
    setSearchQuery,
    setFilter,
  } = useAliasStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<ResolvedAlias | null>(null);

  useEffect(() => {
    void fetchAliases();
  }, [fetchAliases]);

  // ─── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return effective.filter((a) => {
      const matchesSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.definition.description.toLowerCase().includes(q);

      const matchesFilter =
        filter === "all"
          ? true
          : filter === "factory"
            ? a.source === "preinstalled"
            : filter === "custom"
              ? a.source === "user"
              : filter === "enabled"
                ? a.definition.enabled
                : !a.definition.enabled;

      return matchesSearch && matchesFilter;
    });
  }, [effective, searchQuery, filter]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function openConfigFile() {
    try {
      const p = configPath || (await invoke<string>("aliases_get_config_path"));
      await openPath(p);
    } catch {
      toast.error(t("aliases.errorOpeningFile"));
    }
  }

  function handleNew() {
    setEditingAlias(null);
    setDialogOpen(true);
  }

  function handleEdit(alias: ResolvedAlias) {
    setEditingAlias(alias);
    setDialogOpen(true);
  }

  async function handleToggle(name: string, enabled: boolean) {
    try {
      await toggleAlias(name, enabled);
    } catch {
      toast.error(t("aliases.errorToggling"));
    }
  }

  async function handleReset(name: string) {
    try {
      await resetAlias(name);
      toast.success(t("aliases.resetSuccess"));
    } catch {
      toast.error(t("aliases.errorResetting"));
    }
  }

  async function handleDelete(name: string) {
    try {
      await deleteAlias(name);
      toast.success(t("aliases.deleteSuccess"));
    } catch {
      toast.error(t("aliases.errorDeleting"));
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <SectionHeader
          title={t("aliases.title")}
          description={t("aliases.description")}
        />
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title={t("aliases.openFile")}
            onClick={openConfigFile}
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title={t("aliases.refresh")}
            onClick={() => void fetchAliases()}
          >
            <HugeiconsIcon icon={RefreshIcon} size={13} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1.5 px-2.5"
            onClick={handleNew}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} />
            {t("aliases.newAlias")}
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("aliases.searchPlaceholder")}
            className="pl-8 h-8 text-[12px]"
          />
        </div>

        <div className="flex gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "px-2.5 py-0.5 rounded-full text-[10.5px] font-medium transition-colors cursor-pointer border",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border/50 hover:border-border hover:text-foreground",
              )}
            >
              {t(`aliases.filter.${f}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Alias list */}
      <div className="flex flex-col gap-1.5">
        {isLoading && (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-xl bg-muted/30 border border-border/40 animate-pulse"
              />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <HugeiconsIcon icon={CommandLineIcon} size={24} className="opacity-30" />
            <p className="text-[12px]">{t("aliases.noResults")}</p>
          </div>
        )}

        {!isLoading &&
          filtered.map((alias) => (
            <AliasRow
              key={alias.name}
              alias={alias}
              onToggle={handleToggle}
              onEdit={handleEdit}
              onReset={handleReset}
              onDelete={handleDelete}
            />
          ))}
      </div>

      {/* Dialog */}
      <AliasDialog
        open={dialogOpen}
        alias={editingAlias}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

// ─── AliasRow ─────────────────────────────────────────────────────────────────

function AliasRow({
  alias,
  onToggle,
  onEdit,
  onReset,
  onDelete,
}: {
  alias: ResolvedAlias;
  onToggle: (name: string, enabled: boolean) => void;
  onEdit: (alias: ResolvedAlias) => void;
  onReset: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation();
  const isFactory = alias.source === "preinstalled";
  const isCustom = alias.source === "user";

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors",
        alias.definition.enabled
          ? "border-border/50 bg-card/40 hover:bg-card/70"
          : "border-border/30 bg-muted/10 opacity-60 hover:opacity-80",
      )}
    >
      {/* Icon */}
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        <HugeiconsIcon
          icon={CommandLineIcon}
          size={14}
          className="text-primary/80"
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-semibold font-mono text-foreground truncate">
            {alias.name}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-medium border",
              isFactory
                ? "bg-blue-500/10 text-blue-600 border-blue-400/30 dark:text-blue-400"
                : "bg-violet-500/10 text-violet-600 border-violet-400/30 dark:text-violet-400",
            )}
          >
            {isFactory ? t("aliases.badge.factory") : t("aliases.badge.custom")}
          </span>
        </div>
        <p className="text-[10.5px] text-muted-foreground truncate mt-0.5">
          {alias.definition.description}
        </p>
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          title={t("common.edit")}
          onClick={() => onEdit(alias)}
        >
          <HugeiconsIcon icon={Edit01Icon} size={12} />
        </Button>
        {isCustom && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-destructive"
            title={t("common.delete")}
            onClick={() => onDelete(alias.name)}
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </Button>
        )}
        {isFactory && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            title={t("aliases.reset")}
            onClick={() => onReset(alias.name)}
          >
            <HugeiconsIcon icon={RefreshIcon} size={12} />
          </Button>
        )}
      </div>

      {/* Toggle */}
      <Switch
        checked={alias.definition.enabled}
        onCheckedChange={(checked) => onToggle(alias.name, checked)}
        className="shrink-0"
      />
    </div>
  );
}
