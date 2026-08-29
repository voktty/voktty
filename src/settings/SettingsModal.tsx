import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useTranslation } from "@/modules/i18n";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useSettingsModalStore } from "@/modules/settings/settingsModalStore";
import {
  navigateToSettingsEntry,
  type SettingsSearchEntry,
} from "./settingsSearch";
import {
  AiScanIcon,
  Cancel01Icon,
  CommandLineIcon,
  ComputerIcon,
  InformationCircleIcon,
  KeyboardIcon,
  Key01Icon,
  PackageIcon,
  PaintBoardIcon,
  ServerStack01Icon,
  ServerStack03Icon,
  Settings01Icon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SettingsSearch } from "./components/SettingsSearch";
import { useDraggableModal } from "@/hooks/useDraggableModal";
import React, { Suspense, useEffect, useId, useLayoutEffect, useRef } from "react";
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
const RdpSection = React.lazy(() =>
  import("./sections/RdpSection").then((m) => ({
    default: m.RdpSection,
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
const AliasesSection = React.lazy(() =>
  import("./sections/AliasesSection").then((m) => ({
    default: m.AliasesSection,
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
  { id: "general", icon: Settings01Icon, component: GeneralSection },
  { id: "editor", icon: SourceCodeIcon, component: EditorSection },
  { id: "themes", icon: PaintBoardIcon, component: ThemesSection },
  { id: "shortcuts", icon: KeyboardIcon, component: ShortcutsSection },
  { id: "models", icon: AiScanIcon, component: ModelsSection },
  { id: "extensions", icon: PackageIcon, component: ExtensionsSection },
  { id: "ssh", icon: ServerStack01Icon, component: SshSection },
  { id: "rdp", icon: ComputerIcon, component: RdpSection },
  { id: "docker", icon: ServerStack03Icon, component: DockerSection },
  { id: "mcp", icon: ServerStack03Icon, component: McpSection },
  { id: "vault", icon: Key01Icon, component: VaultSection },
  { id: "aliases", icon: CommandLineIcon, component: AliasesSection },
  { id: "about", icon: InformationCircleIcon, component: AboutSection },
];

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

export function SettingsModal() {
  const { t } = useTranslation();
  const open = useSettingsModalStore((s) => s.open);
  const active = useSettingsModalStore((s) => s.activeTab);
  const setActive = useSettingsModalStore((s) => s.setActiveTab);
  const closeSettings = useSettingsModalStore((s) => s.closeSettings);
  const tabScrollPositions = useSettingsModalStore((s) => s.tabScrollPositions);
  const setTabScroll = useSettingsModalStore((s) => s.setTabScroll);
  const modalPosition = useSettingsModalStore((s) => s.modalPosition);
  const setModalPosition = useSettingsModalStore((s) => s.setModalPosition);
  const init = usePreferencesStore((s) => s.init);
  const headerId = useId();
  const previousOpenRef = React.useRef(open);
  const scrollContainerRef = useRef<HTMLElement>(null);

  const { position, dragHandleProps } = useDraggableModal({
    initialPosition: modalPosition ?? undefined,
    onPositionChange: setModalPosition,
  });

  useEffect(() => {
    const previousOpen = previousOpenRef.current;
    if (open && !previousOpen) {
      void init().then(() => playVokttySound("open")).catch(() => {});
    }
    if (!open && previousOpen) playVokttySound("close");
    previousOpenRef.current = open;
  }, [open, init]);

  useEffect(() => {
    if (open) {
      void init();
    }
  }, [open, init]);

  // Restore scroll position whenever active tab changes or modal opens
  useLayoutEffect(() => {
    if (!open || !scrollContainerRef.current) return;
    const targetScroll = tabScrollPositions[active] ?? 0;
    scrollContainerRef.current.scrollTop = targetScroll;
  }, [open, active, tabScrollPositions]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSettings();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [open, closeSettings]);

  if (!open) return null;

  const activeTabItem =
    TABS.find((tab) => tab.id === active) ??
    (active === "agents" ? TABS.find((tab) => tab.id === "models")! : TABS[0]);
  const ActiveComponent = activeTabItem.component;
  const handleSearchSelect = (entry: SettingsSearchEntry) => {
    navigateToSettingsEntry(
      entry,
      entry.targetTitleKey ? t(entry.targetTitleKey) : undefined,
      setActive,
    );
  };

  // Split tabs into main groups for cleaner hierarchy
  const mainTabs = TABS.filter((tab) => tab.id !== "about");
  const aboutTab = TABS.find((tab) => tab.id === "about");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-4 duration-150 animate-in fade-in-0"
      onClick={closeSettings}
    >
      <div
        className="flex flex-row w-full max-w-4xl h-[82vh] max-h-[660px] rounded-xl border border-border/70 bg-background/95 text-foreground shadow-2xl overflow-hidden duration-150 animate-in zoom-in-95 select-none transition-shadow"
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headerId}
        onClickCapture={(event) => scheduleSettingsToggleSound(event.target)}
      >
        {/* Left Fluent Sidebar Navigation */}
        <aside className="w-48 sm:w-52 shrink-0 border-r border-border/40 bg-card/30 backdrop-blur-md flex flex-col justify-between p-2.5">
          <div className="flex flex-col gap-2 min-h-0 flex-1">
            {/* Sidebar Title / Drag Handle */}
            <div
              {...dragHandleProps}
              className="flex items-center gap-2 px-2 py-1 cursor-grab active:cursor-grabbing select-none"
              title={t("settings.title")}
            >
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20">
                <HugeiconsIcon icon={Settings01Icon} size={13} />
              </div>
              <span id={headerId} className="text-xs font-semibold tracking-tight text-foreground">
                {t("settings.title")}
              </span>
            </div>

            {/* Navigation List */}
            <nav className="flex flex-col gap-0.5 overflow-y-auto pr-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {mainTabs.map((item, idx) => {
                const isActive = active === item.id;
                // Add separator before Remote group
                const showDivider = idx === 4 || idx === 7;
                return (
                  <React.Fragment key={item.id}>
                    {showDivider && (
                      <div className="my-1 border-t border-border/30 mx-1.5" />
                    )}
                    <button
                      type="button"
                      onClick={() => setActive(item.id)}
                      className={`group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] transition-all text-left cursor-pointer ${
                        isActive
                          ? "bg-accent text-foreground font-semibold shadow-xs"
                          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full bg-primary" />
                      )}
                      <HugeiconsIcon
                        icon={item.icon}
                        size={14}
                        strokeWidth={isActive ? 2 : 1.75}
                        className={`shrink-0 ${
                          isActive
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground"
                        }`}
                      />
                      <span className="truncate">{t(`settings.tabs.${item.id}`)}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>
          </div>

          {/* Bottom About item */}
          {aboutTab && (
            <div className="pt-1.5 border-t border-border/30">
              <button
                type="button"
                onClick={() => setActive(aboutTab.id)}
                className={`group relative flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11.5px] transition-all text-left cursor-pointer ${
                  active === aboutTab.id
                    ? "bg-accent text-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium"
                }`}
              >
                {active === aboutTab.id && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full bg-primary" />
                )}
                <div className="flex items-center gap-2 min-w-0">
                  <HugeiconsIcon
                    icon={aboutTab.icon}
                    size={14}
                    strokeWidth={active === aboutTab.id ? 2 : 1.75}
                    className={`shrink-0 ${
                      active === aboutTab.id
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-foreground"
                    }`}
                  />
                  <span className="truncate">{t(`settings.tabs.${aboutTab.id}`)}</span>
                </div>
                <span className="text-[9.5px] font-mono text-muted-foreground/70 bg-muted/50 px-1 py-0.2 rounded">
                  voktty
                </span>
              </button>
            </div>
          )}
        </aside>

        {/* Right Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background/50">
          {/* Header / Drag Handle */}
          <header
            {...dragHandleProps}
            className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-card/20 px-4 cursor-grab active:cursor-grabbing select-none"
          >
            <div className="flex items-center gap-2 text-[11.5px] font-semibold text-foreground pointer-events-none">
              <HugeiconsIcon
                icon={activeTabItem.icon}
                size={14}
                className="text-primary shrink-0"
              />
              <span>{t(`settings.tabs.${activeTabItem.id}`)}</span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              data-no-drag
              onClick={closeSettings}
              className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title={`${t("windowControls.close")} (Esc)`}
              aria-label={t("windowControls.close")}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
            </Button>
          </header>

          {/* Scrollable Content Body */}
          <main
            ref={scrollContainerRef}
            onScroll={(e) => setTabScroll(active, e.currentTarget.scrollTop)}
            className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-8 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="mx-auto w-full max-w-xl">
              <SettingsSearch onSelect={handleSearchSelect} />
              <div data-settings-section={active} className="mt-3.5">
                <Suspense fallback={<SettingsSectionSkeleton />}>
                  <ErrorBoundary name={`Settings Tab: ${active}`}>
                    <ActiveComponent />
                  </ErrorBoundary>
                </Suspense>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
