import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type CustomEndpoint,
  type ApiProtocol,
  type ProviderId,
  compatModelIdForEndpoint,
  providerSupportsKey,
} from "@/modules/ai/config";
import {
  THIRD_PARTY_PROVIDERS,
  findThirdPartyProvider,
} from "@/modules/ai/lib/thirdPartyCatalog";
import { fetchCompatibleModels } from "@/modules/ai/lib/fetchCompatibleModels";
import {
  getCustomEndpointKey,
  setCustomEndpointKey,
  clearCustomEndpointKey,
  setKey,
} from "@/modules/ai/lib/keyring";
import { syncCustomEndpointsToHarness } from "@/modules/harness/lib/models";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setCustomEndpoints,
  setAiEnabled,
  setDefaultModel,
} from "@/modules/settings/store";
import { useTranslation } from "@/modules/i18n";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Refresh01Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";

export type EndpointAddMode = "third-party" | "custom";

/**
 * Endpoint rows plus the add form. The form only exists while the unified
 * "Add" menu in the models section has asked for one, so there is a single
 * entry point for every kind of connection.
 */
export function ModelEndpointManager({
  addMode = null,
  onCloseAdd,
}: {
  addMode?: EndpointAddMode | null;
  onCloseAdd?: () => void;
}) {
  const { t } = useTranslation();
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints) ?? [];
  const activeTab = addMode;

  // Tab 1: Third-party provider state
  const [selectedProviderId, setSelectedProviderId] =
    useState<string>("deepseek");
  const currentProvider =
    findThirdPartyProvider(selectedProviderId) ?? THIRD_PARTY_PROVIDERS[0];
  const [thirdPartyBaseUrl, setThirdPartyBaseUrl] = useState<string>(
    currentProvider?.defaultBaseURL ?? "",
  );
  const [thirdPartyApiKey, setThirdPartyApiKey] = useState<string>("");
  const [thirdPartyKeyVisible, setThirdPartyKeyVisible] = useState(false);
  const [thirdPartyModels, setThirdPartyModels] = useState<string[]>([]);

  // Update base URL when provider changes
  useEffect(() => {
    if (currentProvider) {
      setThirdPartyBaseUrl(currentProvider.defaultBaseURL);
      setThirdPartyModels([]);
    }
  }, [currentProvider]);

  // Tab 2: Custom API state
  const [customId, setCustomId] = useState<string>("");
  const [customName, setCustomName] = useState<string>("");
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const [customProtocol, setCustomProtocol] = useState<ApiProtocol>(
    "openai-chat-completions",
  );
  const [customApiKey, setCustomApiKey] = useState<string>("");
  const [customKeyVisible, setCustomKeyVisible] = useState(false);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [manualModelInput, setManualModelInput] = useState<string>("");

  // Saved endpoints keys cache for display
  const [endpointKeys, setEndpointKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function loadKeys() {
      const map: Record<string, string> = {};
      for (const ep of customEndpoints) {
        const key = await getCustomEndpointKey(ep.id);
        if (key) map[ep.id] = key;
      }
      if (!cancelled) setEndpointKeys(map);
    }
    void loadKeys();
    return () => {
      cancelled = true;
    };
  }, [customEndpoints]);

  // Synchronize custom endpoints into Harness catalog whenever endpoints change
  useEffect(() => {
    syncCustomEndpointsToHarness(customEndpoints);
  }, [customEndpoints]);

  const discoverQuietly = async (
    url: string,
    options: { apiKey?: string; protocol: ApiProtocol },
  ): Promise<string[]> => {
    try {
      return await fetchCompatibleModels(url, options);
    } catch {
      return [];
    }
  };

  const handleAddManualCustomModel = () => {
    const trimmed = manualModelInput.trim();
    if (!trimmed) return;
    setCustomModels((prev) =>
      prev.includes(trimmed) ? prev : [...prev, trimmed],
    );
    setManualModelInput("");
  };

  const handleRemoveCustomModel = (modelName: string) => {
    setCustomModels((prev) => prev.filter((m) => m !== modelName));
  };

  const handleSaveThirdParty = async () => {
    if (!currentProvider) return;
    const url = thirdPartyBaseUrl.trim() || currentProvider.defaultBaseURL;
    let discovered = thirdPartyModels;
    if (discovered.length === 0) {
      discovered = await discoverQuietly(url, {
        apiKey: thirdPartyApiKey.trim() || undefined,
        protocol: currentProvider.protocol,
      });
    }
    const finalModels =
      discovered.length > 0 ? discovered : [currentProvider.id];
    const endpoint: CustomEndpoint = {
      id: currentProvider.id,
      name: currentProvider.name,
      baseURL: url,
      modelId: finalModels[0],
      models: finalModels,
      protocol: currentProvider.protocol,
      isThirdParty: true,
      providerType: currentProvider.id,
      contextLimit: 128_000,
    };

    if (thirdPartyApiKey.trim()) {
      await setCustomEndpointKey(endpoint.id, thirdPartyApiKey.trim());
      if (providerSupportsKey(currentProvider.id as ProviderId)) {
        await setKey(
          currentProvider.id as ProviderId,
          thirdPartyApiKey.trim(),
        ).catch(() => {});
      }
    }

    const updated = [
      ...customEndpoints.filter((e) => e.id !== endpoint.id),
      endpoint,
    ];
    await setCustomEndpoints(updated);
    syncCustomEndpointsToHarness(updated);
    await setAiEnabled(true);

    const currentDefault = usePreferencesStore.getState().defaultModelId;
    if (
      !currentDefault ||
      currentDefault === "deepseek-flash" ||
      currentDefault === "gpt-6.1-sol"
    ) {
      const newModelId = compatModelIdForEndpoint(endpoint.id, finalModels[0]);
      void setDefaultModel(newModelId as any);
    }

    setThirdPartyApiKey("");
    setThirdPartyModels([]);
    onCloseAdd?.();
  };

  const handleSaveCustom = async () => {
    const idSlug = (customId.trim() || customName.trim())
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!idSlug || !customBaseUrl.trim()) return;

    let discovered = customModels;
    if (discovered.length === 0 && !manualModelInput.trim()) {
      discovered = await discoverQuietly(customBaseUrl.trim(), {
        apiKey: customApiKey.trim() || undefined,
        protocol: customProtocol,
      });
    }
    const finalModels =
      discovered.length > 0 ? discovered : [manualModelInput.trim() || idSlug];
    const endpoint: CustomEndpoint = {
      id: idSlug,
      name: customName.trim() || idSlug,
      baseURL: customBaseUrl.trim(),
      modelId: finalModels[0],
      models: finalModels,
      protocol: customProtocol,
      isThirdParty: false,
      contextLimit: 128_000,
    };

    if (customApiKey.trim()) {
      await setCustomEndpointKey(endpoint.id, customApiKey.trim());
    }

    const updated = [
      ...customEndpoints.filter((e) => e.id !== endpoint.id),
      endpoint,
    ];
    await setCustomEndpoints(updated);
    syncCustomEndpointsToHarness(updated);
    await setAiEnabled(true);

    const currentDefault = usePreferencesStore.getState().defaultModelId;
    if (
      !currentDefault ||
      currentDefault === "deepseek-flash" ||
      currentDefault === "gpt-6.1-sol"
    ) {
      const newModelId = compatModelIdForEndpoint(endpoint.id, finalModels[0]);
      void setDefaultModel(newModelId as any);
    }

    // Reset draft fields
    setCustomId("");
    setCustomName("");
    setCustomBaseUrl("");
    setCustomApiKey("");
    setCustomModels([]);
    setManualModelInput("");
    onCloseAdd?.();
  };

  const handleRemoveEndpoint = async (endpointId: string) => {
    await clearCustomEndpointKey(endpointId);
    const updated = customEndpoints.filter((e) => e.id !== endpointId);
    await setCustomEndpoints(updated);
    syncCustomEndpointsToHarness(updated);
  };

  const handleRefreshExistingEndpoint = async (ep: CustomEndpoint) => {
    try {
      const key = (await getCustomEndpointKey(ep.id)) ?? undefined;
      const models = await fetchCompatibleModels(ep.baseURL, {
        apiKey: key,
        protocol: ep.protocol,
      });
      if (models.length > 0) {
        const updated = customEndpoints.map((item) =>
          item.id === ep.id
            ? {
                ...item,
                models,
                modelId: models.includes(item.modelId)
                  ? item.modelId
                  : models[0],
              }
            : item,
        );
        await setCustomEndpoints(updated);
        syncCustomEndpointsToHarness(updated);
      }
    } catch {}
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Tab 1: Third-party model provider */}
      {activeTab === "third-party" && (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-3.5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-foreground">
              {t("settings.models.selectProvider")}
            </label>
            <Select
              value={selectedProviderId}
              onValueChange={(val) => setSelectedProviderId(val)}
            >
              <SelectTrigger className="h-8.5 font-mono text-xs">
                <SelectValue
                  placeholder={t("settings.models.selectProvider")}
                />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {THIRD_PARTY_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      ({p.id})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-foreground">
              {t("settings.models.apiKey")}
            </label>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Input
                  type={thirdPartyKeyVisible ? "text" : "password"}
                  value={thirdPartyApiKey}
                  onChange={(e) => setThirdPartyApiKey(e.target.value)}
                  placeholder={currentProvider?.apiKeyHint ?? "sk-..."}
                  spellCheck={false}
                  className="h-8.5 pr-8 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setThirdPartyKeyVisible((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={thirdPartyKeyVisible ? ViewOffSlashIcon : ViewIcon}
                    size={13}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-foreground">
              {t("settings.models.baseUrl")}
            </label>
            <Input
              type="text"
              value={thirdPartyBaseUrl}
              onChange={(e) => setThirdPartyBaseUrl(e.target.value)}
              placeholder={currentProvider?.defaultBaseURL}
              spellCheck={false}
              className="h-8.5 font-mono text-xs"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSaveThirdParty()}
              disabled={!thirdPartyBaseUrl.trim()}
              className="h-8 gap-1.5 text-xs"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} />
              {t("settings.models.saveEndpoint")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCloseAdd}
              className="h-8 text-xs"
            >
              {t("common.cancel")}
            </Button>
          </div>

          {thirdPartyModels.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("settings.models.modelsFound", {
                  count: thirdPartyModels.length,
                })}
              </span>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border/40 bg-background/50 p-2">
                {thirdPartyModels.map((m) => (
                  <Badge
                    key={m}
                    variant="secondary"
                    className="gap-1 font-mono text-[10.5px]"
                  >
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Custom model API */}
      {activeTab === "custom" && (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] font-medium text-foreground">
                {t("settings.models.providerId")}
              </label>
              <Input
                type="text"
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                placeholder={t("settings.models.providerIdPlaceholder")}
                spellCheck={false}
                className="h-8.5 font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] font-medium text-foreground">
                {t("settings.models.displayName")}
              </label>
              <Input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={t("settings.models.displayNamePlaceholder")}
                spellCheck={false}
                className="h-8.5 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-foreground">
              {t("settings.models.baseUrl")}
            </label>
            <Input
              type="text"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="https://api.mygateway.com/v1"
              spellCheck={false}
              className="h-8.5 font-mono text-xs"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-foreground">
              {t("settings.models.apiProtocol")}
            </label>
            <Select
              value={customProtocol}
              onValueChange={(val) => setCustomProtocol(val as ApiProtocol)}
            >
              <SelectTrigger className="h-8.5 text-xs">
                <SelectValue placeholder={t("settings.models.apiProtocol")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-chat-completions" className="text-xs">
                  {t("settings.models.protocolOpenAiChat")}
                </SelectItem>
                <SelectItem value="openai-responses" className="text-xs">
                  {t("settings.models.protocolOpenAiResponses")}
                </SelectItem>
                <SelectItem value="anthropic-messages" className="text-xs">
                  {t("settings.models.protocolAnthropic")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-foreground">
              {t("settings.models.apiKey")}
            </label>
            <div className="relative">
              <Input
                type={customKeyVisible ? "text" : "password"}
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="sk-..."
                spellCheck={false}
                className="h-8.5 pr-8 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setCustomKeyVisible((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={customKeyVisible ? ViewOffSlashIcon : ViewIcon}
                  size={13}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSaveCustom()}
              disabled={
                (!customId.trim() && !customName.trim()) ||
                !customBaseUrl.trim()
              }
              className="h-8 gap-1.5 text-xs"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} />
              {t("settings.models.saveEndpoint")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCloseAdd}
              className="h-8 text-xs"
            >
              {t("common.cancel")}
            </Button>
          </div>

          {/* Manual Model Addition Input */}
          <div className="flex items-center gap-1.5 pt-1">
            <Input
              type="text"
              value={manualModelInput}
              onChange={(e) => setManualModelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddManualCustomModel();
                }
              }}
              placeholder={t("settings.models.addModelPlaceholder")}
              spellCheck={false}
              className="h-8 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddManualCustomModel}
              disabled={!manualModelInput.trim()}
              className="h-8 gap-1 text-xs"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} />
              {t("settings.models.addModel")}
            </Button>
          </div>

          {customModels.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("settings.models.modelsFound", {
                  count: customModels.length,
                })}
              </span>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border/40 bg-background/50 p-2">
                {customModels.map((m) => (
                  <Badge
                    key={m}
                    variant="secondary"
                    className="gap-1 font-mono text-[10.5px]"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomModel(m)}
                      className="ml-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Configured endpoints */}
      <div className="flex flex-col gap-2.5">
        {customEndpoints.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            {customEndpoints.map((ep) => (
              <div
                key={ep.id}
                className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/50 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-xs font-semibold">
                      {ep.name}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {ep.id}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-[9.5px] uppercase tracking-wide"
                    >
                      {t("settings.models.kindApi")}
                    </Badge>
                    {ep.protocol && (
                      <Badge
                        variant="secondary"
                        className="text-[9.5px] uppercase tracking-wide"
                      >
                        {ep.protocol === "anthropic-messages"
                          ? t("settings.models.protocolAnthropic")
                          : ep.protocol === "openai-responses"
                            ? t("settings.models.protocolOpenAiResponses")
                            : t("settings.models.protocolOpenAiChat")}
                      </Badge>
                    )}
                    {endpointKeys[ep.id] && (
                      <Badge
                        variant="outline"
                        className="h-4 border-emerald-500/30 bg-emerald-500/10 px-1 text-[9.5px] text-emerald-600 dark:text-emerald-400 gap-0.5"
                      >
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          size={9}
                          strokeWidth={2}
                        />
                        {t("settings.models.apiKey")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRefreshExistingEndpoint(ep)}
                      title={t("settings.models.fetchModelsTitle")}
                      className="size-6 text-muted-foreground hover:text-foreground"
                    >
                      <HugeiconsIcon icon={Refresh01Icon} size={11} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRemoveEndpoint(ep.id)}
                      className="size-6 text-muted-foreground hover:text-destructive"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={11} />
                    </Button>
                  </div>
                </div>

                <div className="text-[11px] font-mono text-muted-foreground truncate">
                  {ep.baseURL}
                </div>

                {ep.models && ep.models.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {ep.models.map((m) => (
                      <Badge
                        key={m}
                        variant="secondary"
                        className="font-mono text-[10px]"
                      >
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
