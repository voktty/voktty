import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { t as translate, useTranslation } from "@/modules/i18n";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  navigateToSettingsEntry,
  type SettingsSearchEntry,
} from "./settingsSearch";
import {
  AiScanIcon,
  InformationCircleIcon,
  KeyboardIcon,
  Key01Icon,
  PackageIcon,
  PaintBoardIcon,
  ServerStack01Icon,
  ServerStack03Icon,
  Settings01Icon,
  SourceCodeIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SettingsSearch } from "./components/SettingsSearch";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import React, { Suspense, useEffect, useState } from "react";
import { playVokttySound, scheduleSettingsToggleSound } from "@/modules/sound";

const GeneralSection = React.lazy(() =>
  import("./sections/GeneralSection").then((m) => ({
    default: m.GeneralSection,
  })),
);
const EditorSection = React.lazy(() =>
  import("./sections/EditorSection").then((m) => ({
    default: m.EditorSection,
  })),
);
const ThemesSection = React.lazy(() =>
  import("./sections/ThemesSection").then((m) => ({
    default: m.ThemesSection,
  })),
);
const ShortcutsSection = React.lazy(() =>
  import("./sections/ShortcutsSection").then((m) => ({
    default: m.ShortcutsSection,
  })),
);
const ModelsSection = React.lazy(() =>
  import("./sections/ModelsSection").then((m) => ({
    default: m.ModelsSection,
  })),
);
const AgentsSection = React.lazy(() =>
  import("./sections/AgentsSection").then((m) => ({
    default: m.AgentsSection,
  })),
);
const ExtensionsSection = React.lazy(() =>
  import("./sections/ExtensionsSection").then((m) => ({
    default: m.ExtensionsSection,
  })),
);
const SshSection = React.lazy(() =>
  import("./sections/SshSection").then((m) => ({
    default: m.SshSection,
  })),
);
const DockerSection = React.lazy(() =>
  import("./sections/DockerSection").then((m) => ({
    default: m.DockerSection,
  })),
);
const McpSection = React.lazy(() =>
  import("./sections/McpSection").then((m) => ({
    default: m.McpSection,
  })),
);
const VaultSection = React.lazy(() =>
  import("./sections/VaultSection").then((m) => ({
    default: m.VaultSection,
  })),
);
const AboutSection = React.lazy(() =>
  import("./sections/AboutSection").then((m) => ({
    default: m.AboutSection,
  })),
);

const TABS: {
  id: SettingsTab;
  icon: typeof Settings01Icon;
  component: React.ComponentType;
}[] = [
  {
    id: "general",
    icon: Settings01Icon,
    component: GeneralSection,
  },
  {
    id: "editor",
    icon: SourceCodeIcon,
    component: EditorSection,
  },
  {
    id: "themes",
    icon: PaintBoardIcon,
    component: ThemesSection,
  },
  {
    id: "shortcuts",
    icon: KeyboardIcon,
    component: ShortcutsSection,
  },
  { id: "models", icon: AiScanIcon, component: ModelsSection },
  {
    id: "agents",
    icon: UserMultiple02Icon,
    component: AgentsSection,
  },
  {
    id: "extensions",
    icon: PackageIcon,
    component: ExtensionsSection,
  },
  {
    id: "ssh",
    icon: ServerStack01Icon,
    component: SshSection,
  },
  {
    id: "docker",
    icon: ServerStack03Icon,
    component: DockerSection,
  },
  {
    id: "mcp",
    icon: ServerStack03Icon,
    component: McpSection,
  },
  {
    id: "vault",
    icon: Key01Icon,
    component: VaultSection,
  },
  {
    id: "about",
    icon: InformationCircleIcon,
    component: AboutSection,
  },
];

const VALID_TABS: SettingsTab[] = [
  "general",
  "editor",
  "themes",
  "shortcuts",
  "models",
  "agents",
  "extensions",
  "ssh",
  "docker",
  "mcp",
  "vault",
  "about",
];

function readInitialTab(): SettingsTab {
  if (typeof window === "undefined") return "general";
  const url = new URL(window.location.href);
  const t = url.searchParams.get("tab");
  if (t === "ai" || t === "connections") return "models";
  if (t && (VALID_TABS as string[]).includes(t)) return t as SettingsTab;
  return "general";
}

function SettingsSectionSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="flex flex-col gap-2">
        <div className="h-6 w-32 rounded bg-muted/60" />
        <div className="h-4 w-64 rounded bg-muted/40" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-14 rounded-xl bg-muted/30 border border-border/40" />
        <div className="h-14 rounded-xl bg-muted/30 border border-border/40" />
        <div className="h-14 rounded-xl bg-muted/30 border border-border/40" />
      </div>
    </div>
  );
}

export function SettingsApp() {
  const { t, language } = useTranslation();
  const [active, setActive] = useState<SettingsTab>(readInitialTab);
  const init = usePreferencesStore((s) => s.init);
  const ActiveSection = TABS.find((t) => t.id === active)?.component;
  const handleSearchSelect = (entry: SettingsSearchEntry) => {
    navigateToSettingsEntry(
      entry,
      entry.targetTitleKey ? t(entry.targetTitleKey) : undefined,
      setActive,
    );
  };

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void init().then(() => playVokttySound("open")).catch(() => {});
    return () => {
      playVokttySound("close");
    };
  }, [init]);

  useEffect(() => {
    void getCurrentWebviewWindow().setTitle(translate("settings.title"));
  }, [language]);

  useEffect(() => {
    const apply = (detail: string) => {
      if (detail === "ai" || detail === "connections") {
        setActive("models");
        return;
      }
      if ((VALID_TABS as string[]).includes(detail)) {
        setActive(detail as SettingsTab);
      }
    };
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "voktty:settings-tab",
      (e) => apply(e.payload),
    );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none"
      onClickCapture={(event) => scheduleSettingsToggleSound(event.target)}
    >
      <header
        data-tauri-drag-region
        className={`flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/60 ${
          IS_MAC ? "pr-3 pl-20" : "pr-2 pl-3"
        }`}
      >
        <div
          className="flex min-w-0 flex-1 items-center justify-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-tauri-drag-region
        >
          <Tabs
            value={active}
            onValueChange={(v) => setActive(v as SettingsTab)}
            orientation="horizontal"
            className="flex items-center"
            data-tauri-drag-region
          >
            <TabsList className="mx-auto flex h-7.5 shrink-0 items-center gap-0.5 rounded-lg bg-muted/40 p-0.5">
              {TABS.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className="h-6.5 shrink-0 gap-1 px-2 text-[11px] font-medium whitespace-nowrap"
                >
                  <HugeiconsIcon icon={item.icon} size={12} strokeWidth={1.75} className="shrink-0" />
                  <span>{t(`settings.tabs.${item.id}`)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {USE_CUSTOM_WINDOW_CONTROLS && (
          <div className="shrink-0">
            <WindowControls closeOnly />
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-160">
          <SettingsSearch onSelect={handleSearchSelect} />
          <div data-settings-section={active} className="mt-5">
            <Suspense fallback={<SettingsSectionSkeleton />}>
              {ActiveSection && <ActiveSection />}
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
