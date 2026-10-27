import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownCircle,
  Check,
  ImagePlus,
  Loader,
  RefreshCw,
  Search,
} from "../chrome/icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "@/modules/i18n";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  keybindingCommandLabel,
  keybindingWhenLabel,
  settingsEntryLabel,
  settingsSectionDescription,
  settingsSectionLabel,
} from "../lib/catalogLabels";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { InboxProviderMark } from "../chrome/InboxProviderMark";
import { Popover } from "../chrome/Popover";
import { RemoveProjectDialog } from "../chrome/RemoveProjectDialog";
import { SkillsPage } from "./SkillsPage";
import { McpSettings } from "./McpSettings";
import { WorktreesPage } from "./WorktreesPage";
import { HarnessConnectionsPage } from "./HarnessConnectionsPage";
import { removeWorktree, type RemoveWorktree } from "../lib/worktrees";
import { ProjectNotificationSettings } from "@/modules/notifications";
import type { RecentProject } from "../lib/recents";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  applyChatBackground,
  applyChatBackgroundOpacity,
  applyChatBackgroundScope,
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  chatBackgroundSrc,
  loadChatBackgroundOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundScope,
  loadSidebarLayout,
  loadTranscriptLayout,
  loadTranscriptZen,
  loadTranscriptAnchor,
  saveChatBackgroundOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundScope,
  saveSidebarLayout,
  saveTranscriptLayout,
  saveTranscriptZen,
  saveTranscriptAnchor,
  TRANSCRIPT_ZEN_CHANGE_EVENT,
  TRANSCRIPT_ANCHOR_CHANGE_EVENT,
  type ChatBackgroundScope,
  type SidebarLayout,
  type TranscriptLayout,
} from "../lib/appearance";
import {
  pickAndSaveChatBackground,
  removeChatBackground,
} from "../lib/chatBackground";
import { prettyCwd, projectKey, projectName } from "../lib/paths";
import { ALT, IS_MAC, IS_WIN, MOD } from "../lib/platform";
import {
  loadArchivedProjects,
  looksLikeProject,
  subscribeArchivedProjects,
  type ArchivedProject,
} from "../lib/recents";
import {
  sessionDisplayTitle,
  type Session,
} from "../lib/session";
import {
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
} from "../lib/sessionFilters";
import type { SessionSummary } from "../lib/sessionStore";
import {
  clearInboxCache,
  githubStatus,
  type GithubStatus,
} from "../lib/githubTasks";
import {
  disconnectGitlab,
  gitlabConnected,
  saveGitlabConfig,
} from "../lib/gitlab";
import {
  disconnectLinear,
  LINEAR_CHANGE_EVENT,
  linearConnected,
  listLinearTeams,
  loadHiddenLinearTeamIds,
  notifyLinearChange,
  saveHiddenLinearTeamIds,
  saveLinearToken,
  type LinearTeam,
} from "../lib/linear";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../lib/tabGroups";
import {
  filterKeybindings,
  KEYBINDINGS,
  loadClaudeHooks,
  loadCloseToTray,
  loadComposerRunner,
  loadFollowUpBehavior,
  loadGridArcadeEnabled,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  saveClaudeHooks,
  saveCloseToTray,
  saveComposerRunner,
  saveFollowUpBehavior,
  saveGridArcadeEnabled,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
  searchSettings,
  settingDomId,
  type FollowUpBehavior,
  type SettingsSearchResult,
  type SettingsSectionId,
} from "../lib/settings";
import { loadSoundsEnabled, playCue, saveSoundsEnabled } from "../lib/sounds";
import {
  installPendingUpdate,
  readAppVersion,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../lib/updater";

export type SettingsAnchor =
  | "github"
  | "gitlab"
  | "linear"
  | "project-notifications"
  | "project-worktrees";

const ANCHOR_IDS: Record<SettingsAnchor, string> = {
  github: "settings-github",
  gitlab: "settings-gitlab",
  linear: "settings-linear",
  "project-notifications": "settings-project-notifications",
  "project-worktrees": "setting-project-worktrees",
};

const RevealedSettingContext = createContext<string | null>(null);

type Props = {
  section: SettingsSectionId;
  onSelectSection?: (section: SettingsSectionId) => void;
  /** Card to scroll to; the General page is too long to land at the top. */
  anchor?: SettingsAnchor | null;
  cwd: string;
  sessions: SessionSummary[];
  besideRail?: boolean;
  recents?: RecentProject[];
  notificationProjectPath?: string | null;
  notificationSettingsRequest?: number;
  liveSessions?: Session[];
  onRemoveWorktree?: RemoveWorktree;
  onCheckWorktreeRemoval?: RemoveWorktree;
  onDeleteWorktreeSessions?: (
    sessionIds: readonly string[],
  ) => Promise<boolean>;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
  onOpenWhatsNew: (version: string) => void;
};

export function SettingsView({
  section,
  onSelectSection,
  anchor = null,
  cwd,
  sessions,
  besideRail = false,
  recents = [],
  notificationProjectPath = null,
  notificationSettingsRequest = 0,
  liveSessions = [],
  onRemoveWorktree = removeWorktree,
  onCheckWorktreeRemoval,
  onDeleteWorktreeSessions,
  onClose,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
  onOpenWhatsNew,
}: Props) {
  const { t } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [revealedSetting, setRevealedSetting] = useState<string | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!anchor) return;
    document.getElementById(ANCHOR_IDS[anchor])?.scrollIntoView({
      block: "start",
    });
  }, [anchor]);

  const onReveal = useCallback(
    (item: SettingsSearchResult) => {
      if (item.section !== section && onSelectSection) {
        onSelectSection(item.section);
      }
      if (item.settingId) {
        if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
        setRevealedSetting(item.settingId);
        revealTimeoutRef.current = setTimeout(() => {
          setRevealedSetting(null);
        }, 2500);

        setTimeout(() => {
          const el = document.getElementById(settingDomId(item.settingId!));
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 80);
      }
    },
    [section, onSelectSection],
  );

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <RevealedSettingContext.Provider value={revealedSetting}>
      <div
        role="region"
        aria-label={t("harness.chrome.settings")}
        data-app-settings
        className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
      >
        <div
          className="flex h-10 shrink-0 select-none items-center justify-between gap-4 border-b border-content/10 pr-3"
          data-tauri-drag-region="deep"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
            <span className="shrink-0 text-content/45">
              {t("harness.chrome.settings")}
            </span>
            <span aria-hidden className="shrink-0 text-content/25">
              /
            </span>
            <span className="min-w-0 truncate text-content">
              {settingsSectionLabel(t, section)}
            </span>
          </div>
          <SettingsSearch onSelectResult={onReveal} />
        </div>

        <div
          ref={lockOverscroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-none"
        >
          <div className="mx-auto w-full max-w-5xl px-8 py-8">
            <PageHeader
              title={settingsSectionLabel(t, section)}
              description={settingsSectionDescription(t, section)}
            />
            {section === "general" ? (
              <GeneralPage onOpenWhatsNew={onOpenWhatsNew} />
            ) : null}
            {section === "appearance" ? (
              <AppearancePage appearance={appearance} />
            ) : null}
            {section === "chat" ? <ChatPage /> : null}
            {section === "keybindings" ? <KeybindingsPage /> : null}
            {section === "providers" ? <ProvidersPage /> : null}
            {section === "inbox" ? (
              <InboxPage
                cwd={cwd}
                recents={recents}
                notificationProjectPath={notificationProjectPath}
                notificationSettingsRequest={notificationSettingsRequest}
              />
            ) : null}
            {section === "connections" ? <HarnessConnectionsPage cwd={cwd} /> : null}
            {section === "skills" ? <SkillsPage cwd={cwd} /> : null}
            {section === "mcp" ? <McpSettings cwd={cwd} /> : null}
            {section === "worktrees" ? (
              <WorktreesPage
                cwd={cwd}
                recents={recents}
                liveSessions={liveSessions}
                onRemove={onRemoveWorktree}
                onCheckRemove={onCheckWorktreeRemoval}
                onDeleteSessions={onDeleteWorktreeSessions}
              />
            ) : null}
            {section === "archive" ? (
              <ArchivePage
                cwd={cwd}
                sessions={sessions}
                onOpenSession={onOpenSession}
                onArchiveSession={onArchiveSession}
                onDeleteSession={onDeleteSession}
                onRestoreProject={onRestoreProject}
                onDeleteProject={onDeleteProject}
              />
            ) : null}
          </div>
        </div>
      </div>
    </RevealedSettingContext.Provider>
  );
}

function SettingsSearch({
  onSelectResult,
}: {
  onSelectResult: (item: SettingsSearchResult) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchSettings(
      query,
      (section) => settingsSectionLabel(t, section),
      undefined,
      (id) => settingsEntryLabel(t, id),
    );
  }, [query, t]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && !e.shiftKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest("[data-app-settings]")) return;
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSelect = (item: SettingsSearchResult) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    onSelectResult(item);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev + 1) % results.length : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative max-w-xs flex-1">
      <div className="relative flex items-center">
        <Search
          className="pointer-events-none absolute left-2.5 size-3.5 text-content/40"
          strokeWidth={1.75}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("harness.settings.searchPlaceholder")}
          className="w-full rounded-md border border-content/10 bg-content/5 py-1 pl-8 pr-7 text-[12px] text-content placeholder:text-content/40 outline-none transition-colors focus:border-content/25 focus:bg-content/10"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-2 text-[11px] text-content/40 hover:text-content"
          >
            ✕
          </button>
        ) : null}
      </div>

      {open && results.length > 0 ? (
        <Popover
          anchor={containerRef}
          side="bottom"
          align="end"
          width={340}
          maxHeight={360}
          autoFocus={false}
          onDismiss={() => setOpen(false)}
          className="z-50 overflow-y-auto overscroll-contain p-1"
        >
          <div className="flex flex-col gap-0.5">
            {results.map((item, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => handleSelect(item)}
                  className={`flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left text-[12px] ${
                    active
                      ? "bg-content/10 text-content"
                      : "text-content/80 hover:bg-content/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-content">
                      {item.title}
                    </span>
                    <span className="shrink-0 rounded bg-content/10 px-1.5 py-0.5 font-mono text-[10px] text-content/60">
                      {settingsSectionLabel(t, item.section)}
                    </span>
                  </div>
                  {item.settingId == null ? (
                    <span className="line-clamp-1 text-[11px] text-content/50">
                      {settingsSectionDescription(t, item.section)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Popover>
      ) : open && query.trim() ? (
        <Popover
          anchor={containerRef}
          side="bottom"
          align="end"
          width={300}
          autoFocus={false}
          onDismiss={() => setOpen(false)}
          className="z-50 p-3 text-center text-[12px] text-content/50"
        >
          {t("harness.settings.noResults")}
        </Popover>
      ) : null}
    </div>
  );
}

function GeneralPage({
  onOpenWhatsNew,
}: {
  onOpenWhatsNew: (version: string) => void;
}) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<SidebarLayout>(loadSidebarLayout);
  const [notesEnabled, setNotesEnabled] = useState(loadNotesEnabled);
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useState(
    loadLiveAgentsEnabled,
  );
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const [claudeHooks, setClaudeHooks] = useState(loadClaudeHooks);
  const [closeToTray, setCloseToTray] = useState(loadCloseToTray);

  const onLayout = (next: SidebarLayout) => {
    saveSidebarLayout(next);
    setLayout(next);
  };

  const onNotesEnabled = (next: boolean) => {
    saveNotesEnabled(next);
    setNotesEnabled(next);
  };

  const onLiveAgentsEnabled = (next: boolean) => {
    saveLiveAgentsEnabled(next);
    setLiveAgentsEnabled(next);
  };

  const onSoundsEnabled = (next: boolean) => {
    saveSoundsEnabled(next);
    setSoundsEnabled(next);
  };

  const onClaudeHooks = (next: boolean) => {
    saveClaudeHooks(next);
    setClaudeHooks(next);
  };

  const onCloseToTray = (next: boolean) => {
    saveCloseToTray(next);
    setCloseToTray(next);
  };

  return (
    <>
      <Row
        settingId="workspaceLayout"
        label={t("harness.settings.workspaceLayout")}
        description={t("harness.settings.workspaceLayoutDesc")}
      >
        <Segmented
          label={t("harness.settings.workspaceLayout")}
          value={layout}
          options={[
            { value: "deck", label: t("harness.settings.deck") },
            { value: "classic", label: t("harness.settings.classic") },
          ]}
          onChange={onLayout}
        />
      </Row>
      <Row
        settingId="notes"
        label={t("harness.settings.notes")}
        description={t("harness.settings.notesDesc")}
      >
        <Toggle
          label={t("harness.settings.notes")}
          on={notesEnabled}
          onChange={onNotesEnabled}
        />
      </Row>
      <Row
        settingId="workingAgents"
        label={t("harness.settings.workingAgents")}
        description={t("harness.settings.workingAgentsDesc")}
      >
        <Toggle
          label={t("harness.settings.workingAgents")}
          on={liveAgentsEnabled}
          onChange={onLiveAgentsEnabled}
        />
      </Row>
      <Row
        settingId="sounds"
        label={t("harness.settings.sounds")}
        description={t("harness.settings.soundsDesc")}
      >
        <Toggle
          label={t("harness.settings.sounds")}
          on={soundsEnabled}
          onChange={onSoundsEnabled}
        />
      </Row>
      <Row
        settingId="claudeHooks"
        label={t("harness.settings.claudeHooks")}
        description={t("harness.settings.claudeHooksDesc")}
      >
        <Toggle
          label={t("harness.settings.claudeHooks")}
          on={claudeHooks}
          onChange={onClaudeHooks}
        />
      </Row>
      {IS_WIN && (
        <Row
          settingId="closeToTray"
          label={t("harness.settings.closeToTray")}
          description={t("harness.settings.closeToTrayDesc")}
        >
          <Toggle
            label={t("harness.settings.closeToTray")}
            on={closeToTray}
            onChange={onCloseToTray}
          />
        </Row>
      )}

      <Heading title={t("harness.chrome.about")} />
      <UpdateRow onOpenWhatsNew={onOpenWhatsNew} />
    </>
  );
}

function ChatPage() {
  const { t } = useTranslation();
  const [transcriptLayout, setTranscriptLayout] =
    useState<TranscriptLayout>(loadTranscriptLayout);
  const [transcriptZen, setTranscriptZen] = useState(loadTranscriptZen);
  const [transcriptAnchor, setTranscriptAnchor] =
    useState(loadTranscriptAnchor);
  const [composerRunner, setComposerRunner] = useState(loadComposerRunner);
  const [followUpBehavior, setFollowUpBehavior] =
    useState<FollowUpBehavior>(loadFollowUpBehavior);
  const [gridArcadeEnabled, setGridArcadeEnabled] = useState(
    loadGridArcadeEnabled,
  );

  useEffect(() => {
    const onZen = (event: Event) => {
      setTranscriptZen((event as CustomEvent<boolean>).detail === true);
    };
    const onAnchor = (event: Event) => {
      setTranscriptAnchor((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(TRANSCRIPT_ZEN_CHANGE_EVENT, onZen);
    window.addEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    return () => {
      window.removeEventListener(TRANSCRIPT_ZEN_CHANGE_EVENT, onZen);
      window.removeEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    };
  }, []);

  const onTranscriptZen = (next: boolean) => {
    saveTranscriptZen(next);
    setTranscriptZen(next);
  };

  const onTranscriptLayout = (next: TranscriptLayout) => {
    saveTranscriptLayout(next);
    setTranscriptLayout(next);
  };

  const onTranscriptAnchor = (next: boolean) => {
    saveTranscriptAnchor(next);
    setTranscriptAnchor(next);
  };

  const onComposerRunner = (next: boolean) => {
    saveComposerRunner(next);
    setComposerRunner(next);
  };

  const onFollowUpBehavior = (next: FollowUpBehavior) => {
    saveFollowUpBehavior(next);
    setFollowUpBehavior(next);
  };

  const onGridArcadeEnabled = (next: boolean) => {
    saveGridArcadeEnabled(next);
    setGridArcadeEnabled(next);
  };

  return (
    <>
      <Row
        settingId="transcriptLayout"
        label={t("harness.settings.transcriptLayout")}
        description={t("harness.settings.transcriptLayoutDesc")}
      >
        <Segmented
          label={t("harness.settings.transcriptLayout")}
          value={transcriptLayout}
          options={[
            { value: "full", label: t("harness.settings.fullWidth") },
            { value: "chat", label: t("harness.settings.chat") },
          ]}
          onChange={onTranscriptLayout}
        />
      </Row>
      <Row
        settingId="followUpBehavior"
        label={t("harness.chrome.followUpBehavior")}
        description={t("harness.chrome.followUpBehaviorDesc")}
      >
        <Segmented
          label={t("harness.chrome.followUpBehavior")}
          value={followUpBehavior}
          options={[
            { value: "queue", label: t("harness.chrome.queue") },
            { value: "steer", label: t("harness.chrome.steer") },
          ]}
          onChange={onFollowUpBehavior}
        />
      </Row>
      <Row
        settingId="anchorPrompts"
        label={t("harness.settings.anchorPrompts")}
        description={t("harness.settings.anchorPromptsDesc")}
      >
        <Toggle
          label={t("harness.settings.anchorPrompts")}
          on={transcriptAnchor}
          onChange={onTranscriptAnchor}
        />
      </Row>
      <Row
        settingId="zenMode"
        label={t("harness.settings.zenMode")}
        description={t("harness.settings.zenModeDesc", {
          shortcut: `${MOD}${ALT}Z`,
        })}
      >
        <Toggle
          label={t("harness.settings.zenMode")}
          on={transcriptZen}
          onChange={onTranscriptZen}
        />
      </Row>
      <Row
        settingId="composerMascot"
        label={t("harness.settings.composerMascot")}
        description={t("harness.settings.composerMascotDesc")}
      >
        <Toggle
          label={t("harness.settings.composerMascot")}
          on={composerRunner}
          onChange={onComposerRunner}
        />
      </Row>
      <Row
        settingId="emptySessionGames"
        label={t("harness.settings.emptySessionGames")}
        description={t("harness.settings.emptySessionGamesDesc")}
      >
        <Toggle
          label={t("harness.settings.emptySessionGames")}
          on={gridArcadeEnabled}
          onChange={onGridArcadeEnabled}
        />
      </Row>
    </>
  );
}

function InboxPage({
  cwd,
  recents = [],
  notificationProjectPath = null,
  notificationSettingsRequest = 0,
}: {
  cwd: string;
  recents?: RecentProject[];
  notificationProjectPath?: string | null;
  notificationSettingsRequest?: number;
}) {
  const { t } = useTranslation();
  const revealed = useContext(RevealedSettingContext);
  return (
    <>
      <div
        id={settingDomId("project-notifications")}
        data-setting-id="project-notifications"
      >
        <ProjectNotificationSettings
          cwd={cwd}
          recents={recents}
          notificationProjectPath={notificationProjectPath}
          notificationSettingsRequest={notificationSettingsRequest}
          highlighted={revealed === "project-notifications"}
        />
      </div>

      <Heading title={t("harness.settings.github")} id={ANCHOR_IDS.github} />
      <GithubSettings />

      <Heading title={t("harness.settings.gitlab")} id={ANCHOR_IDS.gitlab} />
      <GitlabSettings />

      <Heading title={t("harness.chrome.linear")} id={ANCHOR_IDS.linear} />
      <LinearSettings />
    </>
  );
}

function GithubSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const checkStatus = useCallback(async () => {
    const generation = ++request.current;
    setChecking(true);
    setError(null);
    try {
      const next = await githubStatus();
      if (generation === request.current) setStatus(next);
    } catch (err: unknown) {
      if (generation === request.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    return () => {
      request.current += 1;
    };
  }, [checkStatus]);

  const description = status?.connected
    ? t("harness.settings.githubConnectedDesc")
    : status?.installed
      ? t("harness.settings.githubSignInRequiredDesc")
      : t("harness.settings.githubNotInstalledDesc");
  const label = checking
    ? t("harness.settings.githubChecking")
    : status?.connected
      ? t("harness.settings.githubConnected")
      : status?.installed
        ? t("harness.settings.githubSignInRequired")
        : t("harness.settings.githubNotInstalled");

  return (
    <>
      <Row
        label={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="github" className="size-4 shrink-0" />
            {t("harness.settings.githubConnection")}
          </span>
        }
        description={description}
      >
        <span className="text-[12px] text-content/50">{label}</span>
        {!checking && !status?.installed ? (
          <SecondaryButton
            onClick={() => {
              void openUrl("https://cli.github.com/").catch(() => {});
            }}
          >
            {t("harness.settings.githubInstallGuide")}
          </SecondaryButton>
        ) : null}
        <SecondaryButton onClick={() => void checkStatus()} disabled={checking}>
          {checking
            ? t("harness.settings.githubChecking")
            : t("harness.settings.githubCheckAgain")}
        </SecondaryButton>
      </Row>
      {error ? (
        <p className="pb-2 text-[12px] text-red-400/90">{error}</p>
      ) : null}
    </>
  );
}

function GitlabSettings() {
  const { t } = useTranslation();
  const [url, setUrl] = useState("https://gitlab.com");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void gitlabConnected()
      .then((status) => {
        if (cancelled) return;
        setConnected(status.connected);
        setUrl(status.url);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await saveGitlabConfig(url, token);
      setUrl(status.url);
      setToken("");
      setConnected(status.connected);
      clearInboxCache();
    } catch (err: unknown) {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await disconnectGitlab(url);
      setConnected(false);
      setUrl(status.url);
      clearInboxCache();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row
        label={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="gitlab" className="size-4 shrink-0" />
            {t("harness.settings.gitlabConnection")}
          </span>
        }
        description={t("harness.settings.gitlabConnectionDesc")}
      >
        {connected ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-56 truncate text-[12px] text-content/50">
              {url}
            </span>
            <SecondaryButton
              onClick={() => void onDisconnect()}
              disabled={busy}
            >
              {t("harness.chrome.disconnect")}
            </SecondaryButton>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <label className="flex h-7 w-52 shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://gitlab.com"
                aria-label={t("harness.settings.gitlabUrl")}
                autoComplete="url"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <label className="flex h-7 w-52 shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder="glpat-…"
                aria-label={t("harness.settings.gitlabToken")}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <SecondaryButton
              onClick={() => void onSave()}
              disabled={busy || !token.trim()}
            >
              {busy ? t("common.saving") : t("harness.chrome.connect")}
            </SecondaryButton>
          </div>
        )}
      </Row>
      {error ? (
        <p className="pb-2 text-[12px] text-red-400/90">{error}</p>
      ) : null}
    </>
  );
}

function LinearSettings() {
  const { t } = useTranslation();
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [hiddenTeamIds, setHiddenTeamIds] = useState(loadHiddenLinearTeamIds);

  const loadTeams = useCallback(async () => {
    try {
      const next = await listLinearTeams();
      setTeams(next);
    } catch {
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void linearConnected().then((status) => {
      if (cancelled) return;
      setConnected(status.connected);
      if (status.connected) void loadTeams();
    });
    return () => {
      cancelled = true;
    };
  }, [loadTeams]);

  // The inbox filter menu writes the same list, so follow it while both are mounted.
  useEffect(() => {
    const onChange = () => setHiddenTeamIds(loadHiddenLinearTeamIds());
    window.addEventListener(LINEAR_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LINEAR_CHANGE_EVENT, onChange);
  }, []);

  const onSave = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveLinearToken(token);
      setToken("");
      setConnected(true);
      clearInboxCache();
      notifyLinearChange();
      await loadTeams();
    } catch (err: unknown) {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectLinear();
      setConnected(false);
      setTeams([]);
      clearInboxCache();
      notifyLinearChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleTeam = (id: string) => {
    const next = new Set(hiddenTeamIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = [...next];
    setHiddenTeamIds(ids);
    saveHiddenLinearTeamIds(ids);
    clearInboxCache();
  };

  return (
    <>
      <Row
        label={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="linear" className="size-4 shrink-0" />
            {t("harness.chrome.apiKey")}
          </span>
        }
        description={t("harness.chrome.linearApiKeyDesc")}
      >
        {connected ? (
          <SecondaryButton onClick={() => void onDisconnect()} disabled={busy}>
            {t("harness.chrome.disconnect")}
          </SecondaryButton>
        ) : (
          <div className="flex items-center gap-2">
            <label className="flex h-7 w-52 shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder="lin_api_…"
                aria-label={t("harness.chrome.linearApiKey")}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <SecondaryButton
              onClick={() => void onSave()}
              disabled={busy || !token.trim()}
            >
              {busy ? t("dialog.saving") : t("harness.chrome.connect")}
            </SecondaryButton>
          </div>
        )}
      </Row>
      {error ? (
        <p className="pb-2 text-[12px] text-red-400/90">{error}</p>
      ) : null}
      {connected && teams.length > 0 ? (
        <div className="border-b border-content/5 py-4">
          <div className="text-[13px] font-medium text-content">
            {t("harness.chrome.linearTeams")}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {t("harness.chrome.uncheckedTeamsHint")}
          </p>
          <div className="mt-3 flex flex-col gap-0.5 -mx-2">
            {teams.map((team) => {
              const checked = !hiddenTeamIds.includes(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] text-content hover:bg-content/5"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {team.name}
                    {team.key ? (
                      <span className="ml-1.5 text-content/40">{team.key}</span>
                    ) : null}
                  </span>
                  {checked ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={2.25} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

function UpdateRow({
  onOpenWhatsNew,
}: {
  onOpenWhatsNew: (version: string) => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  useEffect(() => {
    let cancelled = false;
    void readAppVersion().then((currentVersion) => {
      if (cancelled) return;
      setSnapshot((current) => ({ ...current, currentVersion }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy =
    snapshot.phase === "checking" || snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available";

  const onClick = async () => {
    if (busy) return;
    if (hasUpdate) {
      await installPendingUpdate(setSnapshot);
      return;
    }
    await runUpdateFlow(true, setSnapshot);
  };

  const status =
    snapshot.phase === "available"
      ? t("harness.chrome.updateAvailable", {
          version: snapshot.availableVersion ?? snapshot.currentVersion,
        })
      : snapshot.phase === "downloading"
        ? `Downloading${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
        : snapshot.phase === "checking"
          ? t("harness.chrome.checkingForUpdates")
          : snapshot.phase === "current"
            ? t("harness.chrome.latestVersion")
            : snapshot.phase === "error"
              ? (snapshot.error ?? t("harness.chrome.updateCheckFailed"))
              : t("harness.chrome.updatesFromReleaseFeed");

  return (
    <Row
      label={
        <span className="flex items-baseline gap-2">
          {t("harness.chrome.version")}
          <span className="font-mono text-[12px] text-content/45">
            {snapshot.currentVersion}
          </span>
        </span>
      }
      description={status}
    >
      <div className="flex items-center gap-2">
        <SecondaryButton
          onClick={() => onOpenWhatsNew(snapshot.currentVersion)}
          disabled={snapshot.currentVersion === "…"}
        >
          {t("harness.chrome.whatsNew")}
        </SecondaryButton>
        <SecondaryButton onClick={() => void onClick()} disabled={busy}>
          {busy ? (
          <Loader className="size-3.5 animate-spin" aria-hidden />
        ) : hasUpdate ? (
          <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
        ) : (
          <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
          {hasUpdate
            ? t("harness.chrome.download")
            : t("harness.chrome.checkForUpdates")}
        </SecondaryButton>
      </div>
    </Row>
  );
}

type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;

function useAppearanceSettings() {
  const [chatBackgroundPath, setChatBackgroundPath] = useState(
    loadChatBackgroundPath,
  );
  const [chatBackgroundOpacity, setChatBackgroundOpacity] = useState(
    loadChatBackgroundOpacity,
  );
  const [chatBackgroundScope, setChatBackgroundScope] =
    useState<ChatBackgroundScope>(loadChatBackgroundScope);
  const [chatBackgroundBusy, setChatBackgroundBusy] = useState(false);
  const [chatBackgroundError, setChatBackgroundError] = useState<string | null>(
    null,
  );

  const onChooseChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      const path = await pickAndSaveChatBackground();
      if (!path) return;
      saveChatBackgroundPath(path);
      applyChatBackground(path);
      setChatBackgroundPath(path);
    } catch (error) {
      setChatBackgroundError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onClearChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      await removeChatBackground();
      saveChatBackgroundPath(null);
      applyChatBackground(null);
      setChatBackgroundPath(null);
    } catch (error) {
      setChatBackgroundError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onChatBackgroundOpacity = useCallback((percent: number) => {
    const next = applyChatBackgroundOpacity(percent / 100);
    saveChatBackgroundOpacity(next);
    setChatBackgroundOpacity(next);
  }, []);

  const onChatBackgroundScope = useCallback((next: ChatBackgroundScope) => {
    applyChatBackgroundScope(next);
    saveChatBackgroundScope(next);
    setChatBackgroundScope(next);
  }, []);

  return {
    chatBackgroundPath,
    chatBackgroundOpacity,
    chatBackgroundScope,
    chatBackgroundBusy,
    chatBackgroundError,
    onChooseChatBackground,
    onClearChatBackground,
    onChatBackgroundOpacity,
    onChatBackgroundScope,
  };
}

function AppearancePage({ appearance }: { appearance: AppearanceSettings }) {
  return <ChatBackgroundCard appearance={appearance} />;
}

function ChatBackgroundCard({
  appearance,
}: {
  appearance: AppearanceSettings;
}) {
  const { t } = useTranslation();
  const src = chatBackgroundSrc(appearance.chatBackgroundPath);
  const hasImage = Boolean(appearance.chatBackgroundPath && src);
  const visibility = Math.round(appearance.chatBackgroundOpacity * 100);
  const busy = appearance.chatBackgroundBusy;

  return (
    <div className="border-b border-content/5 py-4 last:border-b-0">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-content">
            {t("harness.chrome.chatBackground")}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {t("harness.chrome.chatBackgroundDesc")}
          </p>
        </div>
        {hasImage ? (
          <div className="flex shrink-0 items-center gap-2">
            <SecondaryButton
              onClick={() => void appearance.onChooseChatBackground()}
              disabled={busy}
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              {t("harness.chrome.change")}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => void appearance.onClearChatBackground()}
              disabled={busy}
              danger
            >
              {t("harness.chrome.remove")}
            </SecondaryButton>
          </div>
        ) : null}
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-content/10">
        {hasImage ? (
          <div className="relative h-36">
            <img
              src={src ?? undefined}
              alt=""
              draggable={false}
              className="size-full object-cover"
              style={{ opacity: appearance.chatBackgroundOpacity }}
            />
            <span className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-content/40">
              {t("harness.chrome.previewAt", { visibility })}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void appearance.onChooseChatBackground()}
            disabled={busy}
            className="flex h-36 w-full flex-col items-center justify-center gap-2 text-content/40 hover:bg-content/5 hover:text-content/70 disabled:cursor-default disabled:opacity-40"
          >
            {busy ? (
              <Loader className="size-5 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-5" aria-hidden />
            )}
            <span className="text-[12px]">{t("harness.chrome.chooseAnImage")}</span>
          </button>
        )}
        {hasImage ? (
          <div className="border-t border-content/8">
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12px] text-content">
                  {t("harness.chrome.showOn")}
                </div>
                <p className="text-[11px] text-content/40">
                  {t("harness.chrome.showOnEmptyHint")}
                </p>
              </div>
              <Segmented
                label={t("harness.chrome.showBackgroundOn")}
                value={appearance.chatBackgroundScope}
                options={[
                  { value: "empty", label: t("harness.chrome.emptyOnly") },
                  { value: "all", label: t("harness.chrome.allSessions") },
                ]}
                onChange={appearance.onChatBackgroundScope}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-content/5 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12px] text-content">
                  {t("harness.chrome.visibility")}
                </div>
                <p className="text-[11px] text-content/40">
                  {t("harness.chrome.visibilityHint")}
                </p>
              </div>
              <Slider
                label={t("harness.chrome.backgroundVisibility")}
                value={visibility}
                display={`${visibility}%`}
                min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
                max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
                onChange={appearance.onChatBackgroundOpacity}
              />
            </div>
          </div>
        ) : null}
      </div>
      {appearance.chatBackgroundError ? (
        <p className="mt-2 text-[12px] text-red-400">
          {appearance.chatBackgroundError}
        </p>
      ) : null}
    </div>
  );
}

function KeybindingsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      filterKeybindings(KEYBINDINGS, query, (command) =>
        keybindingCommandLabel(t, command),
      ),
    [query, t],
  );

  return (
    <>
      <div className="flex items-center justify-end gap-3 pb-3">
        <span className="shrink-0 text-[12px] text-content/40 tabular-nums">
          {t("harness.chrome.bindingCount", { count: rows.length })}
        </span>
        <label className="flex h-7 w-52 shrink-0 items-center gap-2 rounded-md border border-content/10 px-2 text-content/45 focus-within:border-content/20">
          <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("harness.chrome.filter")}
            aria-label={t("harness.chrome.filterKeybindings")}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-content/10">
        <div className="flex items-center border-b border-content/10 bg-content/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-content/40">
          <span className="min-w-0 flex-1">{t("harness.chrome.command")}</span>
          <span className="w-40 shrink-0">{t("harness.chrome.keybinding")}</span>
          <span className="w-28 shrink-0">{t("harness.chrome.when")}</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-content/45">
            {t("harness.chrome.noMatchingBindings")}
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.command}-${row.keys}`}
              className="flex items-center border-b border-content/5 px-3 py-2 text-[12px] last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">
                {keybindingCommandLabel(t, row.command)}
              </span>
              <span className="w-40 shrink-0 font-mono text-[12px] text-content/80">
                {row.keys}
              </span>
              <span className="w-28 shrink-0 font-mono text-[11px] text-content/40">
                {keybindingWhenLabel(t, row.when)}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="pt-3 text-[12px] text-content/40">
        {t("harness.chrome.keybindingsDesc")}
      </p>
    </>
  );
}

function ProvidersPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="max-w-2xl text-[12px] leading-relaxed text-content/50">
        {t("harness.settings.providersIntro")}
      </p>
      <button
        type="button"
        onClick={() => void openSettingsWindow("harness")}
        className="flex h-8 items-center rounded-md border border-content/10 px-3 text-[11px] font-medium text-content/75 transition-colors hover:bg-content/5 hover:text-content"
      >
        {t("common.open")} {t("harness.settings.title")}
      </button>
    </div>
  );
}

function useArchivedProjects(): ArchivedProject[] {
  const [items, setItems] = useState(loadArchivedProjects);
  useEffect(
    () => subscribeArchivedProjects(() => setItems(loadArchivedProjects())),
    [],
  );
  return items;
}

function archivedProjectLabel(path: string): string {
  return resolveTabGroupLabel(
    projectKey(path),
    loadTabGroupLabels(),
    projectName(path),
  );
}

function ArchivePage({
  cwd,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
}: {
  cwd: string;
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState(loadSessionSidebarFilters);
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const archivedProjects = useArchivedProjects();
  const archived = useMemo(
    () =>
      sessions
        .filter((session) => session.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const onShowArchived = (showArchived: boolean) => {
    const next = { ...filters, showArchived };
    saveSessionSidebarFilters(next);
    setFilters(next);
  };

  return (
    <>
      <Heading title={t("harness.chrome.archivedProjects")} first />
      {archivedProjects.length === 0 ? (
        <p className="py-3 text-[12px] text-content/45">
          {t("harness.chrome.archiveProjectHint")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-content/10">
          {archivedProjects.map((project) => (
            <div
              key={project.path}
              className="flex items-center gap-3 border-b border-content/5 px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">
                  {archivedProjectLabel(project.path)}
                </div>
                <div className="truncate text-[11px] text-content/40">
                  {prettyCwd(project.path)}
                </div>
              </div>
              {onRestoreProject ? (
                <SecondaryButton onClick={() => onRestoreProject(project.path)}>
                  {t("harness.chrome.restore")}
                </SecondaryButton>
              ) : null}
              {onDeleteProject ? (
                <SecondaryButton danger onClick={() => setDeleting(project)}>
                  {t("common.delete")}
                </SecondaryButton>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Row
        label={t("harness.chrome.showArchivedSidebar")}
        description={t("harness.chrome.showArchivedSidebarDesc")}
      >
        <Toggle
          label={t("harness.chrome.showArchivedSidebar")}
          on={filters.showArchived}
          onChange={onShowArchived}
        />
      </Row>

      <Heading
        title={
          looksLikeProject(cwd)
            ? t("harness.chrome.archivedIn", { name: projectName(cwd) })
            : t("harness.chrome.archivedConversations")
        }
      />

      {!looksLikeProject(cwd) ? (
        <p className="py-3 text-[12px] text-content/45">
          {t("harness.chrome.openProjectForArchived")}
        </p>
      ) : archived.length === 0 ? (
        <p className="py-3 text-[12px] text-content/45">
          {t("harness.chrome.noArchivedConversations")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-content/10">
          {archived.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 border-b border-content/5 px-3 py-2 last:border-b-0"
            >
              <HarnessIcon
                harness={session.harness}
                className="size-3.5 shrink-0"
              />
              <button
                type="button"
                onClick={() => onOpenSession(session.id)}
                className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-content"
              >
                {sessionDisplayTitle(session.title, session.harness)}
              </button>
              <span className="shrink-0 text-[11px] text-content/35 tabular-nums">
                {formatDate(session.updatedAt)}
              </span>
              <SecondaryButton
                onClick={() => onArchiveSession(session.id, false)}
              >
                {t("harness.chrome.unarchive")}
              </SecondaryButton>
              <SecondaryButton
                danger
                onClick={() => onDeleteSession(session.id)}
              >
                {t("common.delete")}
              </SecondaryButton>
            </div>
          ))}
        </div>
      )}

      {deleting ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDeleteProject?.(deleting.path);
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="pb-4">
      <h1 className="text-[20px] font-semibold leading-tight text-content">
        {title}
      </h1>
      {description ? (
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-content/45">
          {description}
        </p>
      ) : null}
    </header>
  );
}

function Heading({
  title,
  id,
  first = false,
}: {
  title: string;
  id?: string;
  first?: boolean;
}) {
  return (
    <h2
      id={id}
      className={`pb-1 text-[15px] font-semibold text-content ${
        first ? "" : "pt-8"
      }`}
    >
      {title}
    </h2>
  );
}

function Row({
  id,
  settingId,
  label,
  description,
  children,
}: {
  id?: string;
  settingId?: string;
  label: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
  const revealedId = useContext(RevealedSettingContext);
  const domId = id ?? (settingId ? settingDomId(settingId) : undefined);
  const isRevealed = Boolean(settingId && revealedId === settingId);

  return (
    <div
      id={domId}
      data-setting-id={settingId}
      className={`flex items-start gap-6 border-b border-content/5 py-4 last:border-b-0 transition-all duration-500 ${
        isRevealed
          ? "-mx-3 rounded-lg bg-accent/15 px-3 ring-1 ring-accent/40"
          : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-content">{label}</div>
        {description ? (
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-grid shrink-0 gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-w-0 whitespace-nowrap rounded-[5px] px-2.5 py-1 ${
            value === option.value
              ? "bg-content/10 text-content"
              : "text-content/50 hover:text-content"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        className="sidebar-opacity-slider min-w-0 flex-1"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-10 shrink-0 text-right text-[12px] text-content tabular-nums">
        {display}
      </span>
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={() => {
        playCue("switch");
        onChange(!on);
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-content/20"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${
          on ? "left-4.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

function SecondaryButton({
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1 text-[12px] ${
        danger
          ? "text-red-400 hover:border-red-400/40 hover:bg-red-400/10"
          : "text-content/70 hover:bg-content/10 hover:text-content"
      } disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}
