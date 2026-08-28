import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import {
  type CustomEndpoint,
  type CompatibleCompletionProfile,
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
  getAutocompleteEligibleModels,
  getCompatModelInfo,
  getProvider,
  isCompatModelId,
  MODELS,
  type ModelId,
  type ModelInfo,
  PROVIDERS,
  type ProviderId,
  type ProviderInfo,
  providerNeedsKey,
  STT_PROVIDER_LABELS,
  type SttProvider,
  WHISPERCPP_DEFAULT_BASE_URL,
} from "@/modules/ai/config";
import {
  type CustomEndpointKeys,
  clearCustomEndpointKey,
  clearKey,
  EMPTY_PROVIDER_KEYS,
  getAllCustomEndpointKeys,
  getAllKeys,
  setCustomEndpointKey,
  setKey,
} from "@/modules/ai/lib/keyring";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { hasCurrentAiHealth } from "@/modules/ai/lib/availability";
import { runAiHealthCheck } from "@/modules/ai/lib/healthCheck";
import { hasAutocompleteAccess } from "@/modules/editor/lib/autocomplete/availability";
import { detectCompletionCapabilities } from "@/modules/editor/lib/autocomplete/capabilities";
import {
  classifyCompletionError,
  requestCompletionDetailed,
} from "@/modules/editor/lib/autocomplete/provider";
import { resolveAutocompleteSelection } from "@/modules/editor/lib/autocomplete/selection";
import {
  getLocalizedModelDescription,
  getLocalizedModelHint,
} from "@/modules/ai/lib/modelDisplay";
import { useTranslation } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type AutocompleteTrigger,
  emitKeysChanged,
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setAutocompleteTrigger,
  recordAiHealthCheck,
  setAiEnabled,
  setCustomEndpoints,
  setDefaultModel,
  setFavoriteModelIds,
  setGroqSttModel,
  setLmstudioBaseURL,
  setLmstudioModelId,
  setMlxBaseURL,
  setMlxModelId,
  setOllamaBaseURL,
  setOllamaModelId,
  setOpenaiCompatibleBaseURL,
  setOpenaiCompatibleContextLimit,
  setOpenaiCompatibleModelId,
  setOpenrouterModelId,
  setRecentModelIds,
  setSttProvider,
  setWhispercppBaseURL,
} from "@/modules/settings/store";
import {
  Add01Icon,
  AiScanIcon,
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ChevronDown,
  InformationCircleIcon,
  Mic01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettingsModalStore } from "@/modules/settings/settingsModalStore";
import { AgentsSection } from "./AgentsSection";
import { ProviderIcon } from "../components/ProviderIcon";
import { ProviderKeyCard } from "../components/ProviderKeyCard";
import { SectionHeader } from "../components/SectionHeader";

type KeysMap = Record<ProviderId, string | null>;

const isLocalProvider = (id: ProviderId): boolean => !providerNeedsKey(id);

type LocalMeta = {
  urlPlaceholder: string;
  modelPlaceholder: string;
  descriptionKey: string;
  modelHintKey: string | null;
};

const LOCAL_META: Partial<Record<ProviderId, LocalMeta>> = {
  lmstudio: {
    urlPlaceholder: "http://localhost:1234/v1",
    modelPlaceholder: "qwen2.5-coder-7b-instruct",
    descriptionKey: "settings.models.localMeta.lmstudioDescription",
    modelHintKey: "settings.models.localMeta.lmstudioHint",
  },
  mlx: {
    urlPlaceholder: "http://127.0.0.1:8080/v1",
    modelPlaceholder: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
    descriptionKey: "settings.models.localMeta.mlxDescription",
    modelHintKey: "settings.models.localMeta.mlxHint",
  },
  ollama: {
    urlPlaceholder: "http://localhost:11434/v1",
    modelPlaceholder: "qwen2.5-coder:7b",
    descriptionKey: "settings.models.localMeta.ollamaDescription",
    modelHintKey: "settings.models.localMeta.ollamaHint",
  },
  "openai-compatible": {
    urlPlaceholder: "https://api.example.com/v1",
    modelPlaceholder: "gpt-4o, qwen3-max, glm-4.6, …",
    descriptionKey: "settings.models.localMeta.compatibleDescription",
    modelHintKey: null,
  },
  openrouter: {
    urlPlaceholder: "",
    modelPlaceholder: "anthropic/claude-sonnet-5, openai/gpt-5.6, …",
    descriptionKey: "settings.models.localMeta.openrouterDescription",
    modelHintKey: "settings.models.localMeta.openrouterHint",
  },
};

export function ModelsSection() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<KeysMap | null>(null);
  const [epKeys, setEpKeys] = useState<CustomEndpointKeys>({});
  const [adding, setAdding] = useState<Set<ProviderId>>(new Set());

  const defaultModel = usePreferencesStore((s) => s.defaultModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const compatBaseURL = usePreferencesStore((s) => s.openaiCompatibleBaseURL);
  const compatModelId = usePreferencesStore((s) => s.openaiCompatibleModelId);
  const compatContextLimit = usePreferencesStore(
    (s) => s.openaiCompatibleContextLimit,
  );
  const openrouterModelId = usePreferencesStore((s) => s.openrouterModelId);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);

  const modelsSubTab = useSettingsModalStore((s) => s.modelsSubTab) ?? "models";
  const setModelsSubTab = useSettingsModalStore((s) => s.setModelsSubTab);

  useEffect(() => {
    void getAllKeys().then(setKeys);
  }, []);

  useEffect(() => {
    void getAllCustomEndpointKeys(customEndpoints).then(setEpKeys);
  }, [customEndpoints]);

  const currentKeys: KeysMap = keys ?? EMPTY_PROVIDER_KEYS;

  const onSaveKey = async (provider: ProviderId, value: string) => {
    await setKey(provider, value);
    setKeys((prev) => (prev ? { ...prev, [provider]: value } : prev));
    await emitKeysChanged();
  };

  const onClearKey = async (provider: ProviderId) => {
    await clearKey(provider);
    setKeys((prev) => (prev ? { ...prev, [provider]: null } : prev));
    await emitKeysChanged();
  };

  const onSaveEndpointKey = async (endpointId: string, value: string) => {
    await setCustomEndpointKey(endpointId, value);
    setEpKeys((prev) => ({ ...prev, [endpointId]: value }));
    await emitKeysChanged();
  };

  const onClearEndpointKey = async (endpointId: string) => {
    await clearCustomEndpointKey(endpointId);
    setEpKeys((prev) => ({ ...prev, [endpointId]: null }));
    await emitKeysChanged();
  };

  const addCustomEndpoint = async () => {
    const ep: CustomEndpoint = {
      id: crypto.randomUUID().slice(0, 8),
      name: "",
      baseURL: "",
      modelId: "",
      contextLimit: 128_000,
    };
    await setCustomEndpoints([...customEndpoints, ep]);
  };

  const updateCustomEndpoint = async (
    id: string,
    patch: Partial<CustomEndpoint>,
  ) => {
    await setCustomEndpoints(
      customEndpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  };

  const removeCustomEndpoint = async (id: string) => {
    await clearCustomEndpointKey(id);
    setEpKeys((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    // Drop the now-dead model id from favorites/recents before touching the
    // selection, so the recents push from a selection reset can't race it.
    const deadModelId = compatModelIdForEndpoint(id);
    const { favoriteModelIds, recentModelIds } = usePreferencesStore.getState();
    if (favoriteModelIds.includes(deadModelId)) {
      await setFavoriteModelIds(
        favoriteModelIds.filter((m) => m !== deadModelId),
      );
    }
    if (recentModelIds.includes(deadModelId)) {
      await setRecentModelIds(recentModelIds.filter((m) => m !== deadModelId));
    }

    // If the deleted endpoint was the active model, the selection would dangle
    // and the next send throws "Custom endpoint not found". Fall back to another
    // endpoint when one remains, else the default model.
    const remaining = customEndpoints.filter((e) => e.id !== id);
    const { selectedModelId, setSelectedModelId } = useChatStore.getState();
    if (selectedModelId === deadModelId) {
      setSelectedModelId(
        remaining[0]
          ? compatModelIdForEndpoint(remaining[0].id)
          : DEFAULT_MODEL_ID,
      );
    }

    await setCustomEndpoints(remaining);
  };

  const localConfig = (id: ProviderId): LocalConfig | null => {
    switch (id) {
      case "lmstudio":
        return {
          baseURL: lmstudioBaseURL,
          modelId: lmstudioModelId,
          setBaseURL: setLmstudioBaseURL,
          setModelId: setLmstudioModelId,
        };
      case "mlx":
        return {
          baseURL: mlxBaseURL,
          modelId: mlxModelId,
          setBaseURL: setMlxBaseURL,
          setModelId: setMlxModelId,
        };
      case "ollama":
        return {
          baseURL: ollamaBaseURL,
          modelId: ollamaModelId,
          setBaseURL: setOllamaBaseURL,
          setModelId: setOllamaModelId,
        };
      case "openai-compatible":
        return {
          baseURL: compatBaseURL,
          modelId: compatModelId,
          setBaseURL: setOpenaiCompatibleBaseURL,
          setModelId: setOpenaiCompatibleModelId,
          contextLimit: compatContextLimit,
          setContextLimit: setOpenaiCompatibleContextLimit,
        };
      case "openrouter":
        return {
          baseURL: "",
          modelId: openrouterModelId,
          setBaseURL: async () => {},
          setModelId: setOpenrouterModelId,
          noBaseURL: true,
        };
      default:
        return null;
    }
  };

  const isConfigured = (id: ProviderId): boolean => {
    if (id === "openrouter") return !!currentKeys[id] && !!openrouterModelId?.trim();
    if (!isLocalProvider(id)) return !!currentKeys[id];
    const cfg = localConfig(id);
    if (!cfg) return false;
    if (id === "openai-compatible")
      return !!cfg.baseURL?.trim() && !!cfg.modelId?.trim();
    return !!cfg.modelId?.trim();
  };

  const configuredIds = new Set(
    PROVIDERS.filter((p) => isConfigured(p.id)).map((p) => p.id),
  );
  const visibleIds = new Set<ProviderId>(configuredIds);
  for (const id of adding) visibleIds.add(id);
  const visibleProviders = PROVIDERS.filter(
    (p) => p.id !== "openai-compatible" && visibleIds.has(p.id),
  );
  const addableProviders = PROVIDERS.filter(
    (p) => p.id !== "openai-compatible" && !visibleIds.has(p.id),
  );

  const removeProvider = (id: ProviderId) => {
    if (id === "openrouter") {
      void setOpenrouterModelId("");
      void onClearKey(id);
    } else if (isLocalProvider(id)) {
      const cfg = localConfig(id);
      if (cfg) {
        void cfg.setModelId("");
        if (id === "openai-compatible") void cfg.setBaseURL("");
      }
      if (id === "openai-compatible") void onClearKey(id);
    } else {
      void onClearKey(id);
    }
    setAdding((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const addProvider = (id: ProviderId) => {
    setAdding((prev) => new Set(prev).add(id));
  };

  return (
    <ErrorBoundary name="Models Section">
      <div className="flex flex-col gap-6">
        <SectionHeader
          title={t("settings.models.title")}
          description={t("settings.models.description")}
        />

        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/50 w-fit">
          <button
            type="button"
            onClick={() => setModelsSubTab("models")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer",
              modelsSubTab === "models"
                ? "bg-card text-foreground shadow-xs border border-border/60 font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-card/40",
            )}
          >
            <HugeiconsIcon icon={AiScanIcon} size={14} strokeWidth={2} />
            <span>{t("settings.models.subTabs.models")}</span>
          </button>
          <button
            type="button"
            onClick={() => setModelsSubTab("agents")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer",
              modelsSubTab === "agents"
                ? "bg-card text-foreground shadow-xs border border-border/60 font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-card/40",
            )}
          >
            <HugeiconsIcon icon={UserMultiple02Icon} size={14} strokeWidth={2} />
            <span>{t("settings.models.subTabs.agents")}</span>
          </button>
        </div>

        {modelsSubTab === "agents" ? (
          <AgentsSection hideHeader />
        ) : (
          <div className="flex flex-col gap-7">
            <DefaultsBlock
              defaultModel={defaultModel}
              configuredIds={configuredIds}
              keys={currentKeys}
              customEndpoints={customEndpoints}
              endpointKeys={epKeys}
            />

            <VoiceBlock />

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label>{t("settings.models.providers")}</Label>
                <AddProviderMenu
                  providers={addableProviders}
                  onAdd={addProvider}
                  onAddCompat={addCustomEndpoint}
                />
              </div>

              {visibleProviders.length === 0 && customEndpoints.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-8 text-center">
                  <p className="text-[12px] text-muted-foreground">
                    {t("settings.models.noProvidersConnected")}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                    {t("settings.models.noProvidersConnectedDesc")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {visibleProviders.map((p) => {
                    const meta = LOCAL_META[p.id];
                    const cfg = localConfig(p.id);
                    if (p.id === "openrouter") {
                      if (!cfg || !meta) return null;
                      return (
                        <LocalProviderCard
                          key={p.id}
                          provider={p}
                          configured={configuredIds.has(p.id)}
                          config={cfg}
                          meta={meta}
                          compatKey={currentKeys[p.id]}
                          onSaveKey={(v) => onSaveKey(p.id, v)}
                          onClearKey={() => onClearKey(p.id)}
                          onRemove={() => removeProvider(p.id)}
                        />
                      );
                    }
                    if (isLocalProvider(p.id)) {
                      if (!cfg || !meta) return null;
                      return (
                        <LocalProviderCard
                          key={p.id}
                          provider={p}
                          configured={configuredIds.has(p.id)}
                          config={cfg}
                          meta={meta}
                          onSaveKey={(v) => onSaveKey(p.id, v)}
                          onClearKey={() => onClearKey(p.id)}
                          onRemove={() => removeProvider(p.id)}
                        />
                      );
                    }
                    return (
                      <ProviderKeyCard
                        key={p.id}
                        provider={p}
                        currentKey={currentKeys[p.id]}
                        onSave={(v) => onSaveKey(p.id, v)}
                        onClear={() => onClearKey(p.id)}
                        onRemove={() => removeProvider(p.id)}
                      />
                    );
                  })}
                  {customEndpoints.map((ep) => (
                    <CustomEndpointCard
                      key={ep.id}
                endpoint={ep}
                endpointKey={epKeys[ep.id] ?? null}
                onSaveKey={(v) => onSaveEndpointKey(ep.id, v)}
                onClearKey={() => onClearEndpointKey(ep.id)}
                onUpdate={(patch) => updateCustomEndpoint(ep.id, patch)}
                onRemove={() => removeCustomEndpoint(ep.id)}
              />
            ))}
          </div>
        )}
      </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

type LocalConfig = {
  baseURL: string;
  modelId: string;
  setBaseURL: (v: string) => Promise<void>;
  setModelId: (v: string) => Promise<void>;
  contextLimit?: number;
  setContextLimit?: (v: number) => Promise<void>;
  noBaseURL?: boolean;
};

function AddProviderMenu({
  providers,
  onAdd,
  onAddCompat,
}: {
  providers: readonly ProviderInfo[];
  onAdd: (id: ProviderId) => void;
  onAddCompat: () => void;
}) {
  const { t } = useTranslation();
  const cloud = providers.filter((p) => !isLocalProvider(p.id));
  const local = providers.filter(
    (p) => isLocalProvider(p.id) && p.id !== "openai-compatible",
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2.5 text-[11px]"
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
          {t("settings.models.addProvider")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-55 p-1">
        {cloud.length > 0 ? (
          <>
            <DropdownMenuLabel className="px-2 text-[10px] tracking-wide text-muted-foreground uppercase">
              {t("settings.models.cloud")}
            </DropdownMenuLabel>
            {cloud.map((p) => (
              <ProviderMenuItem key={p.id} provider={p} onAdd={onAdd} />
            ))}
          </>
        ) : null}
        <DropdownMenuLabel className="px-2 text-[10px] tracking-wide text-muted-foreground uppercase">
          {t("settings.models.localCustom")}
        </DropdownMenuLabel>
        {local.map((p) => (
          <ProviderMenuItem key={p.id} provider={p} onAdd={onAdd} />
        ))}
        <DropdownMenuItem
          onSelect={() => onAddCompat()}
          className="flex items-center gap-2 text-[12px]"
        >
          <ProviderIcon provider="openai-compatible" size={13} />
          <span>{t("ai.openAiCompatible")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderMenuItem({
  provider,
  onAdd,
}: {
  provider: ProviderInfo;
  onAdd: (id: ProviderId) => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={() => onAdd(provider.id)}
      className="flex items-center gap-2 text-[12px]"
    >
      <ProviderIcon provider={provider.id} size={13} />
      <span>{provider.label}</span>
    </DropdownMenuItem>
  );
}

function getFirstConfiguredModelId(
  configuredIds: Set<ProviderId>,
  customEndpoints: readonly CustomEndpoint[],
): ModelId | null {
  for (const p of PROVIDERS) {
    if (configuredIds.has(p.id)) {
      const m = MODELS.find((x) => x.provider === p.id);
      if (m) return m.id as ModelId;
    }
  }
  if (customEndpoints.length > 0 && customEndpoints[0]?.id) {
    return compatModelIdForEndpoint(customEndpoints[0].id) as ModelId;
  }
  return null;
}

function resolveDisplayModel(
  modelId: string | undefined | null,
  customEndpoints: readonly CustomEndpoint[] = [],
): ModelInfo {
  if (!modelId) {
    return (
      MODELS[0] ?? {
        id: "gpt-5.4-mini" as ModelId,
        provider: "openai",
        label: "GPT-5.4 Mini",
        hint: "Fast",
        description: "Default fast model",
        capabilities: { intelligence: 4, speed: 5, cost: 5 },
      }
    );
  }
  if (isCompatModelId(modelId)) {
    return getCompatModelInfo(modelId, customEndpoints);
  }
  const found = MODELS.find((x) => x.id === modelId);
  if (found) {
    const prefs = usePreferencesStore.getState();
    if (found.provider === "ollama" && prefs.ollamaModelId?.trim()) {
      return {
        ...found,
        label: `Ollama (${prefs.ollamaModelId.trim()})`,
        hint: prefs.ollamaModelId.trim(),
      };
    }
    if (found.provider === "lmstudio" && prefs.lmstudioModelId?.trim()) {
      return {
        ...found,
        label: `LM Studio (${prefs.lmstudioModelId.trim()})`,
        hint: prefs.lmstudioModelId.trim(),
      };
    }
    if (found.provider === "mlx" && prefs.mlxModelId?.trim()) {
      return {
        ...found,
        label: `MLX (${prefs.mlxModelId.trim()})`,
        hint: prefs.mlxModelId.trim(),
      };
    }
    if (found.provider === "openrouter" && prefs.openrouterModelId?.trim()) {
      return {
        ...found,
        label: `OpenRouter (${prefs.openrouterModelId.trim()})`,
        hint: prefs.openrouterModelId.trim(),
      };
    }
    return found;
  }
  return {
    id: modelId as ModelId,
    provider: "openai-compatible",
    label: modelId || "Default Model",
    hint: modelId,
    description: modelId,
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  };
}

function DefaultsBlock({
  defaultModel,
  configuredIds,
  keys,
  customEndpoints,
  endpointKeys,
}: {
  defaultModel: ModelId;
  configuredIds: Set<ProviderId>;
  keys: KeysMap;
  customEndpoints: readonly CustomEndpoint[];
  endpointKeys: CustomEndpointKeys;
}) {
  const { t } = useTranslation();
  const aiEnabled = usePreferencesStore((s) => s.aiEnabled);
  const aiConfigRevision = usePreferencesStore((s) => s.aiConfigRevision);
  const aiHealthRevision = usePreferencesStore((s) => s.aiHealthRevision);
  const aiHealthCheckedAt = usePreferencesStore((s) => s.aiHealthCheckedAt);
  const healthCurrent = hasCurrentAiHealth({
    aiEnabled,
    aiConfigRevision,
    aiHealthRevision,
    aiHealthCheckedAt,
  });
  const [healthStatus, setHealthStatus] = useState<
    | { phase: "idle" }
    | { phase: "testing" }
    | { phase: "ok"; latencyMs: number }
    | { phase: "fail" }
  >({ phase: "idle" });

  useEffect(() => {
    setHealthStatus({ phase: "idle" });
  }, [aiConfigRevision]);

  const hasAny = configuredIds.size > 0 || customEndpoints.length > 0;
  const defaultModelInfo = resolveDisplayModel(defaultModel, customEndpoints);
  const isDefaultConfigured =
    configuredIds.has(defaultModelInfo.provider) ||
    (isCompatModelId(defaultModel) &&
      customEndpoints.some((e) => compatModelIdForEndpoint(e.id) === defaultModel));

  useEffect(() => {
    if (!isDefaultConfigured && hasAny) {
      const fallback = getFirstConfiguredModelId(configuredIds, customEndpoints);
      if (fallback && fallback !== defaultModel) {
        void setDefaultModel(fallback);
      }
    }
  }, [isDefaultConfigured, hasAny, configuredIds, customEndpoints, defaultModel]);

  const testAi = async () => {
    const revision = aiConfigRevision;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setHealthStatus({ phase: "testing" });
    try {
      const preferences = usePreferencesStore.getState();
      const targetModel = isDefaultConfigured
        ? defaultModel
        : (getFirstConfiguredModelId(configuredIds, customEndpoints) ?? defaultModel);

      if (!isDefaultConfigured && targetModel !== defaultModel) {
        await setDefaultModel(targetModel);
      }

      const result = await runAiHealthCheck(
        {
          modelId: targetModel,
          keys,
          customEndpointKeys: endpointKeys,
          lmstudioBaseURL: preferences.lmstudioBaseURL,
          lmstudioModelId: preferences.lmstudioModelId,
          mlxBaseURL: preferences.mlxBaseURL,
          mlxModelId: preferences.mlxModelId,
          ollamaBaseURL: preferences.ollamaBaseURL,
          ollamaModelId: preferences.ollamaModelId,
          openaiCompatibleBaseURL: preferences.openaiCompatibleBaseURL,
          openaiCompatibleModelId: preferences.openaiCompatibleModelId,
          openrouterModelId: preferences.openrouterModelId,
          customEndpoints: preferences.customEndpoints,
        },
        controller.signal,
      );
      const recorded = await recordAiHealthCheck(revision);
      setHealthStatus(
        recorded
          ? { phase: "ok", latencyMs: result.latencyMs }
          : { phase: "fail" },
      );
      if (recorded) {
        await setAiEnabled(true);
      }
    } catch {
      setHealthStatus({ phase: "fail" });
    } finally {
      clearTimeout(timeout);
    }
  };

  const isAiActive = aiEnabled && healthCurrent;

  return (
    <div className="flex flex-col gap-3">
      <Label>{t("settings.models.defaults")}</Label>
      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label={t("settings.models.aiActivation")}>
          <div className="flex flex-1 items-center gap-2">
            <Switch
              checked={aiEnabled && healthCurrent}
              disabled={!hasAny || healthStatus.phase === "testing"}
              onCheckedChange={async (value) => {
                if (value) {
                  if (!healthCurrent) {
                    await testAi();
                  } else {
                    await setAiEnabled(true);
                  }
                } else {
                  await setAiEnabled(false);
                }
              }}
              aria-label={t("settings.models.aiActivation")}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={healthStatus.phase === "testing" || !hasAny}
              onClick={() => void testAi()}
              className="h-8 px-3 text-[11px]"
            >
              {healthStatus.phase === "testing"
                ? t("settings.models.testing")
                : t("settings.models.testAi")}
            </Button>
            <span
              className={cn(
                "text-[10.5px] text-muted-foreground",
                healthStatus.phase === "fail" && "text-destructive/80",
              )}
            >
              {healthStatus.phase === "ok"
                ? t("settings.models.aiHealthReady", {
                    latency: String(healthStatus.latencyMs),
                  })
                : healthStatus.phase === "fail"
                  ? t("settings.models.aiHealthFailed")
                  : healthCurrent
                    ? t("settings.models.aiHealthVerified")
                    : t("settings.models.aiHealthRequired")}
            </span>
          </div>
        </FieldRow>
        {!isAiActive && (
          <div className="flex items-start gap-2 rounded-md bg-muted/40 border border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
            <HugeiconsIcon
              icon={InformationCircleIcon}
              size={14}
              className="shrink-0 text-primary/80 mt-0.5"
            />
            <span>
              {!hasAny
                ? t("settings.models.noProvidersConnectedDesc")
                : t("settings.models.aiInactiveBanner")}
            </span>
          </div>
        )}
        <FieldRow label={t("settings.models.chatModel")}>
          <DefaultModelPicker
            defaultModel={defaultModel}
            configuredIds={configuredIds}
            customEndpoints={customEndpoints}
            disabled={!hasAny}
          />
        </FieldRow>
        <AutocompleteRow
          keys={keys}
          configuredIds={configuredIds}
          customEndpoints={customEndpoints}
          endpointKeys={endpointKeys}
          disabled={!isAiActive}
        />
      </div>
    </div>
  );
}

function DefaultModelPicker({
  defaultModel,
  configuredIds,
  customEndpoints,
  disabled,
}: {
  defaultModel: ModelId;
  configuredIds: Set<ProviderId>;
  customEndpoints: readonly CustomEndpoint[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const hasAny = configuredIds.size > 0 || customEndpoints.length > 0;
  const m = resolveDisplayModel(defaultModel, customEndpoints);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled || !hasAny}
          className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
        >
          {hasAny ? (
            <span className="flex items-center gap-2 truncate">
              <ProviderIcon provider={m.provider} size={13} />
              <span className="truncate">{m.label}</span>
              <span className="text-muted-foreground">
                · {getLocalizedModelHint(m, t)}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("settings.models.noProvidersConnected")}
            </span>
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={12}
        className="min-w-70 p-1"
      >
        <div className="max-h-72 overflow-y-auto overscroll-contain pr-1">
          {PROVIDERS.filter((p) => configuredIds.has(p.id)).map((p) => {
            const models = MODELS.filter((x) => x.provider === p.id);
            if (models.length === 0) return null;
            return (
              <div key={p.id} className="px-1 pt-1.5 first:pt-1">
                <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  <ProviderIcon provider={p.id} size={11} />
                  <span>{p.label}</span>
                </div>
                {models.map((mod) => {
                  const displayMod = resolveDisplayModel(mod.id, customEndpoints);
                  return (
                    <DropdownMenuItem
                      key={mod.id}
                      onSelect={() => void setDefaultModel(mod.id as ModelId)}
                      className={cn(
                        "flex items-start gap-2 text-[12px]",
                        mod.id === defaultModel && "bg-accent/50",
                      )}
                    >
                      <span className="flex flex-1 flex-col">
                        <span>{displayMod.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {getLocalizedModelDescription(displayMod, t)}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            );
          })}
          {customEndpoints.length > 0 && (
            <div className="px-1 pt-1.5 first:pt-1">
              <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                <ProviderIcon provider="openai-compatible" size={11} />
                <span>{t("ai.openAiCompatible")}</span>
              </div>
              {customEndpoints.map((ep) => {
                const compatId = compatModelIdForEndpoint(ep.id) as ModelId;
                return (
                  <DropdownMenuItem
                    key={ep.id}
                    onSelect={() => void setDefaultModel(compatId)}
                    className={cn(
                      "flex items-start gap-2 text-[12px]",
                      compatId === defaultModel && "bg-accent/50",
                    )}
                  >
                    <span className="flex flex-1 flex-col">
                      <span>{ep.name || ep.modelId || "Custom Endpoint"}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {ep.baseURL}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AutocompleteRow({
  keys,
  configuredIds,
  customEndpoints,
  endpointKeys,
  disabled,
}: {
  keys: KeysMap;
  configuredIds: Set<ProviderId>;
  customEndpoints: readonly CustomEndpoint[];
  endpointKeys: CustomEndpointKeys;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const enabled = usePreferencesStore((s) => s.autocompleteEnabled);
  const trigger = usePreferencesStore((s) => s.autocompleteTrigger);
  const provider = usePreferencesStore((s) => s.autocompleteProvider);
  const modelId = usePreferencesStore((s) => s.autocompleteModelId);
  const eligible = useMemo(() => getAutocompleteEligibleModels(), []);
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const testSelection = resolveAutocompleteSelection(
    usePreferencesStore.getState(),
  );
  const testSelectionVersion = JSON.stringify({
    provider: testSelection.provider,
    modelId: testSelection.modelId,
    lmstudioBaseURL: testSelection.lmstudioBaseURL,
    mlxBaseURL: testSelection.mlxBaseURL,
    ollamaBaseURL: testSelection.ollamaBaseURL,
    openaiCompatibleBaseURL: testSelection.openaiCompatibleBaseURL,
    profile: testSelection.profileOverride,
    keyConfigured: testSelection.endpointId
      ? Boolean(endpointKeys?.[testSelection.endpointId])
      : Boolean(keys?.[testSelection.provider]),
  });
  const [testStatus, setTestStatus] = useState<
    | { phase: "idle" }
    | { phase: "testing" }
    | {
        phase: "ok";
        latencyMs: number;
        profile: string;
        attempts: number;
        sample: string;
      }
    | { phase: "fail"; code: string }
  >({ phase: "idle" });
  const testRunRef = useRef(0);
  const testControllerRef = useRef<AbortController | null>(null);
  const previousTestSelectionRef = useRef(testSelectionVersion);
  useEffect(() => {
    if (previousTestSelectionRef.current === testSelectionVersion) return;
    previousTestSelectionRef.current = testSelectionVersion;
    testRunRef.current += 1;
    testControllerRef.current?.abort();
    testControllerRef.current = null;
    setTestStatus({ phase: "idle" });
  }, [testSelectionVersion]);
  const aiCompleteShortcut = useMemo(() => {
    const s = SHORTCUTS.find((x) => x.id === "editor.aiComplete");
    const bindings = userShortcuts["editor.aiComplete"] || s?.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join("");
  }, [userShortcuts]);

  // One selectable model per fully-configured OpenAI-compatible endpoint.
  const compatItems = useMemo(
    () =>
      customEndpoints
        .filter((e) => e && e.baseURL?.trim() && e.modelId?.trim())
        .map((e) =>
          getCompatModelInfo(compatModelIdForEndpoint(e.id), customEndpoints),
        ),
    [customEndpoints],
  );

  const fallbackModel: ModelInfo = eligible[0] ??
    MODELS[0] ?? {
      id: "gpt-5.4-mini" as ModelId,
      provider: "openai",
      label: "GPT-5.4 Mini",
      hint: "Fast",
      description: "Default fast model",
      capabilities: { intelligence: 4, speed: 5, cost: 5 },
    };

  // Fast cloud tiers + configured local providers + named compat endpoints.
  const items = useMemo(() => {
    const local = PROVIDERS.filter(
      (p) =>
        isLocalProvider(p.id) &&
        p.id !== "openai-compatible" &&
        configuredIds.has(p.id),
    ).flatMap((p) => {
      const m = MODELS.find((x) => x.provider === p.id);
      return m ? [m] : [];
    });
    return [...eligible, ...local, ...compatItems];
  }, [eligible, configuredIds, compatItems]);

  const currentModel: ModelInfo = useMemo(() => {
    if (provider === "openai-compatible" && isCompatModelId(modelId)) {
      return getCompatModelInfo(modelId, customEndpoints);
    }
    if (isLocalProvider(provider)) {
      return (
        MODELS.find((m) => m.provider === provider) ??
        fallbackModel
      );
    }
    return (
      MODELS.find((m) => m.provider === provider && m.id === modelId) ??
      MODELS.find((m) => m.id === modelId) ??
      fallbackModel
    );
  }, [fallbackModel, provider, modelId, customEndpoints]);

  const setModel = (id: string, providerId: ProviderId) => {
    void setAutocompleteProvider(providerId);
    // Compat endpoints store their compat- id; other locals use their own field.
    const keep =
      providerId === "openai-compatible" || !isLocalProvider(providerId);
    void setAutocompleteModelId(keep ? id : "");
  };

  const grouped = useMemo(() => {
    const map = new Map<ProviderId, (typeof items)[number][]>();
    for (const m of items) {
      if (!m) continue;
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return map;
  }, [items]);

  const hasKey = providerNeedsKey(provider) ? !!keys?.[provider] : true;

  const testAutocomplete = async () => {
    const run = ++testRunRef.current;
    testControllerRef.current?.abort();
    const snapshot = usePreferencesStore.getState();
    const selection = resolveAutocompleteSelection(snapshot);
    const apiKey = selection.endpointId
      ? (endpointKeys[selection.endpointId] ?? null)
      : keys[selection.provider];
    const deps = { ...selection, apiKey };
    if (!hasAutocompleteAccess(deps)) {
      setTestStatus({ phase: "fail", code: "authentication" });
      return;
    }

    setTestStatus({ phase: "testing" });
    const controller = new AbortController();
    testControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      let capabilities = null;
      if (
        selection.provider === "lmstudio" ||
        selection.provider === "ollama"
      ) {
        try {
          capabilities = await detectCompletionCapabilities(
            selection,
            controller.signal,
          );
        } catch {
          capabilities = null;
        }
      }
      const result = await requestCompletionDetailed(
        {
          prefix: "function sum(a, b) {\n  return a +",
          suffix: ";\n}\n",
          filename: "autocomplete-smoke.js",
          language: "javascript",
          indentUnit: "  ",
        },
        { ...deps, capabilities },
        controller.signal,
      );
      if (run === testRunRef.current) {
        setTestStatus({
          phase: "ok",
          latencyMs: result.latencyMs,
          profile: result.profile,
          attempts: result.attemptsUsed,
          sample: result.text.replace(/\s+/g, " ").trim().slice(0, 80),
        });
      }
    } catch (error) {
      if (run === testRunRef.current) {
        setTestStatus({
          phase: "fail",
          code: controller.signal.aborted
            ? "unavailable"
            : classifyCompletionError(error),
        });
      }
    } finally {
      clearTimeout(timeout);
      if (testControllerRef.current === controller) {
        testControllerRef.current = null;
      }
    }
  };

  return (
    <>
      <FieldRow label={t("settings.models.autocomplete")}>
        <div className="flex flex-1 items-center gap-2">
          <Switch
            checked={enabled}
            disabled={disabled}
            onCheckedChange={(v) => void setAutocompleteEnabled(v)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={disabled || !enabled}
                className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
              >
                <span className="flex items-center gap-2 truncate">
                  <ProviderIcon provider={currentModel.provider} size={12} />
                  <span className="truncate">{currentModel.label}</span>
                  <span className="text-muted-foreground">
                    · {getLocalizedModelHint(currentModel, t)}
                  </span>
                </span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={11}
                  strokeWidth={2}
                  className="opacity-70"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              collisionPadding={12}
              className="max-h-72 min-w-70 overflow-y-auto"
            >
              {PROVIDERS.map((p) => {
                const list = grouped.get(p.id);
                if (!list || list.length === 0) return null;
                const pConfigured =
                  p.id === "openai-compatible" || configuredIds.has(p.id);
                return (
                  <div key={p.id} className="px-1 pt-1.5 first:pt-1">
                    <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      <ProviderIcon provider={p.id} size={11} />
                      <span>{p.label}</span>
                      {!pConfigured ? (
                        <span className="ml-auto text-[9.5px] normal-case tracking-normal text-muted-foreground/70">
                          {t("settings.models.notConnected")}
                        </span>
                      ) : null}
                    </div>
                    {list.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        disabled={!pConfigured}
                        onSelect={() => pConfigured && setModel(m.id, p.id)}
                        className={cn(
                          "text-[11.5px]",
                          m.id === modelId && "bg-accent/50",
                        )}
                      >
                        <span className="flex flex-col">
                          <span>{m.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {getLocalizedModelDescription(m, t)}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </FieldRow>
      {enabled ? (
        <FieldRow label={t("settings.models.trigger")}>
          <Select
            value={trigger}
            onValueChange={(v) =>
              void setAutocompleteTrigger(v as AutocompleteTrigger)
            }
          >
            <SelectTrigger className="h-8 w-full text-[11.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-[11.5px]">
                {t("settings.models.triggerAuto")}
              </SelectItem>
              <SelectItem value="manual" className="text-[11.5px]">
                {t("settings.models.triggerManual", {
                  shortcut:
                    aiCompleteShortcut || t("settings.models.shortcutFallback"),
                })}
              </SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
      ) : null}
      {enabled ? (
        <FieldRow label={t("settings.models.autocompleteTestLabel")}>
          <div className="flex flex-1 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void testAutocomplete()}
              disabled={testStatus.phase === "testing"}
              className="h-8 px-3 text-[11px]"
            >
              {testStatus.phase === "testing"
                ? t("settings.models.testing")
                : t("settings.models.testAutocomplete")}
            </Button>
            {testStatus.phase === "ok" ? (
              <span className="flex min-w-0 flex-col text-[10.5px]">
                <span className="text-emerald-500">
                  {t("settings.models.autocompleteTestOk", {
                    latency: testStatus.latencyMs,
                    profile: testStatus.profile,
                    attempts: testStatus.attempts,
                  })}
                </span>
                <code className="max-w-72 truncate text-muted-foreground">
                  {testStatus.sample}
                </code>
              </span>
            ) : null}
            {testStatus.phase === "fail" ? (
              <span className="text-[10.5px] text-destructive/80">
                {t("settings.models.autocompleteTestFail", {
                  reason: t(
                    `settings.models.autocompleteFailure.${testStatus.code}`,
                  ),
                })}
              </span>
            ) : null}
          </div>
        </FieldRow>
      ) : null}
      {enabled && !hasKey ? (
        <div className="mt-1 rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning-foreground">
          {t("settings.models.providerNotConnectedHint", {
            provider: getProvider(provider).label,
          })}
        </div>
      ) : null}
    </>
  );
}

function LocalProviderCard({
  provider,
  configured,
  config,
  meta,
  compatKey,
  onSaveKey,
  onClearKey,
  onRemove,
}: {
  provider: ProviderInfo;
  configured: boolean;
  config: LocalConfig;
  meta: LocalMeta;
  compatKey?: string | null;
  onSaveKey: (v: string) => Promise<void>;
  onClearKey: () => Promise<void>;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const {
    baseURL,
    modelId,
    setBaseURL,
    setModelId,
    contextLimit,
    setContextLimit,
    noBaseURL,
  } = config;
  const [urlDraft, setUrlDraft] = useState(baseURL);
  const [modelDraft, setModelDraft] = useState(modelId);
  const [contextDraft, setContextDraft] = useState(String(contextLimit ?? ""));
  const [keyDraft, setKeyDraft] = useState("");
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setUrlDraft(baseURL), [baseURL]);
  useEffect(() => setModelDraft(modelId), [modelId]);
  useEffect(() => setContextDraft(String(contextLimit ?? "")), [contextLimit]);

  const supportsKey =
    provider.id === "openai-compatible" || provider.id === "openrouter";

  const test = async () => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", { baseUrl: urlDraft });
      setTestStatus(status > 0 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={provider.id} size={15} />
        <span className="text-[12.5px] font-medium">{provider.label}</span>
        {configured ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-border/60 bg-muted/40 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            {t("settings.models.connected")}
          </Badge>
        ) : null}
        <button
          type="button"
          onClick={() => void openUrl(provider.consoleUrl)}
          className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("settings.models.docs")}
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={11}
            strokeWidth={1.75}
          />
        </button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          title={t("settings.models.removeProvider")}
          className="size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </div>

      <span className="text-[10.5px] leading-relaxed text-muted-foreground">
        {t(meta.descriptionKey)}
      </span>

      <div className="mt-0.5 flex flex-col gap-2.5">
        {noBaseURL ? null : (
          <FieldRow label={t("settings.models.baseUrl")}>
            <div className="flex flex-1 gap-1.5">
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  const v = urlDraft.trim();
                  if (v !== baseURL) void setBaseURL(v);
                }}
                placeholder={meta.urlPlaceholder}
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void test()}
                disabled={!urlDraft.trim()}
                className="h-8 px-3 text-[11px]"
              >
                {t("settings.models.test")}
              </Button>
            </div>
          </FieldRow>
        )}

        <FieldRow label={t("settings.models.modelId")}>
          <Input
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              const v = modelDraft.trim();
              if (v !== modelId) void setModelId(v);
            }}
            placeholder={meta.modelPlaceholder}
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </FieldRow>

        {setContextLimit ? (
          <FieldRow label={t("settings.models.contextLabel")}>
            <div className="flex flex-1 items-center gap-1.5">
              <Input
                value={contextDraft}
                onChange={(e) => setContextDraft(e.target.value)}
                onBlur={() => {
                  const v = parseInt(contextDraft, 10);
                  if (Number.isFinite(v) && v >= 1000) void setContextLimit(v);
                  else setContextDraft(String(contextLimit ?? ""));
                }}
                placeholder="128000"
                spellCheck={false}
                className="h-8 w-28 font-mono text-[11.5px]"
              />
              <span className="text-[10.5px] text-muted-foreground">
                {t("settings.models.tokensUnit")}
              </span>
            </div>
          </FieldRow>
        ) : null}

        {supportsKey ? (
          <FieldRow label={t("settings.models.apiKey")}>
            {compatKey ? (
              <div className="flex flex-1 items-center gap-1.5">
                <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {`${compatKey.slice(0, 4)}${"•".repeat(8)}${compatKey.slice(-4)}`}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void onClearKey()}
                  title={t("settings.models.deleteKey")}
                  className="size-7 text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              </div>
            ) : (
              <div className="flex flex-1 gap-1.5">
                <Input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={t("settings.models.optionalKeyPlaceholder")}
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-[11.5px]"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    const v = keyDraft.trim();
                    if (!v) return;
                    await onSaveKey(v);
                    setKeyDraft("");
                  }}
                  disabled={!keyDraft.trim()}
                  className="h-8 px-3 text-[11px]"
                >
                  {t("common.save")}
                </Button>
              </div>
            )}
          </FieldRow>
        ) : null}

        <StatusLine status={testStatus} />

        {!modelId.trim() && meta.modelHintKey ? (
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            {t(meta.modelHintKey)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CustomEndpointCard({
  endpoint,
  endpointKey,
  onSaveKey,
  onClearKey,
  onUpdate,
  onRemove,
}: {
  endpoint: CustomEndpoint;
  endpointKey: string | null;
  onSaveKey: (v: string) => Promise<void>;
  onClearKey: () => Promise<void>;
  onUpdate: (patch: Partial<CustomEndpoint>) => Promise<void>;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!endpoint.baseURL.trim());
  const [nameDraft, setNameDraft] = useState(endpoint.name);
  const [urlDraft, setUrlDraft] = useState(endpoint.baseURL);
  const [modelDraft, setModelDraft] = useState(endpoint.modelId);
  const [contextDraft, setContextDraft] = useState(
    String(endpoint.contextLimit ?? ""),
  );
  const [keyDraft, setKeyDraft] = useState("");
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setNameDraft(endpoint.name), [endpoint.name]);
  useEffect(() => setUrlDraft(endpoint.baseURL), [endpoint.baseURL]);
  useEffect(() => setModelDraft(endpoint.modelId), [endpoint.modelId]);
  useEffect(
    () => setContextDraft(String(endpoint.contextLimit ?? "")),
    [endpoint.contextLimit],
  );

  const configured = !!endpoint.baseURL.trim() && !!endpoint.modelId.trim();

  const test = async () => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", { baseUrl: urlDraft });
      setTestStatus(status > 0 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col rounded-lg border border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        <HugeiconsIcon
          icon={ChevronDown}
          size={12}
          strokeWidth={2}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <ProviderIcon provider="openai-compatible" size={15} />
        <span className="text-[12.5px] font-medium truncate">
          {endpoint.name || t("ai.openAiCompatible")}
        </span>
        {endpoint.modelId.trim() && (
          <span className="text-[10.5px] text-muted-foreground truncate font-mono">
            {endpoint.modelId}
          </span>
        )}
        {configured ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-border/60 bg-muted/40 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            {t("settings.models.connected")}
          </Badge>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={t("settings.models.removeProvider")}
          className="ml-auto size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border/40 px-3 py-2.5">
          <FieldRow label={t("settings.agents.name")}>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const v = nameDraft.trim();
                if (v !== endpoint.name) void onUpdate({ name: v });
              }}
              placeholder={t("settings.models.endpointNamePlaceholder")}
              spellCheck={false}
              className="h-8 flex-1 text-[11.5px]"
            />
          </FieldRow>

          <FieldRow label={t("settings.models.baseUrl")}>
            <div className="flex flex-1 gap-1.5">
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  const v = urlDraft.trim();
                  if (v !== endpoint.baseURL) void onUpdate({ baseURL: v });
                }}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void test()}
                disabled={!urlDraft.trim()}
                className="h-8 px-3 text-[11px]"
              >
                {t("settings.models.test")}
              </Button>
            </div>
          </FieldRow>

          <FieldRow label={t("settings.models.modelId")}>
            <Input
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={() => {
                const v = modelDraft.trim();
                if (v !== endpoint.modelId) void onUpdate({ modelId: v });
              }}
              placeholder="gpt-4o, qwen3-max, glm-4.6, …"
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </FieldRow>

          <FieldRow label={t("settings.models.autocompleteProfile")}>
            <Select
              value={endpoint.autocompleteProfile ?? "auto"}
              onValueChange={(value) =>
                void onUpdate({
                  autocompleteProfile: value as CompatibleCompletionProfile,
                })
              }
            >
              <SelectTrigger className="h-8 w-full text-[11.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "auto",
                    "generic",
                    "openai",
                    "deepseek",
                    "ollama",
                    "lmstudio",
                  ] as const
                ).map((profile) => (
                  <SelectItem
                    key={profile}
                    value={profile}
                    className="text-[11.5px]"
                  >
                    {t(`settings.models.autocompleteProfiles.${profile}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label={t("settings.models.contextLabel")}>
            <div className="flex flex-1 items-center gap-1.5">
              <Input
                value={contextDraft}
                onChange={(e) => setContextDraft(e.target.value)}
                onBlur={() => {
                  const v = parseInt(contextDraft, 10);
                  if (Number.isFinite(v) && v >= 1000)
                    void onUpdate({ contextLimit: v });
                  else setContextDraft(String(endpoint.contextLimit ?? ""));
                }}
                placeholder="128000"
                spellCheck={false}
                className="h-8 w-28 font-mono text-[11.5px]"
              />
              <span className="text-[10.5px] text-muted-foreground">
                {t("settings.models.tokensUnit")}
              </span>
            </div>
          </FieldRow>

          <FieldRow label={t("settings.models.apiKey")}>
            {endpointKey ? (
              <div className="flex flex-1 items-center gap-1.5">
                <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {`${endpointKey.slice(0, 4)}${"•".repeat(8)}${endpointKey.slice(-4)}`}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void onClearKey()}
                  title={t("settings.models.deleteKey")}
                  className="size-7 text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              </div>
            ) : (
              <div className="flex flex-1 gap-1.5">
                <Input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={t("settings.models.optionalKeyPlaceholder")}
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-[11.5px]"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    const v = keyDraft.trim();
                    if (!v) return;
                    await onSaveKey(v);
                    setKeyDraft("");
                  }}
                  disabled={!keyDraft.trim()}
                  className="h-8 px-3 text-[11px]"
                >
                  {t("common.save")}
                </Button>
              </div>
            )}
          </FieldRow>

          <StatusLine status={testStatus} />
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-1 items-center">{children}</div>
    </div>
  );
}

function StatusLine({
  status,
}: {
  status: "idle" | "testing" | "ok" | "fail";
}) {
  const { t } = useTranslation();
  if (status === "idle") return null;
  if (status === "testing") {
    return (
      <span className="text-[10.5px] text-muted-foreground">
        {t("settings.models.testing")}
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={2} />
        {t("settings.models.reachable")}
      </span>
    );
  }
  return (
    <span className="text-[10.5px] text-destructive/80">
      {t("settings.models.unreachable")}
    </span>
  );
}

function VoiceBlock() {
  const { t } = useTranslation();
  const sttProvider = usePreferencesStore((s) => s.sttProvider);
  const groqSttModel = usePreferencesStore((s) => s.groqSttModel);
  const whispercppBaseURL = usePreferencesStore((s) => s.whispercppBaseURL);
  const [urlDraft, setUrlDraft] = useState(whispercppBaseURL);
  const [groqModelDraft, setGroqModelDraft] = useState(groqSttModel);

  useEffect(() => setUrlDraft(whispercppBaseURL), [whispercppBaseURL]);
  useEffect(() => setGroqModelDraft(groqSttModel), [groqSttModel]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Mic01Icon} size={15} strokeWidth={1.5} />
        <span className="text-[12.5px] font-medium">
          {t("settings.models.voiceInput")}
        </span>
      </div>

      <FieldRow label={t("settings.models.provider")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
            >
              <span>
                {(sttProvider && STT_PROVIDER_LABELS[sttProvider]) ||
                  STT_PROVIDER_LABELS.browser ||
                  "Browser (built-in, free)"}
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={11}
                strokeWidth={2}
                className="opacity-70"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44 p-1">
            {(Object.keys(STT_PROVIDER_LABELS) as SttProvider[]).map((p) => (
              <DropdownMenuItem
                key={p}
                onSelect={() => void setSttProvider(p)}
                className={cn(
                  "flex items-center gap-2 text-[12px]",
                  p === sttProvider && "bg-accent/50",
                )}
              >
                <span>{STT_PROVIDER_LABELS[p]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </FieldRow>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {sttProvider === "openai" && t("settings.models.sttOpenAiDesc")}
        {sttProvider === "groq" && t("settings.models.sttGroqDesc")}
        {sttProvider === "whispercpp" && t("settings.models.sttWhisperCppDesc")}
        {sttProvider === "browser" && t("settings.models.sttBrowserDesc")}
      </p>

      {sttProvider === "groq" && (
        <div className="flex flex-col gap-2.5">
          <FieldRow label={t("settings.models.modelId")}>
            <Input
              value={groqModelDraft}
              onChange={(e) => setGroqModelDraft(e.target.value)}
              onBlur={() => {
                const v = groqModelDraft.trim();
                if (v !== groqSttModel) void setGroqSttModel(v);
              }}
              placeholder="whisper-large-v3-turbo"
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </FieldRow>
        </div>
      )}

      {sttProvider === "whispercpp" && (
        <div className="flex flex-col gap-2.5">
          <FieldRow label={t("settings.models.baseUrl")}>
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={() => {
                const v = urlDraft.trim();
                if (v !== whispercppBaseURL) void setWhispercppBaseURL(v);
              }}
              placeholder={WHISPERCPP_DEFAULT_BASE_URL}
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </FieldRow>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
