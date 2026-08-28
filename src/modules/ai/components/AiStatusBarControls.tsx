import { useTranslation } from "@/modules/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAgentHistoryStore } from "@/modules/agent-history";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  Add01Icon,
  AiBookIcon,
  AppleIcon,
  ArrowDown01Icon,
  ArrowUpIcon,
  BrainIcon,
  ChatGptIcon,
  ClaudeIcon,
  Clock01Icon,
  CoinsDollarIcon,
  ComputerIcon,
  CpuIcon,
  DeepseekIcon,
  FavouriteIcon,
  FlashIcon,
  GlobeIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  MistralIcon,
  Mic01Icon,
  PlugIcon,
  ServerStack01Icon,
  Search01Icon,
  StarIcon,
  StopCircleIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  compatModelIdForEndpoint,
  getCompatModelInfo,
  getModel,
  isCompatModelId,
  MODELS,
  PROVIDERS,
  STT_PROVIDER_LABELS,
  type CustomEndpoint,
  type ModelCapabilities,
  type ModelId,
  type ModelInfo,
  type ProviderId,
} from "../config";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import { getLocalizedModelDescription } from "../lib/modelDisplay";
import { toggleFavoriteModel } from "../lib/modelPrefs";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ProviderKeys } from "../lib/keyring";

function isProviderActive(
  id: ProviderId,
  apiKeys: ProviderKeys,
  prefs: {
    lmstudioModelId?: string;
    mlxModelId?: string;
    ollamaModelId?: string;
    openrouterModelId?: string;
    openaiCompatibleBaseURL?: string;
    openaiCompatibleModelId?: string;
    customEndpoints?: readonly CustomEndpoint[];
  },
): boolean {
  if (id === "openrouter") {
    return !!apiKeys[id] && !!prefs.openrouterModelId?.trim();
  }
  if (id === "ollama") {
    return !!prefs.ollamaModelId?.trim();
  }
  if (id === "lmstudio") {
    return !!prefs.lmstudioModelId?.trim();
  }
  if (id === "mlx") {
    return !!prefs.mlxModelId?.trim();
  }
  if (id === "openai-compatible") {
    return (
      (prefs.customEndpoints && prefs.customEndpoints.length > 0) ||
      (!!prefs.openaiCompatibleBaseURL?.trim() &&
        !!prefs.openaiCompatibleModelId?.trim())
    );
  }
  return !!apiKeys[id];
}

const PROVIDER_ICON = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: MistralIcon,
  openrouter: GlobeIcon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
  mlx: AppleIcon,
  ollama: ServerStack01Icon,
} as const satisfies Record<ProviderId, typeof ChatGptIcon>;

export function AiOpenButton({
  onOpen,
  open = false,
}: {
  onOpen: () => void;
  open?: boolean;
}) {
  const { t } = useTranslation();
  const label = open ? t("ai.closePanel") : t("ai.openAgent");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-5.5 items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 text-[10.5px]",
        "text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground",
        "animate-in slide-in-from-top-2 duration-200 ease-out",
      )}
      title={label}
    >
      <span>{label}</span>
      <Kbd className="h-3.5 min-w-3.5 px-0.5 text-[9px]">{fmtShortcut(MOD_KEY, "I")}</Kbd>
    </button>
  );
}

export function AiStatusBarControls({
  hidePanelClose = false,
  compact = false,
}: {
  hidePanelClose?: boolean;
  compact?: boolean;
} = {}) {
  const { t } = useTranslation();
  const c = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closePanel = useChatStore((s) => s.closePanel);

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          void c.addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <IconBtn
        title={t("ai.attachFile")}
        onClick={() => fileInputRef.current?.click()}
        disabled={c.isBusy}
      >
        <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
      </IconBtn>

      {c.voice.supported && (
        <IconBtn
          title={
            !c.voice.hasKey
              ? t("ai.voiceNeedsKey", {
                  provider: STT_PROVIDER_LABELS[c.voice.sttProvider],
                })
              : c.voice.recording
                ? t("ai.stopTranscribe")
                : c.voice.transcribing
                  ? t("ai.transcribing")
                  : t("ai.composerVoice")
          }
          onClick={() =>
            c.voice.recording ? c.voice.stop() : void c.voice.start()
          }
          disabled={c.isBusy || c.voice.transcribing || !c.voice.hasKey}
          className={cn(
            c.voice.recording &&
              "bg-destructive/10 text-destructive hover:bg-destructive/15",
          )}
        >
          {c.voice.recording ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : c.voice.transcribing ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.75} />
          )}
        </IconBtn>
      )}

      <ModelDropdown compact={compact} />

      <IconBtn
        title={t("agentHistory.shortcutTooltip", { shortcut: "Ctrl+Shift+H" })}
        onClick={() => useAgentHistoryStore.getState().openHistory()}
      >
        <HugeiconsIcon icon={Clock01Icon} size={13} strokeWidth={1.75} />
      </IconBtn>

      {!hidePanelClose && (
        <>
          <span className="mx-1 h-8 w-px bg-border" aria-hidden />
          <Button
            onClick={closePanel}
            title={t("ai.closePanel")}
            size="xs"
            variant="ghost"
            aria-label={t("ai.closePanel")}
            className="px-1 text-[11px] text-foreground/85"
          >
            <Kbd className="h-4 gap-px px-2 font-mono text-[11px]">
              {fmtShortcut(MOD_KEY, "I")}
            </Kbd>
          </Button>
        </>
      )}
      {c.isBusy ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={c.stop}
          className="size-6"
          aria-label={t("ai.stop")}
          title={t("ai.stop")}
        >
          <HugeiconsIcon icon={StopCircleIcon} size={13} strokeWidth={1.75} />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={c.submit}
          disabled={!c.canSend}
          className="h-5.5 w-7.5 ml-1"
          aria-label={t("ai.send")}
          title={t("ai.sendEnter")}
        >
          <HugeiconsIcon icon={ArrowUpIcon} size={13} strokeWidth={1.75} />
        </Button>
      )}
    </div>
  );
}

type Tab = "all" | "favorites" | "recent";

function ModelDropdown({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const selected = useChatStore((s) => s.selectedModelId);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setSelected = useChatStore((s) => s.setSelectedModelId);
  const favoriteIds = usePreferencesStore((s) => s.favoriteModelIds);
  const recentIds = usePreferencesStore((s) => s.recentModelIds);
  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const openrouterModelId = usePreferencesStore((s) => s.openrouterModelId);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  const configuredProviders = useMemo(() => {
    return PROVIDERS.filter((p) => {
      if (p.id === "openai-compatible") return false;
      return isProviderActive(p.id, apiKeys, {
        lmstudioModelId,
        mlxModelId,
        ollamaModelId,
        openrouterModelId,
      });
    });
  }, [apiKeys, lmstudioModelId, mlxModelId, ollamaModelId, openrouterModelId]);

  const epModelInfos = useMemo(() => {
    return customEndpoints.map((ep) =>
      getCompatModelInfo(compatModelIdForEndpoint(ep.id), customEndpoints),
    );
  }, [customEndpoints]);

  const allModels = useMemo(() => {
    const configuredSet = new Set(configuredProviders.map((p) => p.id));
    const models = MODELS.filter((m) => configuredSet.has(m.provider)).map(
      (m) => {
        if (m.provider === "ollama" && ollamaModelId?.trim()) {
          return {
            ...m,
            label: t("settings.models.localProviderLabel.ollama", {
              model: ollamaModelId.trim(),
            }),
            hint: ollamaModelId.trim(),
          };
        }
        if (m.provider === "lmstudio" && lmstudioModelId?.trim()) {
          return {
            ...m,
            label: t("settings.models.localProviderLabel.lmstudio", {
              model: lmstudioModelId.trim(),
            }),
            hint: lmstudioModelId.trim(),
          };
        }
        if (m.provider === "mlx" && mlxModelId?.trim()) {
          return {
            ...m,
            label: t("settings.models.localProviderLabel.mlx", {
              model: mlxModelId.trim(),
            }),
            hint: mlxModelId.trim(),
          };
        }
        if (m.provider === "openrouter" && openrouterModelId?.trim()) {
          return {
            ...m,
            label: t("settings.models.localProviderLabel.openrouter", {
              model: openrouterModelId.trim(),
            }),
            hint: openrouterModelId.trim(),
          };
        }
        return m;
      },
    );
    return [...models, ...epModelInfos];
  }, [
    configuredProviders,
    ollamaModelId,
    lmstudioModelId,
    mlxModelId,
    openrouterModelId,
    epModelInfos,
    t,
  ]);

  const current: ModelInfo = useMemo(() => {
    if (isCompatModelId(selected)) {
      return getCompatModelInfo(selected, customEndpoints);
    }
    const found = allModels.find((m) => m.id === selected);
    if (found) return found;
    if (allModels.length > 0) return allModels[0]!;
    return getModel(selected as ModelId);
  }, [selected, customEndpoints, allModels]);

  useEffect(() => {
    if (allModels.length > 0) {
      const exists = allModels.some((m) => m.id === selected);
      if (!exists && allModels[0]) {
        setSelected(allModels[0].id);
      }
    }
  }, [allModels, selected, setSelected]);

  const COMPAT_PROVIDER_ID = "__compat__";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool: readonly ModelInfo[] = allModels;
    if (tab === "favorites") {
      pool = pool.filter((m) => favoriteIds.includes(m.id));
    } else if (tab === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      pool = pool
        .filter((m) => order.has(m.id))
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    if (activeProvider === COMPAT_PROVIDER_ID) {
      pool = pool.filter((m) => isCompatModelId(m.id));
    } else if (activeProvider !== null) {
      pool = pool.filter((m) => m.provider === activeProvider);
    }
    if (q) {
      pool = pool.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.hint.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.provider.includes(q) ||
          (m.tags?.some((t) => t.includes(q)) ?? false),
      );
    }
    return pool;
  }, [activeProvider, allModels, favoriteIds, recentIds, search, tab]);

  const hasAnyConfigured = allModels.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "my-1 rounded-md text-xs hover:bg-accent hover:text-foreground",
            compact ? "size-6 px-0" : "h-5.5 gap-1 px-1.5",
            hasAnyConfigured
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400",
          )}
          title={
            hasAnyConfigured
              ? t("ai.modelLabel", { label: current.label })
              : t("settings.models.noProvidersConnected")
          }
          aria-label={
            hasAnyConfigured
              ? t("ai.modelLabel", { label: current.label })
              : t("settings.models.noProvidersConnected")
          }
        >
          {compact ? (
            <HugeiconsIcon
              icon={PROVIDER_ICON[current.provider]}
              size={13}
              strokeWidth={1.75}
            />
          ) : (
            <>
              {hasAnyConfigured ? current.label : t("settings.models.noProvidersConnected")}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={11}
                strokeWidth={2}
                className="opacity-70"
              />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[28rem] p-0 overflow-hidden rounded-xl border border-border/70 shadow-xl"
        onFocusCapture={(e) => {
          if (e.target !== inputRef.current) inputRef.current?.focus();
        }}
      >
        {/* Search */}
        <div className="flex items-center gap-2.5 border-b border-border/70 px-3 py-2.5">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground/70"
          />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t("ai.searchModels")}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 border-b border-border/70 px-2 py-1.5">
          <TabButton
            label={t("ai.tabAll")}
            icon={AiBookIcon}
            active={tab === "all"}
            onClick={() => setTab("all")}
          />
          <TabButton
            label={t("ai.tabFavorites")}
            icon={FavouriteIcon}
            active={tab === "favorites"}
            onClick={() => setTab("favorites")}
            count={favoriteIds.length || undefined}
          />
          <TabButton
            label={t("ai.tabRecent")}
            icon={Clock01Icon}
            active={tab === "recent"}
            onClick={() => setTab("recent")}
            count={recentIds.length || undefined}
          />
        </div>

        <div className="flex max-h-104 min-h-0">
          {/* Provider sidebar — only active providers */}
          <div className="flex w-11 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 bg-muted/20 py-1.5">
            <ProviderPill
              icon={AiBookIcon}
              title={t("ai.allProviders")}
              active={activeProvider === null}
              onClick={() => setActiveProvider(null)}
            />
            {configuredProviders.map((p) => (
              <ProviderPill
                key={p.id}
                icon={PROVIDER_ICON[p.id]}
                title={p.label}
                active={activeProvider === p.id}
                onClick={() => setActiveProvider(p.id)}
              />
            ))}
            {customEndpoints.length > 0 && (
              <ProviderPill
                icon={PlugIcon}
                title={t("ai.openAiCompatible")}
                active={activeProvider === COMPAT_PROVIDER_ID}
                onClick={() => setActiveProvider(COMPAT_PROVIDER_ID)}
              />
            )}
          </div>

          {/* Models list */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {activeProvider === COMPAT_PROVIDER_ID && (
              <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
                <HugeiconsIcon icon={PlugIcon} size={13} strokeWidth={1.75} />
                <span>{t("ai.openAiCompatible")}</span>
              </div>
            )}
            {activeProvider !== null &&
            activeProvider !== COMPAT_PROVIDER_ID ? (
              <ProviderHeader providerId={activeProvider as ProviderId} />
            ) : null}
            {!hasAnyConfigured ? (
              <div className="flex flex-col items-center justify-center gap-2.5 px-4 py-10 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("settings.models.noProvidersConnected")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void openSettingsWindow("models")}
                  className="h-7 text-[11px]"
                >
                  {t("settings.models.title")}
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-10 text-xs text-muted-foreground/70">
                {tab === "favorites"
                  ? t("ai.noFavorites")
                  : tab === "recent"
                    ? t("ai.noRecent")
                    : t("ai.noModelsMatch")}
              </div>
            ) : (
              filtered.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  selected={m.id === selected}
                  hasKey={true}
                  favorite={favoriteIds.includes(m.id)}
                  showProviderIcon={activeProvider === null}
                  onPick={() => {
                    setSelected(m.id);
                  }}
                  onToggleFavorite={() => void toggleFavoriteModel(m.id)}
                />
              ))
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: typeof AiBookIcon;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
      {label}
      {count != null ? (
        <span className="rounded-full bg-muted/60 px-1.5 text-[9.5px] tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function ProviderPill({
  icon,
  title,
  active,
  muted,
  onClick,
}: {
  icon: typeof AiBookIcon;
  title: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative mx-auto flex size-8 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-accent text-foreground after:absolute after:right-0 after:top-1.5 after:bottom-1.5 after:w-[2px] after:rounded-full after:bg-primary after:content-['']"
          : muted
            ? "text-muted-foreground/50 hover:bg-accent/40 hover:text-foreground"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
    </button>
  );
}

function ProviderHeader({ providerId }: { providerId: ProviderId }) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
      <HugeiconsIcon icon={PROVIDER_ICON[p.id]} size={13} strokeWidth={1.75} />
      <span>{p.label}</span>
    </div>
  );
}



function ModelRow({
  model,
  selected,
  hasKey,
  favorite,
  showProviderIcon,
  onPick,
  onToggleFavorite,
}: {
  model: ModelInfo;
  selected: boolean;
  hasKey: boolean;
  favorite: boolean;
  showProviderIcon: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "group mx-1 my-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
        selected ? "bg-accent/60 text-foreground" : "text-foreground/85",
        !hasKey && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        title={favorite ? t("ai.unfavorite") : t("ai.favorite")}
        className={cn(
          "shrink-0 rounded p-0.5 transition-colors",
          favorite
            ? "text-amber-500"
            : "text-muted-foreground/40 hover:text-amber-500",
        )}
      >
        <HugeiconsIcon
          icon={StarIcon}
          size={12}
          strokeWidth={favorite ? 2 : 1.75}
          className={favorite ? "fill-amber-500" : ""}
        />
      </button>

      {showProviderIcon ? (
        <HugeiconsIcon
          icon={PROVIDER_ICON[model.provider]}
          size={13}
          strokeWidth={1.5}
          className="shrink-0 text-muted-foreground/70"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 text-[12px] font-medium leading-none">
          {model.label}
        </span>
        <span className="truncate text-[10.5px] leading-none text-muted-foreground">
          {getLocalizedModelDescription(model, t)}
        </span>
      </div>

      <CapabilityBars caps={model.capabilities} />

      {selected ? (
        <HugeiconsIcon
          icon={Tick01Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 text-foreground"
        />
      ) : null}
    </DropdownMenuItem>
  );
}

function CapabilityBars({ caps }: { caps: ModelCapabilities }) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <CapBar
        icon={BrainIcon}
        value={caps.intelligence}
        label={t("ai.intelligence")}
      />
      <CapBar icon={FlashIcon} value={caps.speed} label={t("ai.speed")} />
      <CapBar
        icon={CoinsDollarIcon}
        value={caps.cost}
        label={t("ai.affordability")}
      />
    </div>
  );
}

function CapBar({
  icon,
  value,
  label,
}: {
  icon: typeof AiBookIcon;
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-0.5" title={`${label}: ${value}/5`}>
      <HugeiconsIcon
        icon={icon}
        size={10}
        strokeWidth={1.75}
        className="text-muted-foreground/60"
      />
      <span className="flex items-center gap-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2 w-[2px] rounded-full",
              i <= value ? "bg-foreground/70" : "bg-foreground/15",
            )}
          />
        ))}
      </span>
    </span>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "size-6 rounded-md text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </Button>
  );
}
