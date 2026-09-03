import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/modules/i18n";
import {
  allServers,
  detectBinary,
  type LspPreset,
  redetectBinary,
  useLspRuntimeStore,
} from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setLspActivation } from "@/modules/settings/store";
import { LspInstallDialog } from "@/settings/components/LspInstallDialog";
import { resolveLspSwitchState } from "@/settings/components/lspSwitchState";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  CheckmarkCircle01Icon,
  CodeIcon,
  Copy01Icon,
  CpuIcon,
  Download01Icon,
  Edit02Icon,
  Folder01Icon,
  Layers01Icon,
  Loading03Icon,
  PackageIcon,
  PlayIcon,
  Refresh01Icon,
  Rocket01Icon,
  Search01Icon,
  Settings01Icon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  detectProjectStack,
  type ProjectStackInfo,
} from "../lib/detectProjectStack";
import {
  type ConfigurableTool,
  DEFAULT_PROJECT_TOOLS,
  ensureToolsConfigFile,
  getProjectToolsFilePath,
  loadToolsConfigFile,
} from "../lib/toolsConfigFile";

type TabId = "ai" | "lsp" | "setup";

type Props = {
  cwd: string | null | undefined;
  onRunCommand?: (command: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenSettings: () => void;
};

export function ProjectToolkitPopover({
  cwd,
  onRunCommand,
  onOpenFile,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation();
  const aiAvailable = useAiAvailable();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    aiAvailable ? "ai" : "lsp",
  );
  const [query, setQuery] = useState("");
  const [stackInfo, setStackInfo] = useState<ProjectStackInfo | null>(null);
  const [tools, setTools] = useState<ConfigurableTool[]>(DEFAULT_PROJECT_TOOLS);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [executedId, setExecutedId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<LspPreset | null>(null);
  const [configFilePath, setConfigFilePath] = useState<string | null>(null);

  const activation = usePreferencesStore((s) => s.lspActivation);
  const customServers = usePreferencesStore((s) => s.lspCustomServers);
  const servers = useMemo(() => allServers(customServers), [customServers]);

  useEffect(() => {
    if (!aiAvailable && activeTab === "ai") setActiveTab("lsp");
  }, [activeTab, aiAvailable]);

  const reloadTools = useCallback(async () => {
    const loaded = await loadToolsConfigFile(cwd);
    setTools(loaded);
    const resolvedPath = await getProjectToolsFilePath(cwd);
    setConfigFilePath(resolvedPath);
  }, [cwd]);

  useEffect(() => {
    void reloadTools();
  }, [reloadTools]);

  // Listen for editor save events to hot-reload tools instantly
  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source !== "editor") return;
          const normalized = event.payload.path
            .replace(/\\/g, "/")
            .toLowerCase();
          if (
            normalized.endsWith("project-tools.json") ||
            normalized.endsWith(".voktty/tools.json")
          ) {
            void reloadTools();
          }
        },
      );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, [reloadTools]);

  useEffect(() => {
    let cancelled = false;
    void detectProjectStack(cwd, customServers).then((res) => {
      if (!cancelled) setStackInfo(res);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, customServers]);

  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 1500);
    return () => clearTimeout(timer);
  }, [copiedId]);

  useEffect(() => {
    if (!executedId) return;
    const timer = setTimeout(() => setExecutedId(null), 1500);
    return () => clearTimeout(timer);
  }, [executedId]);

  const dirName = useMemo(() => {
    if (!cwd) return t("projectToolkit.directory");
    const normalized = cwd.replace(/[\\/]+$/, "");
    const parts = normalized.split(/[\\/]/);
    return parts[parts.length - 1] || cwd;
  }, [cwd, t]);

  const handleRun = (cmd: string, actionId: string) => {
    if (onRunCommand) {
      onRunCommand(cmd);
      setExecutedId(actionId);
    }
  };

  const handleCopy = async (cmd: string, actionId: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedId(actionId);
    } catch {
      setCopiedId(null);
    }
  };

  const handleEditConfigFile = async () => {
    const path = await ensureToolsConfigFile(cwd);
    if (onOpenFile) {
      onOpenFile(path);
      setOpen(false);
    }
  };

  // Filter tools based on category, detected stack and search query
  const filteredAiSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tools.filter((t) => t.category === "ai");
    if (!q) return list;
    return list.filter((a) => {
      const name = a.nameKey ? t(a.nameKey) : (a.name ?? "");
      const description = a.descriptionKey
        ? t(a.descriptionKey)
        : (a.description ?? "");
      return (
        name.toLowerCase().includes(q) ||
        a.command.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q) ||
        a.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [tools, query, t]);

  const filteredSetupActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const currentStack = stackInfo?.primaryType;

    const list = tools.filter(
      (t) => t.category === "setup" || t.category === "custom",
    );
    if (currentStack && currentStack !== "general") {
      list.sort((a, b) => {
        const aMatch = a.stacks?.includes(currentStack) ? 1 : 0;
        const bMatch = b.stacks?.includes(currentStack) ? 1 : 0;
        return bMatch - aMatch;
      });
    }

    if (!q) return list;
    return list.filter((a) => {
      const name = a.nameKey ? t(a.nameKey) : (a.name ?? "");
      const description = a.descriptionKey
        ? t(a.descriptionKey)
        : (a.description ?? "");
      return (
        name.toLowerCase().includes(q) ||
        a.command.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q) ||
        a.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [tools, query, stackInfo?.primaryType, t]);

  const sortedLspServers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const recIds = new Set(stackInfo?.recommendedLspIds ?? []);

    const list = [...servers].sort((a, b) => {
      const aRec = recIds.has(a.id) ? 1 : 0;
      const bRec = recIds.has(b.id) ? 1 : 0;
      return bRec - aRec;
    });

    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        Object.keys(s.languages).some((lang) => lang.toLowerCase().includes(q)),
    );
  }, [servers, stackInfo?.recommendedLspIds, query]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("projectToolkit.buttonAria")}
              >
                <HugeiconsIcon
                  icon={Layers01Icon}
                  size={15}
                  strokeWidth={1.75}
                />
                {stackInfo?.primaryType &&
                stackInfo.primaryType !== "general" ? (
                  <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background" />
                ) : null}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {t("projectToolkit.buttonTooltip")}
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="flex max-h-[540px] w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border/60 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex flex-col gap-2 border-b border-border/40 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/80 text-foreground shadow-2xs">
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    size={14}
                    strokeWidth={1.75}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {dirName}
                    </span>
                    {stackInfo?.labelKey ? (
                      <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary">
                        {t(stackInfo.labelKey)}
                      </span>
                    ) : null}
                  </div>
                  <span className="block truncate text-[10.5px] text-muted-foreground/80">
                    {cwd || t("projectToolkit.currentWorkingDirectory")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => void handleEditConfigFile()}
                  title={t("projectToolkit.editToolsTitle")}
                >
                  <HugeiconsIcon
                    icon={Edit02Icon}
                    size={13}
                    strokeWidth={1.75}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={onOpenSettings}
                  title={t("header.settings")}
                >
                  <HugeiconsIcon
                    icon={Settings01Icon}
                    size={13}
                    strokeWidth={1.75}
                  />
                </Button>
              </div>
            </div>

            {/* Search filter */}
            <div className="relative flex items-center">
              <HugeiconsIcon
                icon={Search01Icon}
                size={13}
                strokeWidth={1.75}
                className="pointer-events-none absolute left-2.5 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("projectToolkit.searchPlaceholder")}
                className="h-7.5 rounded-lg border-border/40 bg-background/60 pl-8 pr-3 text-xs placeholder:text-muted-foreground/60 focus-visible:ring-1"
              />
            </div>

            {/* Segmented tabs */}
            <div
              className={cn(
                "grid gap-1 rounded-lg border border-border/30 bg-muted/40 p-0.5 text-[11px] font-medium text-muted-foreground",
                aiAvailable ? "grid-cols-3" : "grid-cols-2",
              )}
            >
              {aiAvailable ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("ai")}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1 transition-all ${
                    activeTab === "ai"
                      ? "bg-background text-foreground shadow-2xs"
                      : "hover:text-foreground"
                  }`}
                >
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    size={12}
                    strokeWidth={2}
                  />
                  <span>
                    {t("projectToolkit.aiTab", {
                      count: filteredAiSkills.length,
                    })}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setActiveTab("lsp")}
                className={`flex items-center justify-center gap-1.5 rounded-md py-1 transition-all ${
                  activeTab === "lsp"
                    ? "bg-background text-foreground shadow-2xs"
                    : "hover:text-foreground"
                }`}
              >
                <HugeiconsIcon icon={CodeIcon} size={12} strokeWidth={2} />
                <span>
                  {t("projectToolkit.lspTab", { count: servers.length })}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("setup")}
                className={`flex items-center justify-center gap-1.5 rounded-md py-1 transition-all ${
                  activeTab === "setup"
                    ? "bg-background text-foreground shadow-2xs"
                    : "hover:text-foreground"
                }`}
              >
                <HugeiconsIcon icon={PackageIcon} size={12} strokeWidth={2} />
                <span>
                  {t("projectToolkit.setupTab", {
                    count: filteredSetupActions.length,
                  })}
                </span>
              </button>
            </div>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto p-2">
            {aiAvailable && activeTab === "ai" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1 py-0.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  <span>{t("projectToolkit.aiSection")}</span>
                  <button
                    type="button"
                    onClick={() => void handleEditConfigFile()}
                    className="cursor-pointer text-primary hover:underline lowercase"
                  >
                    {t("projectToolkit.editJson")} ✎
                  </button>
                </div>
                {filteredAiSkills.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    copied={copiedId === action.id}
                    executed={executedId === action.id}
                    onCopy={() => handleCopy(action.command, action.id)}
                    onRun={() => handleRun(action.command, action.id)}
                  />
                ))}
              </div>
            )}

            {activeTab === "setup" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1 py-0.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  <span>{t("projectToolkit.setupSection")}</span>
                  <button
                    type="button"
                    onClick={() => void handleEditConfigFile()}
                    className="cursor-pointer text-primary hover:underline lowercase"
                  >
                    {t("projectToolkit.editJson")} ✎
                  </button>
                </div>
                {filteredSetupActions.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    copied={copiedId === action.id}
                    executed={executedId === action.id}
                    onCopy={() => handleCopy(action.command, action.id)}
                    onRun={() => handleRun(action.command, action.id)}
                  />
                ))}
              </div>
            )}

            {activeTab === "lsp" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1 py-0.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  <span>{t("projectToolkit.lspSection")}</span>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="cursor-pointer text-primary hover:underline lowercase"
                  >
                    {t("projectToolkit.customServers")} →
                  </button>
                </div>
                {sortedLspServers.map((server) => {
                  const isRecommended = stackInfo?.recommendedLspIds.includes(
                    server.id,
                  );
                  return (
                    <LspServerQuickRow
                      key={server.id}
                      server={server}
                      enabled={activation[server.id] === "enabled"}
                      recommended={isRecommended}
                      onInstall={() => setInstallTarget(server)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={() => void handleEditConfigFile()}
              className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground/80 hover:text-primary hover:underline"
              title={configFilePath ?? undefined}
            >
              <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={1.75} />
              <span>{t("projectToolkit.editTools")}</span>
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="cursor-pointer font-medium text-foreground/80 hover:text-foreground hover:underline"
            >
              {t("projectToolkit.lspSettings")} →
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <LspInstallDialog
        key={installTarget?.id ?? "closed"}
        server={installTarget}
        onClose={() => setInstallTarget(null)}
      />
    </>
  );
}

function resolveActionIcon(action: ConfigurableTool) {
  if (action.tags?.includes("install") || action.command.includes("install")) {
    return Download01Icon;
  }
  if (action.tags?.includes("init") || action.tags?.includes("frontend")) {
    return Rocket01Icon;
  }
  if (action.category === "ai") {
    return SparklesIcon;
  }
  if (action.tags?.includes("git") || action.tags?.includes("commit")) {
    return TerminalIcon;
  }
  if (action.tags?.includes("docker")) {
    return CpuIcon;
  }
  if (action.tags?.includes("tsc") || action.tags?.includes("check")) {
    return CodeIcon;
  }
  return PackageIcon;
}

function ActionCard({
  action,
  copied,
  executed,
  onCopy,
  onRun,
}: {
  action: ConfigurableTool;
  copied: boolean;
  executed: boolean;
  onCopy: () => void;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const IconComponent = resolveActionIcon(action);
  const name = action.nameKey ? t(action.nameKey) : action.name;
  const description = action.descriptionKey
    ? t(action.descriptionKey)
    : action.description;

  return (
    <div className="group flex flex-col gap-1.5 rounded-lg border border-border/40 bg-background/60 p-2.5 transition-all hover:border-border/80 hover:bg-background/90 hover:shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/40 bg-muted/40 text-foreground">
            <HugeiconsIcon icon={IconComponent} size={13} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                {name}
              </span>
              {action.recommended ? (
                <span className="rounded bg-primary/10 px-1 py-0.2 text-[9.5px] font-medium text-primary">
                  {t("projectToolkit.recommended")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={onCopy}
            title={t("projectToolkit.copyCommand")}
          >
            <HugeiconsIcon
              icon={copied ? CheckmarkCircle01Icon : Copy01Icon}
              size={12}
              strokeWidth={copied ? 2 : 1.75}
              className={copied ? "text-emerald-500" : ""}
            />
          </Button>
          <Button
            variant="secondary"
            size="xs"
            className="h-6 gap-1 px-2 text-[10.5px] font-medium"
            onClick={onRun}
            title={t("projectToolkit.runInActiveTerminal")}
          >
            <HugeiconsIcon
              icon={executed ? CheckmarkCircle01Icon : PlayIcon}
              size={11}
              strokeWidth={2}
              className={executed ? "text-emerald-500" : ""}
            />
            <span>
              {executed ? t("projectToolkit.sent") : t("projectToolkit.run")}
            </span>
          </Button>
        </div>
      </div>

      {description ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground/90">
          {description}
        </p>
      ) : null}

      <div className="flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/30 px-2 py-1 font-mono text-[10.5px] text-foreground/80 select-text">
        <span className="text-muted-foreground/60">$</span>
        <span className="truncate">{action.command}</span>
      </div>
    </div>
  );
}

function LspServerQuickRow({
  server,
  enabled,
  recommended,
  onInstall,
}: {
  server: LspPreset;
  enabled: boolean;
  recommended?: boolean;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  const detected = useLspRuntimeStore((s) => s.detected[server.command]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void detectBinary(server.command);
  }, [server.command]);

  const handleRefresh = async () => {
    setChecking(true);
    await redetectBinary(server.command);
    setChecking(false);
  };

  const langs = Object.keys(server.languages).join(", ");
  const switchState = resolveLspSwitchState(enabled, detected);

  return (
    <div
      className={`flex items-center justify-between gap-2.5 rounded-lg border p-2.5 transition-all ${
        recommended
          ? "border-primary/40 bg-primary/[0.03] shadow-2xs"
          : "border-border/40 bg-background/50 hover:border-border/70 hover:bg-background/80"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-foreground">
            {server.name}
          </span>
          {detected ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-emerald-500"
              title={t("projectToolkit.detectedAt", { path: detected })}
            />
          ) : (
            <span
              className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
              title={t("projectToolkit.notDetectedPath")}
            />
          )}
          {recommended ? (
            <span className="rounded bg-primary/10 px-1 py-0.2 text-[9.5px] font-medium text-primary">
              {t("projectToolkit.detectedInRepo")}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="font-mono text-muted-foreground/80">
            {server.command}
          </span>
          <span>•</span>
          <span className="truncate">{langs}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={checking}
          className="cursor-pointer rounded p-1 text-muted-foreground transition-all hover:bg-accent hover:text-foreground disabled:opacity-50"
          onClick={() => void handleRefresh()}
          title={t("settings.editor.lsp.detectAgain")}
        >
          <HugeiconsIcon
            icon={checking ? Loading03Icon : Refresh01Icon}
            size={12}
            strokeWidth={1.75}
            className={checking ? "animate-spin" : ""}
          />
        </button>

        <Switch
          checked={switchState.checked}
          disabled={switchState.checking}
          aria-label={t("settings.editor.lsp.toggleServerAria", {
            action: switchState.checked ? t("lsp.disable") : t("common.enable"),
            name: server.name,
          })}
          onCheckedChange={(checked) => {
            if (!checked) {
              void setLspActivation(server.id, "dismissed");
              return;
            }
            if (switchState.enableAction === "enable") {
              void setLspActivation(server.id, "enabled");
            } else if (switchState.enableAction === "install") {
              onInstall();
            }
          }}
        />
      </div>
    </div>
  );
}
