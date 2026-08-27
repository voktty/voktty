import {
  type AutocompleteProviderId,
  type CustomEndpoint,
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_MODEL_ID,
  DEFAULT_STT_PROVIDER,
  isKnownModelId,
  LMSTUDIO_DEFAULT_BASE_URL,
  MLX_DEFAULT_BASE_URL,
  type ModelId,
  migrateLegacyCompatEndpoint,
  OLLAMA_DEFAULT_BASE_URL,
  OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  type SttProvider,
  WHISPERCPP_DEFAULT_BASE_URL,
} from "@/modules/ai/config";
import {
  type AgentLaunchCommands,
  DEFAULT_AGENT_LAUNCH_COMMANDS,
  normalizeAgentLaunchCommands,
} from "@/modules/agents/lib/launcher";
import { type LanguageId, isLanguageId } from "@/modules/i18n/types";
import { applyDocumentLocale } from "@/modules/i18n/direction";
import type { SshConnection } from "@/modules/ssh/types";
import type { SshTunnelConfig } from "@/modules/ssh/tunnels/types";
import type { KeyBinding, ShortcutId } from "@/modules/shortcuts/shortcuts";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { getOptimalInitialZoomLevel } from "@/lib/optimalZoom";
import { ensureStorageMigrated } from "@/lib/storageMigration";

export type ThemePref = "system" | "light" | "dark";

export const DEFAULT_THEME_ID = "voktty-default";

export type BackgroundKind = "none" | "image";

export type TerminalCursorStyle = "bar" | "block" | "underline";

export type TabStyle = "horizontal" | "vertical";

export type SourceControlViewMode = "list" | "tree";

export function isSourceControlViewMode(
  value: unknown,
): value is SourceControlViewMode {
  return value === "list" || value === "tree";
}

export const TAB_STYLES = ["horizontal", "vertical"] as const;

export function isTabStyle(value: unknown): value is TabStyle {
  return (
    typeof value === "string" &&
    (TAB_STYLES as readonly string[]).includes(value)
  );
}

export const TAB_STYLE_LABELS: Record<TabStyle, string> = {
  horizontal: "Horizontal (top)",
  vertical: "Vertical (right)",
};

export const EDITOR_THEMES = [
  "kanagawa",
  "kanagawa-lotus",
  "kanagawa-dragon",
  "tokyo-night",
  "catppuccin-mocha",
  "catppuccin-latte",
  "rose-pine",
  "rose-pine-dawn",
  "everforest",
  "everforest-light",
  "dracula",
  "solarized-dark",
  "solarized-light",
  "nord",
  "gruvbox-dark",
  "atomone",
  "aura",
  "copilot",
  "github-dark",
  "github-light",
  "xcode-dark",
  "xcode-light",
] as const;

export type EditorThemeId = (typeof EDITOR_THEMES)[number];

/** "auto" follows the active app theme's editorTheme pairing (resolved live). */
export const EDITOR_THEME_AUTO = "auto" as const;
export type EditorThemePref = typeof EDITOR_THEME_AUTO | EditorThemeId;

export function isEditorThemeId(v: unknown): v is EditorThemeId {
  return (
    typeof v === "string" && (EDITOR_THEMES as readonly string[]).includes(v)
  );
}

export const EDITOR_THEME_MODE: Record<EditorThemeId, "light" | "dark"> = {
  kanagawa: "dark",
  "kanagawa-lotus": "light",
  "kanagawa-dragon": "dark",
  "tokyo-night": "dark",
  "catppuccin-mocha": "dark",
  "catppuccin-latte": "light",
  "rose-pine": "dark",
  "rose-pine-dawn": "light",
  everforest: "dark",
  "everforest-light": "light",
  dracula: "dark",
  "solarized-dark": "dark",
  "solarized-light": "light",
  nord: "dark",
  "gruvbox-dark": "dark",
  atomone: "dark",
  aura: "dark",
  copilot: "dark",
  "github-dark": "dark",
  "github-light": "light",
  "xcode-dark": "dark",
  "xcode-light": "light",
};

export const EDITOR_THEME_LABELS: Record<EditorThemeId, string> = {
  kanagawa: "Kanagawa Wave",
  "kanagawa-lotus": "Kanagawa Lotus",
  "kanagawa-dragon": "Kanagawa Dragon",
  "tokyo-night": "Tokyo Night",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte",
  "rose-pine": "Rosé Pine",
  "rose-pine-dawn": "Rosé Pine Dawn",
  everforest: "Everforest Dark",
  "everforest-light": "Everforest Light",
  dracula: "Dracula",
  "solarized-dark": "Solarized Dark",
  "solarized-light": "Solarized Light",
  nord: "Nord",
  "gruvbox-dark": "Gruvbox Dark",
  atomone: "Atom One",
  aura: "Aura",
  copilot: "Copilot",
  "github-dark": "GitHub Dark",
  "github-light": "GitHub Light",
  "xcode-dark": "Xcode Dark",
  "xcode-light": "Xcode Light",
};

export type Preferences = {
  language: LanguageId;
  theme: ThemePref;
  themeId: string;
  backgroundKind: BackgroundKind;
  backgroundImageId: string | null;
  backgroundOpacity: number;
  backgroundBlur: number;
  windowVibrancy: boolean;
  aiEnabled: boolean;
  aiConfigRevision: number;
  aiHealthRevision: number | null;
  aiHealthCheckedAt: number | null;
  defaultModelId: ModelId;
  editorTheme: EditorThemePref;
  editorFontSize: number;
  customInstructions: string;
  autostart: boolean;
  restoreWindowState: boolean;
  autocompleteEnabled: boolean;
  autocompleteTrigger: AutocompleteTrigger;
  autocompleteProvider: AutocompleteProviderId;
  autocompleteModelId: string;
  lmstudioBaseURL: string;
  lmstudioModelId: string;
  mlxBaseURL: string;
  mlxModelId: string;
  ollamaBaseURL: string;
  ollamaModelId: string;
  openaiCompatibleBaseURL: string;
  openaiCompatibleModelId: string;
  openaiCompatibleContextLimit: number;
  customEndpoints: CustomEndpoint[];
  openrouterModelId: string;
  sttProvider: SttProvider;
  groqSttModel: string;
  whispercppBaseURL: string;
  favoriteModelIds: string[];
  recentModelIds: string[];
  vimMode: boolean;
  editorWordWrap: boolean;
  editorMinimap: boolean;
  editorSemanticHighlighting: boolean;
  editorInlayHints: boolean;
  editorWordWrapColumn: number;
  showHidden: boolean;
  explorerGitDecorations: boolean;
  sourceControlViewMode: SourceControlViewMode;
  gitCommitMessageUseEditorLanguage: boolean;
  terminalWebglEnabled: boolean;
  terminalCursorBlink: boolean;
  terminalCursorStyle: TerminalCursorStyle;
  terminalFontFamily: string;
  terminalFontWeight: string;
  terminalShell: string;
  terminalLetterSpacing: number;
  terminalFontSize: number;
  terminalScrollback: number;
  confirmCloseRunningTerminal: boolean;
  terminalSuggestEnabled: boolean;
  lastWslDistro: string | null;
  zoomLevel: number;
  soundEnabled: boolean;
  soundVolume: number;
  agentAvatarEnabled: boolean;
  agentAvatarSize: AgentAvatarSize;
  agentAvatarAnimationIntensity: AgentAvatarAnimationIntensity;
  agentAvatarReducedMotion: boolean;
  agentNotifications: boolean;
  agentNotificationSound: boolean;
  agentLaunchCommands: AgentLaunchCommands;
  defaultWorkspaceEnv: string;
  spaceViewLimit: SpaceViewLimit;
  shortcuts: Record<ShortcutId, KeyBinding[]>;
  editorAutoSave: boolean;
  editorAutoSaveDelay: number;
  tabStyle: TabStyle;
  editorFormatOnSave: boolean;
  editorFormatter: EditorFormatter;
  /** languageResolver id -> formatter, overriding the global default. */
  editorFormatterByLang: Record<string, EditorFormatter>;
  /** Shell template for the "custom" formatter; {file} is the quoted path. */
  editorCustomFormatCommand: string;
  lspActivation: Record<string, LspActivation>;
  lspCustomServers: LspCustomServer[];
  sshConnections: SshConnection[];
  sshTunnels: SshTunnelConfig[];
  dockerEnabled: boolean;
  dockerCustomHost: string;
  dockerDefaultShell: string;
  hasCompletedOnboarding: boolean;
};

export const SPACE_VIEW_LIMITS = [2, 4, 6, 8] as const;
export type SpaceViewLimit = (typeof SPACE_VIEW_LIMITS)[number];

export function isSpaceViewLimit(value: unknown): value is SpaceViewLimit {
  return typeof value === "number" && SPACE_VIEW_LIMITS.includes(value as SpaceViewLimit);
}

export type EditorFormatter =
  | "lsp"
  | "biome"
  | "prettier"
  | "ruff"
  | "rustfmt"
  | "gofmt"
  | "clang-format"
  | "shfmt"
  | "zigfmt"
  | "custom";

export type LspActivation = "enabled" | "dismissed";

export type AgentAvatarSize = "compact" | "standard" | "large";
export type AgentAvatarAnimationIntensity = "low" | "standard" | "high";

export type LspCustomServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** languageResolver id -> LSP languageId */
  languages: Record<string, string>;
  rootMarkers: string[];
};

const STORE_PATH = "voktty-settings.json";
const KEY_LANGUAGE = "language";
const KEY_SSH_CONNECTIONS = "ssh_connections";
const KEY_SSH_TUNNELS = "ssh_tunnels";
const KEY_TAB_STYLE = "tabStyle";
const KEY_THEME = "theme";
const KEY_THEME_ID = "themeId";
const KEY_BG_KIND = "backgroundKind";
const KEY_BG_IMAGE_ID = "backgroundImageId";
const KEY_BG_OPACITY = "backgroundOpacity";
const KEY_BG_BLUR = "backgroundBlur";
const KEY_WINDOW_VIBRANCY = "windowVibrancy";
const KEY_AI_ENABLED = "aiEnabled";
const KEY_AI_CONFIG_REVISION = "aiConfigRevision";
const KEY_AI_HEALTH_REVISION = "aiHealthRevision";
const KEY_AI_HEALTH_CHECKED_AT = "aiHealthCheckedAt";
const KEY_DEFAULT_MODEL = "defaultModelId";
const KEY_EDITOR_THEME = "editorTheme";
const KEY_EDITOR_FONT_SIZE = "editorFontSize";
const KEY_CUSTOM_INSTRUCTIONS = "customInstructions";
const KEY_AUTOSTART = "autostart";
const KEY_RESTORE_WINDOW = "restoreWindowState";
export type AutocompleteTrigger = "auto" | "manual";

const KEY_AUTOCOMPLETE_ENABLED = "autocompleteEnabled";
const KEY_AUTOCOMPLETE_TRIGGER = "autocompleteTrigger";
const KEY_AUTOCOMPLETE_PROVIDER = "autocompleteProvider";
const KEY_AUTOCOMPLETE_MODEL = "autocompleteModelId";
const KEY_LMSTUDIO_BASE_URL = "lmstudioBaseURL";
const KEY_LMSTUDIO_MODEL_ID = "lmstudioModelId";
const KEY_MLX_BASE_URL = "mlxBaseURL";
const KEY_MLX_MODEL_ID = "mlxModelId";
const KEY_OLLAMA_BASE_URL = "ollamaBaseURL";
const KEY_OLLAMA_MODEL_ID = "ollamaModelId";
const KEY_OPENAI_COMPAT_BASE_URL = "openaiCompatibleBaseURL";
const KEY_OPENAI_COMPAT_MODEL_ID = "openaiCompatibleModelId";
const KEY_OPENAI_COMPAT_CONTEXT_LIMIT = "openaiCompatibleContextLimit";
const KEY_CUSTOM_ENDPOINTS = "customEndpoints";
const KEY_OPENROUTER_MODEL_ID = "openrouterModelId";
const KEY_STT_PROVIDER = "sttProvider";
const KEY_GROQ_STT_MODEL = "groqSttModel";
const KEY_WHISPERCPP_BASE_URL = "whispercppBaseURL";
const KEY_FAVORITE_MODELS = "favoriteModelIds";
const KEY_RECENT_MODELS = "recentModelIds";
const KEY_VIM_MODE = "vimMode";
const KEY_EDITOR_WORD_WRAP = "editorWordWrap";
const KEY_EDITOR_MINIMAP = "editorMinimap";
const KEY_EDITOR_SEMANTIC_HIGHLIGHTING = "editorSemanticHighlighting";
const KEY_EDITOR_INLAY_HINTS = "editorInlayHints";
const KEY_EDITOR_WORD_WRAP_COLUMN = "editorWordWrapColumn";
const KEY_SHOW_HIDDEN = "showHidden";
const LEGACY_KEY_SHOW_HIDDEN_DIRS = "showHiddenDirectories";
const KEY_EXPLORER_GIT_DECORATIONS = "explorerGitDecorations";
const KEY_SOURCE_CONTROL_VIEW_MODE = "sourceControlViewMode";
const KEY_GIT_COMMIT_USE_EDITOR_LANGUAGE = "gitCommitMessageUseEditorLanguage";
const KEY_TERMINAL_WEBGL_ENABLED = "terminalWebglEnabled";
const KEY_TERMINAL_CURSOR_BLINK = "terminalCursorBlink";
const KEY_TERMINAL_CURSOR_STYLE = "terminalCursorStyle";
const KEY_TERMINAL_FONT_FAMILY = "terminalFontFamily";
const KEY_TERMINAL_FONT_WEIGHT = "terminalFontWeight";
const KEY_TERMINAL_SHELL = "terminalShell";
const KEY_TERMINAL_LETTER_SPACING = "terminalLetterSpacing";
const KEY_TERMINAL_FONT_SIZE = "terminalFontSize";
const KEY_TERMINAL_SCROLLBACK = "terminalScrollback";
const KEY_CONFIRM_CLOSE_RUNNING_TERMINAL = "confirmCloseRunningTerminal";
const KEY_TERMINAL_SUGGEST_ENABLED = "terminalSuggestEnabled";
const KEY_LAST_WSL_DISTRO = "lastWslDistro";
const KEY_ZOOM_LEVEL = "zoomLevel";
const KEY_SOUND_ENABLED = "soundEnabled";
const KEY_SOUND_VOLUME = "soundVolume";
const KEY_AGENT_AVATAR_ENABLED = "agentAvatarEnabled";
const KEY_AGENT_AVATAR_SIZE = "agentAvatarSize";
const KEY_AGENT_AVATAR_INTENSITY = "agentAvatarAnimationIntensity";
const KEY_AGENT_AVATAR_REDUCED_MOTION = "agentAvatarReducedMotion";
const KEY_AGENT_NOTIFICATIONS = "agentNotifications";
const KEY_AGENT_NOTIFICATION_SOUND = "agentNotificationSound";
const KEY_AGENT_LAUNCH_COMMANDS = "agentLaunchCommands";
const KEY_DEFAULT_WORKSPACE_ENV = "defaultWorkspaceEnv";
const KEY_SPACE_VIEW_LIMIT = "spaceViewLimit";
const KEY_SHORTCUTS = "shortcuts";
const KEY_EDITOR_AUTO_SAVE = "editorAutoSave";
const KEY_EDITOR_AUTO_SAVE_DELAY = "editorAutoSaveDelay";
const KEY_EDITOR_FORMAT_ON_SAVE = "editorFormatOnSave";
const KEY_EDITOR_FORMATTER = "editorFormatter";
const KEY_EDITOR_FORMATTER_BY_LANG = "editorFormatterByLang";
const KEY_EDITOR_CUSTOM_FORMAT_COMMAND = "editorCustomFormatCommand";
const KEY_LSP_ACTIVATION = "lspActivation";
const KEY_LSP_CUSTOM_SERVERS = "lspCustomServers";
const KEY_DOCKER_ENABLED = "dockerEnabled";
const KEY_DOCKER_CUSTOM_HOST = "dockerCustomHost";
const KEY_DOCKER_DEFAULT_SHELL = "dockerDefaultShell";
const KEY_HAS_COMPLETED_ONBOARDING = "hasCompletedOnboarding";

export const TERMINAL_FONT_SIZE_DEFAULT = 13;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const TERMINAL_FONT_SIZES = [
  10, 12, 13, 14, 15, 16, 18, 20, 22, 24,
] as const;

export const EDITOR_FONT_SIZE_DEFAULT = 13;
export const EDITOR_FONT_SIZE_MIN = 8;
export const EDITOR_FONT_SIZE_MAX = 32;
export const EDITOR_FONT_SIZES = [
  10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24,
] as const;

export const EDITOR_WORD_WRAP_COLUMN_DEFAULT = 80;
export const EDITOR_WORD_WRAP_COLUMN_MIN = 20;
export const EDITOR_WORD_WRAP_COLUMN_MAX = 500;

export const TERMINAL_SCROLLBACK_DEFAULT = 2000;
export const TERMINAL_SCROLLBACK_MIN = 200;
export const TERMINAL_SCROLLBACK_MAX = 50_000;
export const TERMINAL_SCROLLBACK_PRESETS = [
  500, 1000, 2000, 5000, 10_000, 25_000,
] as const;

export const SOUND_VOLUME_DEFAULT = 0.65;
export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 1;

export const AGENT_AVATAR_SIZES: readonly AgentAvatarSize[] = [
  "compact",
  "standard",
  "large",
];

export const AGENT_AVATAR_ANIMATION_INTENSITIES: readonly AgentAvatarAnimationIntensity[] =
  ["low", "standard", "high"];

function isAgentAvatarSize(value: unknown): value is AgentAvatarSize {
  return AGENT_AVATAR_SIZES.includes(value as AgentAvatarSize);
}

function isAgentAvatarAnimationIntensity(
  value: unknown,
): value is AgentAvatarAnimationIntensity {
  return AGENT_AVATAR_ANIMATION_INTENSITIES.includes(
    value as AgentAvatarAnimationIntensity,
  );
}

export function clampSoundVolume(value: number): number {
  if (!Number.isFinite(value)) return SOUND_VOLUME_DEFAULT;
  return Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, value));
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "en",
  theme: "system",
  themeId: DEFAULT_THEME_ID,
  backgroundKind: "none",
  backgroundImageId: null,
  backgroundOpacity: 0.5,
  backgroundBlur: 0,
  aiEnabled: false,
  aiConfigRevision: 0,
  aiHealthRevision: null,
  aiHealthCheckedAt: null,
  defaultModelId: DEFAULT_MODEL_ID,
  editorTheme: EDITOR_THEME_AUTO,
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  customInstructions: "",
  autostart: false,
  windowVibrancy: true,
  restoreWindowState: true,
  autocompleteEnabled: false,
  autocompleteTrigger: "auto",
  autocompleteProvider: "cerebras",
  autocompleteModelId: DEFAULT_AUTOCOMPLETE_MODEL.cerebras ?? "",
  lmstudioBaseURL: LMSTUDIO_DEFAULT_BASE_URL,
  lmstudioModelId: "",
  mlxBaseURL: MLX_DEFAULT_BASE_URL,
  mlxModelId: "",
  ollamaBaseURL: OLLAMA_DEFAULT_BASE_URL,
  ollamaModelId: "",
  openaiCompatibleBaseURL: OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  openaiCompatibleModelId: "",
  openaiCompatibleContextLimit: 128_000,
  customEndpoints: [],
  openrouterModelId: "",
  sttProvider: DEFAULT_STT_PROVIDER,
  groqSttModel: "whisper-large-v3-turbo",
  whispercppBaseURL: WHISPERCPP_DEFAULT_BASE_URL,
  favoriteModelIds: [],
  recentModelIds: [],
  vimMode: false,
  editorWordWrap: false,
  editorMinimap: false,
  editorSemanticHighlighting: true,
  editorInlayHints: true,
  editorWordWrapColumn: EDITOR_WORD_WRAP_COLUMN_DEFAULT,
  showHidden: false,
  explorerGitDecorations: true,
  sourceControlViewMode: "list",
  gitCommitMessageUseEditorLanguage: false,
  terminalWebglEnabled: true,
  terminalCursorBlink: false,
  terminalCursorStyle: "bar",
  terminalFontFamily: "",
  terminalFontWeight: "normal",
  terminalShell: "",
  terminalLetterSpacing: 0,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalScrollback: TERMINAL_SCROLLBACK_DEFAULT,
  confirmCloseRunningTerminal: true,
  terminalSuggestEnabled: true,
  lastWslDistro: null,
  zoomLevel: 1.0,
  soundEnabled: true,
  soundVolume: SOUND_VOLUME_DEFAULT,
  agentAvatarEnabled: true,
  agentAvatarSize: "standard",
  agentAvatarAnimationIntensity: "standard",
  agentAvatarReducedMotion: false,
  agentNotifications: true,
  agentNotificationSound: true,
  agentLaunchCommands: DEFAULT_AGENT_LAUNCH_COMMANDS,
  defaultWorkspaceEnv: "local",
  spaceViewLimit: 4,
  shortcuts: {} as Record<ShortcutId, KeyBinding[]>,
  editorAutoSave: false,
  editorAutoSaveDelay: 1000,
  tabStyle: "horizontal",
  editorFormatOnSave: false,
  editorFormatter: "lsp",
  editorFormatterByLang: {},
  editorCustomFormatCommand: "",
  lspActivation: {},
  lspCustomServers: [],
  sshConnections: [],
  sshTunnels: [],
  dockerEnabled: false,
  dockerCustomHost: "",
  dockerDefaultShell: "/bin/sh",
  hasCompletedOnboarding: false,
};

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

// LazyStore.onChange only fires within the writing process. The settings
// page lives in a separate webview, so writes there never reach the main
// window's subscribers. Mirror every setter through a Tauri event so any
// window can listen.
const PREFS_CHANGED_EVENT = "voktty://prefs-changed";

async function writePref<T>(key: string, value: T): Promise<void> {
  await store.set(key, value);
  await store.save();
  await emit(PREFS_CHANGED_EVENT, { key, value });
}

const AI_CONFIGURATION_KEYS = new Set([
  KEY_DEFAULT_MODEL,
  KEY_LMSTUDIO_BASE_URL,
  KEY_LMSTUDIO_MODEL_ID,
  KEY_MLX_BASE_URL,
  KEY_MLX_MODEL_ID,
  KEY_OLLAMA_BASE_URL,
  KEY_OLLAMA_MODEL_ID,
  KEY_OPENAI_COMPAT_BASE_URL,
  KEY_OPENAI_COMPAT_MODEL_ID,
  KEY_OPENAI_COMPAT_CONTEXT_LIMIT,
  KEY_CUSTOM_ENDPOINTS,
  KEY_OPENROUTER_MODEL_ID,
]);

async function writeAiConfigurationPref<T>(
  key: string,
  value: T,
): Promise<void> {
  const revision = ((await store.get<number>(KEY_AI_CONFIG_REVISION)) ?? 0) + 1;
  await store.set(key, value);
  await store.set(KEY_AI_CONFIG_REVISION, revision);
  await store.set(KEY_AI_ENABLED, false);
  await store.save();
  await Promise.all([
    emit(PREFS_CHANGED_EVENT, { key, value }),
    emit(PREFS_CHANGED_EVENT, {
      key: KEY_AI_CONFIG_REVISION,
      value: revision,
    }),
    emit(PREFS_CHANGED_EVENT, { key: KEY_AI_ENABLED, value: false }),
  ]);
}

async function invalidateAiConfiguration(): Promise<void> {
  const revision = ((await store.get<number>(KEY_AI_CONFIG_REVISION)) ?? 0) + 1;
  await store.set(KEY_AI_CONFIG_REVISION, revision);
  await store.set(KEY_AI_ENABLED, false);
  await store.save();
  await Promise.all([
    emit(PREFS_CHANGED_EVENT, {
      key: KEY_AI_CONFIG_REVISION,
      value: revision,
    }),
    emit(PREFS_CHANGED_EVENT, { key: KEY_AI_ENABLED, value: false }),
  ]);
}

export async function loadPreferences(): Promise<Preferences> {
  await ensureStorageMigrated();
  // Single IPC roundtrip — fetching keys individually fans out to one
  // `plugin:store|get` per setting and is the dominant boot cost.
  const entries = await store.entries();
  const map = new Map<string, unknown>(entries);
  const get = <T>(k: string): T | undefined => map.get(k) as T | undefined;
  const result: Preferences = {
    language: ((): LanguageId => {
      const stored = get<string>(KEY_LANGUAGE);
      return stored && isLanguageId(stored)
        ? stored
        : DEFAULT_PREFERENCES.language;
    })(),
    theme: get<ThemePref>(KEY_THEME) ?? DEFAULT_PREFERENCES.theme,
    themeId: get<string>(KEY_THEME_ID) ?? DEFAULT_PREFERENCES.themeId,
    backgroundKind:
      get<BackgroundKind>(KEY_BG_KIND) ?? DEFAULT_PREFERENCES.backgroundKind,
    backgroundImageId:
      get<string | null>(KEY_BG_IMAGE_ID) ??
      DEFAULT_PREFERENCES.backgroundImageId,
    backgroundOpacity: clampBgOpacity(
      get<number>(KEY_BG_OPACITY) ?? DEFAULT_PREFERENCES.backgroundOpacity,
    ),
    backgroundBlur: clampBlur(
      get<number>(KEY_BG_BLUR) ?? DEFAULT_PREFERENCES.backgroundBlur,
    ),
    defaultModelId: ((): ModelId => {
      const stored = get<string>(KEY_DEFAULT_MODEL);
      return stored && isKnownModelId(stored)
        ? stored
        : DEFAULT_PREFERENCES.defaultModelId;
    })(),
    editorTheme: ((): EditorThemePref => {
      const stored = get<string>(KEY_EDITOR_THEME);
      if (stored === EDITOR_THEME_AUTO || isEditorThemeId(stored))
        return stored;
      return DEFAULT_PREFERENCES.editorTheme;
    })(),
    editorFontSize: clampEditorFontSize(
      get<number>(KEY_EDITOR_FONT_SIZE) ?? DEFAULT_PREFERENCES.editorFontSize,
    ),
    customInstructions:
      get<string>(KEY_CUSTOM_INSTRUCTIONS) ??
      DEFAULT_PREFERENCES.customInstructions,
    autostart: get<boolean>(KEY_AUTOSTART) ?? DEFAULT_PREFERENCES.autostart,
    restoreWindowState:
      get<boolean>(KEY_RESTORE_WINDOW) ??
      DEFAULT_PREFERENCES.restoreWindowState,
    windowVibrancy:
      get<boolean>(KEY_WINDOW_VIBRANCY) ?? DEFAULT_PREFERENCES.windowVibrancy,
    aiEnabled: get<boolean>(KEY_AI_ENABLED) ?? DEFAULT_PREFERENCES.aiEnabled,
    aiConfigRevision:
      get<number>(KEY_AI_CONFIG_REVISION) ??
      DEFAULT_PREFERENCES.aiConfigRevision,
    aiHealthRevision:
      get<number | null>(KEY_AI_HEALTH_REVISION) ??
      DEFAULT_PREFERENCES.aiHealthRevision,
    aiHealthCheckedAt:
      get<number | null>(KEY_AI_HEALTH_CHECKED_AT) ??
      DEFAULT_PREFERENCES.aiHealthCheckedAt,
    autocompleteEnabled:
      get<boolean>(KEY_AUTOCOMPLETE_ENABLED) ??
      DEFAULT_PREFERENCES.autocompleteEnabled,
    autocompleteTrigger:
      get<AutocompleteTrigger>(KEY_AUTOCOMPLETE_TRIGGER) ??
      DEFAULT_PREFERENCES.autocompleteTrigger,
    autocompleteProvider:
      get<AutocompleteProviderId>(KEY_AUTOCOMPLETE_PROVIDER) ??
      DEFAULT_PREFERENCES.autocompleteProvider,
    autocompleteModelId:
      get<string>(KEY_AUTOCOMPLETE_MODEL) ??
      DEFAULT_PREFERENCES.autocompleteModelId,
    lmstudioBaseURL:
      get<string>(KEY_LMSTUDIO_BASE_URL) ?? DEFAULT_PREFERENCES.lmstudioBaseURL,
    lmstudioModelId:
      get<string>(KEY_LMSTUDIO_MODEL_ID) ?? DEFAULT_PREFERENCES.lmstudioModelId,
    mlxBaseURL: get<string>(KEY_MLX_BASE_URL) ?? DEFAULT_PREFERENCES.mlxBaseURL,
    mlxModelId: get<string>(KEY_MLX_MODEL_ID) ?? DEFAULT_PREFERENCES.mlxModelId,
    ollamaBaseURL:
      get<string>(KEY_OLLAMA_BASE_URL) ?? DEFAULT_PREFERENCES.ollamaBaseURL,
    ollamaModelId:
      get<string>(KEY_OLLAMA_MODEL_ID) ?? DEFAULT_PREFERENCES.ollamaModelId,
    openaiCompatibleBaseURL:
      get<string>(KEY_OPENAI_COMPAT_BASE_URL) ??
      DEFAULT_PREFERENCES.openaiCompatibleBaseURL,
    openaiCompatibleModelId:
      get<string>(KEY_OPENAI_COMPAT_MODEL_ID) ??
      DEFAULT_PREFERENCES.openaiCompatibleModelId,
    openaiCompatibleContextLimit:
      get<number>(KEY_OPENAI_COMPAT_CONTEXT_LIMIT) ??
      DEFAULT_PREFERENCES.openaiCompatibleContextLimit,
    customEndpoints: (() => {
      const stored = get<CustomEndpoint[]>(KEY_CUSTOM_ENDPOINTS);
      if (stored && stored.length > 0) return stored;
      return migrateLegacyCompatEndpoint(
        get<string>(KEY_OPENAI_COMPAT_BASE_URL) ?? "",
        get<string>(KEY_OPENAI_COMPAT_MODEL_ID) ?? "",
        get<number>(KEY_OPENAI_COMPAT_CONTEXT_LIMIT) ?? 128_000,
        crypto.randomUUID().slice(0, 8),
      );
    })(),
    openrouterModelId:
      get<string>(KEY_OPENROUTER_MODEL_ID) ??
      DEFAULT_PREFERENCES.openrouterModelId,
    sttProvider:
      get<SttProvider>(KEY_STT_PROVIDER) ?? DEFAULT_PREFERENCES.sttProvider,
    groqSttModel:
      get<string>(KEY_GROQ_STT_MODEL) ?? DEFAULT_PREFERENCES.groqSttModel,
    whispercppBaseURL:
      get<string>(KEY_WHISPERCPP_BASE_URL) ??
      DEFAULT_PREFERENCES.whispercppBaseURL,
    favoriteModelIds: (
      get<string[]>(KEY_FAVORITE_MODELS) ?? DEFAULT_PREFERENCES.favoriteModelIds
    ).filter(isKnownModelId),
    recentModelIds: (
      get<string[]>(KEY_RECENT_MODELS) ?? DEFAULT_PREFERENCES.recentModelIds
    ).filter(isKnownModelId),
    vimMode: get<boolean>(KEY_VIM_MODE) ?? DEFAULT_PREFERENCES.vimMode,
    editorWordWrap:
      get<boolean>(KEY_EDITOR_WORD_WRAP) ?? DEFAULT_PREFERENCES.editorWordWrap,
    editorMinimap:
      get<boolean>(KEY_EDITOR_MINIMAP) ?? DEFAULT_PREFERENCES.editorMinimap,
    editorSemanticHighlighting:
      get<boolean>(KEY_EDITOR_SEMANTIC_HIGHLIGHTING) ??
      DEFAULT_PREFERENCES.editorSemanticHighlighting,
    editorInlayHints:
      get<boolean>(KEY_EDITOR_INLAY_HINTS) ??
      DEFAULT_PREFERENCES.editorInlayHints,
    editorWordWrapColumn: clampEditorWordWrapColumn(
      get<number>(KEY_EDITOR_WORD_WRAP_COLUMN) ??
        DEFAULT_PREFERENCES.editorWordWrapColumn,
    ),
    showHidden:
      get<boolean>(KEY_SHOW_HIDDEN) ??
      get<boolean>(LEGACY_KEY_SHOW_HIDDEN_DIRS) ??
      DEFAULT_PREFERENCES.showHidden,
    explorerGitDecorations:
      get<boolean>(KEY_EXPLORER_GIT_DECORATIONS) ??
      DEFAULT_PREFERENCES.explorerGitDecorations,
    sourceControlViewMode: (() => {
      const stored = get<unknown>(KEY_SOURCE_CONTROL_VIEW_MODE);
      return isSourceControlViewMode(stored)
        ? stored
        : DEFAULT_PREFERENCES.sourceControlViewMode;
    })(),
    gitCommitMessageUseEditorLanguage:
      get<boolean>(KEY_GIT_COMMIT_USE_EDITOR_LANGUAGE) ??
      DEFAULT_PREFERENCES.gitCommitMessageUseEditorLanguage,
    terminalWebglEnabled:
      get<boolean>(KEY_TERMINAL_WEBGL_ENABLED) ??
      DEFAULT_PREFERENCES.terminalWebglEnabled,
    terminalCursorBlink:
      get<boolean>(KEY_TERMINAL_CURSOR_BLINK) ??
      DEFAULT_PREFERENCES.terminalCursorBlink,
    terminalCursorStyle: coerceTerminalCursorStyle(
      get<unknown>(KEY_TERMINAL_CURSOR_STYLE),
    ),
    terminalFontFamily:
      get<string>(KEY_TERMINAL_FONT_FAMILY) ??
      DEFAULT_PREFERENCES.terminalFontFamily,
    terminalFontWeight: coerceFontWeight(
      get<string>(KEY_TERMINAL_FONT_WEIGHT) ??
        DEFAULT_PREFERENCES.terminalFontWeight,
    ),
    terminalShell:
      get<string>(KEY_TERMINAL_SHELL) ?? DEFAULT_PREFERENCES.terminalShell,
    terminalLetterSpacing:
      get<number>(KEY_TERMINAL_LETTER_SPACING) ??
      DEFAULT_PREFERENCES.terminalLetterSpacing,
    terminalFontSize:
      get<number>(KEY_TERMINAL_FONT_SIZE) ??
      DEFAULT_PREFERENCES.terminalFontSize,
    terminalScrollback: clampScrollback(
      get<number>(KEY_TERMINAL_SCROLLBACK) ??
        DEFAULT_PREFERENCES.terminalScrollback,
    ),
    confirmCloseRunningTerminal:
      get<boolean>(KEY_CONFIRM_CLOSE_RUNNING_TERMINAL) ??
      DEFAULT_PREFERENCES.confirmCloseRunningTerminal,
    terminalSuggestEnabled:
      get<boolean>(KEY_TERMINAL_SUGGEST_ENABLED) ??
      DEFAULT_PREFERENCES.terminalSuggestEnabled,
    lastWslDistro:
      get<string | null>(KEY_LAST_WSL_DISTRO) ??
      DEFAULT_PREFERENCES.lastWslDistro,
    zoomLevel:
      get<number>(KEY_ZOOM_LEVEL) ?? getOptimalInitialZoomLevel(),
    soundEnabled:
      get<boolean>(KEY_SOUND_ENABLED) ?? DEFAULT_PREFERENCES.soundEnabled,
    soundVolume: clampSoundVolume(
      get<number>(KEY_SOUND_VOLUME) ?? DEFAULT_PREFERENCES.soundVolume,
    ),
    agentAvatarEnabled:
      get<boolean>(KEY_AGENT_AVATAR_ENABLED) ??
      DEFAULT_PREFERENCES.agentAvatarEnabled,
    agentAvatarSize: (() => {
      const stored = get<unknown>(KEY_AGENT_AVATAR_SIZE);
      return isAgentAvatarSize(stored)
        ? stored
        : DEFAULT_PREFERENCES.agentAvatarSize;
    })(),
    agentAvatarAnimationIntensity: (() => {
      const stored = get<unknown>(KEY_AGENT_AVATAR_INTENSITY);
      return isAgentAvatarAnimationIntensity(stored)
        ? stored
        : DEFAULT_PREFERENCES.agentAvatarAnimationIntensity;
    })(),
    agentAvatarReducedMotion:
      get<boolean>(KEY_AGENT_AVATAR_REDUCED_MOTION) ??
      DEFAULT_PREFERENCES.agentAvatarReducedMotion,
    agentNotifications:
      get<boolean>(KEY_AGENT_NOTIFICATIONS) ??
      DEFAULT_PREFERENCES.agentNotifications,
    agentNotificationSound:
      get<boolean>(KEY_AGENT_NOTIFICATION_SOUND) ??
      DEFAULT_PREFERENCES.agentNotificationSound,
    agentLaunchCommands: normalizeAgentLaunchCommands(
      get<unknown>(KEY_AGENT_LAUNCH_COMMANDS),
    ),
    defaultWorkspaceEnv:
      get<string>(KEY_DEFAULT_WORKSPACE_ENV) ??
      DEFAULT_PREFERENCES.defaultWorkspaceEnv,
    spaceViewLimit: (() => {
      const stored = get<unknown>(KEY_SPACE_VIEW_LIMIT);
      return isSpaceViewLimit(stored)
        ? stored
        : DEFAULT_PREFERENCES.spaceViewLimit;
    })(),
    shortcuts:
      get<Record<ShortcutId, KeyBinding[]>>(KEY_SHORTCUTS) ??
      DEFAULT_PREFERENCES.shortcuts,
    editorAutoSave:
      get<boolean>(KEY_EDITOR_AUTO_SAVE) ?? DEFAULT_PREFERENCES.editorAutoSave,
    editorAutoSaveDelay: clampAutoSaveDelay(
      get<number>(KEY_EDITOR_AUTO_SAVE_DELAY) ??
        DEFAULT_PREFERENCES.editorAutoSaveDelay,
    ),
    tabStyle: (() => {
      const stored = get<unknown>(KEY_TAB_STYLE);
      return isTabStyle(stored) ? stored : DEFAULT_PREFERENCES.tabStyle;
    })(),
    editorFormatOnSave:
      get<boolean>(KEY_EDITOR_FORMAT_ON_SAVE) ??
      DEFAULT_PREFERENCES.editorFormatOnSave,
    editorFormatter:
      get<EditorFormatter>(KEY_EDITOR_FORMATTER) ??
      DEFAULT_PREFERENCES.editorFormatter,
    editorFormatterByLang:
      get<Record<string, EditorFormatter>>(KEY_EDITOR_FORMATTER_BY_LANG) ??
      DEFAULT_PREFERENCES.editorFormatterByLang,
    editorCustomFormatCommand:
      get<string>(KEY_EDITOR_CUSTOM_FORMAT_COMMAND) ??
      DEFAULT_PREFERENCES.editorCustomFormatCommand,
    lspActivation:
      get<Record<string, LspActivation>>(KEY_LSP_ACTIVATION) ??
      DEFAULT_PREFERENCES.lspActivation,
    lspCustomServers:
      get<LspCustomServer[]>(KEY_LSP_CUSTOM_SERVERS) ??
      DEFAULT_PREFERENCES.lspCustomServers,
    sshConnections: ((): SshConnection[] => {
      const stored = get<unknown>(KEY_SSH_CONNECTIONS);
      return Array.isArray(stored)
        ? (stored as SshConnection[])
        : DEFAULT_PREFERENCES.sshConnections;
    })(),
    sshTunnels: ((): SshTunnelConfig[] => {
      const stored = get<unknown>(KEY_SSH_TUNNELS);
      return Array.isArray(stored)
        ? (stored as SshTunnelConfig[])
        : DEFAULT_PREFERENCES.sshTunnels;
    })(),
    dockerEnabled:
      get<boolean>(KEY_DOCKER_ENABLED) ?? DEFAULT_PREFERENCES.dockerEnabled,
    dockerCustomHost:
      get<string>(KEY_DOCKER_CUSTOM_HOST) ??
      DEFAULT_PREFERENCES.dockerCustomHost,
    dockerDefaultShell:
      get<string>(KEY_DOCKER_DEFAULT_SHELL) ??
      DEFAULT_PREFERENCES.dockerDefaultShell,
    hasCompletedOnboarding:
      get<boolean>(KEY_HAS_COMPLETED_ONBOARDING) ??
      DEFAULT_PREFERENCES.hasCompletedOnboarding,
  };
  applyDocumentLocale(result.language);
  return result;
}

export async function setSshConnections(value: SshConnection[]): Promise<void> {
  await writePref(KEY_SSH_CONNECTIONS, value);
}

export async function setSshTunnels(value: SshTunnelConfig[]): Promise<void> {
  await writePref(KEY_SSH_TUNNELS, value);
}

export async function setLspActivation(
  id: string,
  value: LspActivation | null,
): Promise<void> {
  const current =
    ((await store.get(KEY_LSP_ACTIVATION)) as Record<string, LspActivation>) ??
    {};
  const next = { ...current };
  if (value === null) delete next[id];
  else next[id] = value;
  await writePref(KEY_LSP_ACTIVATION, next);
}

export async function setLspCustomServers(
  value: LspCustomServer[],
): Promise<void> {
  await writePref(KEY_LSP_CUSTOM_SERVERS, value);
}

export async function setLanguage(value: LanguageId): Promise<void> {
  applyDocumentLocale(value);
  await writePref(KEY_LANGUAGE, value);
  syncTrayLanguage(value);
}

export function syncTrayLanguage(value: LanguageId): void {
  void invoke("tray_set_language", { language: value }).catch(() => {});
}

export async function setTheme(value: ThemePref): Promise<void> {
  await writePref(KEY_THEME, value);
}

export async function setThemeId(value: string): Promise<void> {
  await writePref(KEY_THEME_ID, value);
}

/** Slider stores 0..1. Actual rendered opacity is halved in SurfaceLayer
 *  so the image never exceeds 50% — keeps UI/terminal readable at any setting. */
export const BG_OPACITY_RENDER_FACTOR = 0.5;

function clampBgOpacity(v: number): number {
  if (!Number.isFinite(v)) return 0.7;
  return Math.min(1, Math.max(0, v));
}

function clampBlur(v: number): number {
  if (!Number.isFinite(v)) return 16;
  return Math.min(64, Math.max(0, Math.round(v)));
}

export async function setBackgroundKind(value: BackgroundKind): Promise<void> {
  await writePref(KEY_BG_KIND, value);
}

export async function setBackgroundImageId(
  value: string | null,
): Promise<void> {
  await writePref(KEY_BG_IMAGE_ID, value);
}

export async function setBackgroundOpacity(value: number): Promise<void> {
  await writePref(KEY_BG_OPACITY, clampBgOpacity(value));
}

export async function setBackgroundBlur(value: number): Promise<void> {
  await writePref(KEY_BG_BLUR, clampBlur(value));
}

export async function setDefaultModel(value: ModelId): Promise<void> {
  await writeAiConfigurationPref(KEY_DEFAULT_MODEL, value);
}

export async function setAiEnabled(value: boolean): Promise<void> {
  if (value) {
    const [revision, healthRevision] = await Promise.all([
      store.get<number>(KEY_AI_CONFIG_REVISION),
      store.get<number | null>(KEY_AI_HEALTH_REVISION),
    ]);
    if ((revision ?? 0) !== healthRevision) return;
  }
  await writePref(KEY_AI_ENABLED, value);
}

export async function recordAiHealthCheck(
  expectedRevision: number,
): Promise<boolean> {
  const revision = (await store.get<number>(KEY_AI_CONFIG_REVISION)) ?? 0;
  if (revision !== expectedRevision) return false;
  const checkedAt = Date.now();
  await store.set(KEY_AI_HEALTH_REVISION, revision);
  await store.set(KEY_AI_HEALTH_CHECKED_AT, checkedAt);
  await store.save();
  await Promise.all([
    emit(PREFS_CHANGED_EVENT, {
      key: KEY_AI_HEALTH_REVISION,
      value: revision,
    }),
    emit(PREFS_CHANGED_EVENT, {
      key: KEY_AI_HEALTH_CHECKED_AT,
      value: checkedAt,
    }),
  ]);
  return true;
}

export async function setEditorTheme(value: EditorThemePref): Promise<void> {
  await writePref(KEY_EDITOR_THEME, value);
}

export function clampEditorFontSize(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_FONT_SIZE_DEFAULT;
  return Math.min(
    EDITOR_FONT_SIZE_MAX,
    Math.max(EDITOR_FONT_SIZE_MIN, Math.round(value)),
  );
}

export async function setEditorFontSize(value: number): Promise<void> {
  await writePref(KEY_EDITOR_FONT_SIZE, clampEditorFontSize(value));
}

export async function setCustomInstructions(value: string): Promise<void> {
  await writePref(KEY_CUSTOM_INSTRUCTIONS, value);
}

export async function setAutostart(value: boolean): Promise<void> {
  await writePref(KEY_AUTOSTART, value);
}

export async function setRestoreWindowState(value: boolean): Promise<void> {
  await writePref(KEY_RESTORE_WINDOW, value);
}

export async function setWindowVibrancy(value: boolean): Promise<void> {
  await writePref(KEY_WINDOW_VIBRANCY, value);
}

export async function setAutocompleteTrigger(
  value: AutocompleteTrigger,
): Promise<void> {
  await writePref(KEY_AUTOCOMPLETE_TRIGGER, value);
}

export async function setAutocompleteEnabled(value: boolean): Promise<void> {
  await writePref(KEY_AUTOCOMPLETE_ENABLED, value);
}

export async function setAutocompleteProvider(
  value: AutocompleteProviderId,
): Promise<void> {
  await writePref(KEY_AUTOCOMPLETE_PROVIDER, value);
}

export async function setAutocompleteModelId(value: string): Promise<void> {
  await writePref(KEY_AUTOCOMPLETE_MODEL, value);
}

export async function setLmstudioBaseURL(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_LMSTUDIO_BASE_URL, value);
}

export async function setLmstudioModelId(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_LMSTUDIO_MODEL_ID, value);
}

export async function setMlxBaseURL(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_MLX_BASE_URL, value);
}

export async function setMlxModelId(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_MLX_MODEL_ID, value);
}

export async function setOllamaBaseURL(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_OLLAMA_BASE_URL, value);
}

export async function setOllamaModelId(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_OLLAMA_MODEL_ID, value);
}

export async function setOpenaiCompatibleBaseURL(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_OPENAI_COMPAT_BASE_URL, value);
}

export async function setOpenaiCompatibleModelId(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_OPENAI_COMPAT_MODEL_ID, value);
}

export async function setOpenaiCompatibleContextLimit(
  value: number,
): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.max(1_000, Math.round(value))
    : DEFAULT_PREFERENCES.openaiCompatibleContextLimit;
  await writeAiConfigurationPref(KEY_OPENAI_COMPAT_CONTEXT_LIMIT, clamped);
}

export async function setCustomEndpoints(
  value: CustomEndpoint[],
): Promise<void> {
  await writeAiConfigurationPref(KEY_CUSTOM_ENDPOINTS, value);
}

export async function setOpenrouterModelId(value: string): Promise<void> {
  await writeAiConfigurationPref(KEY_OPENROUTER_MODEL_ID, value);
}

export async function setSttProvider(value: SttProvider): Promise<void> {
  await writePref(KEY_STT_PROVIDER, value);
}

export async function setGroqSttModel(value: string): Promise<void> {
  await writePref(KEY_GROQ_STT_MODEL, value.trim());
}

export async function setWhispercppBaseURL(value: string): Promise<void> {
  await writePref(KEY_WHISPERCPP_BASE_URL, value.trim());
}

export async function setFavoriteModelIds(value: string[]): Promise<void> {
  await writePref(KEY_FAVORITE_MODELS, value);
}

export async function setRecentModelIds(value: string[]): Promise<void> {
  await writePref(KEY_RECENT_MODELS, value);
}

export async function setVimMode(value: boolean): Promise<void> {
  await writePref(KEY_VIM_MODE, value);
}

export async function setEditorWordWrap(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_WORD_WRAP, value);
}

export async function setEditorMinimap(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_MINIMAP, value);
}

export async function setEditorSemanticHighlighting(
  value: boolean,
): Promise<void> {
  await writePref(KEY_EDITOR_SEMANTIC_HIGHLIGHTING, value);
}

export async function setEditorInlayHints(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_INLAY_HINTS, value);
}

export function clampEditorWordWrapColumn(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_WORD_WRAP_COLUMN_DEFAULT;
  return Math.min(
    EDITOR_WORD_WRAP_COLUMN_MAX,
    Math.max(EDITOR_WORD_WRAP_COLUMN_MIN, Math.round(value)),
  );
}

export async function setEditorWordWrapColumn(value: number): Promise<void> {
  await writePref(
    KEY_EDITOR_WORD_WRAP_COLUMN,
    clampEditorWordWrapColumn(value),
  );
}

export async function setShowHidden(value: boolean): Promise<void> {
  await writePref(KEY_SHOW_HIDDEN, value);
}

export async function setExplorerGitDecorations(value: boolean): Promise<void> {
  await writePref(KEY_EXPLORER_GIT_DECORATIONS, value);
}

export async function setSourceControlViewMode(
  value: SourceControlViewMode,
): Promise<void> {
  await writePref(KEY_SOURCE_CONTROL_VIEW_MODE, value);
}

export async function setGitCommitMessageUseEditorLanguage(
  value: boolean,
): Promise<void> {
  await writePref(KEY_GIT_COMMIT_USE_EDITOR_LANGUAGE, value);
}

export async function setTerminalWebglEnabled(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_WEBGL_ENABLED, value);
}

export async function setTerminalCursorBlink(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_CURSOR_BLINK, value);
}

export function coerceTerminalCursorStyle(value: unknown): TerminalCursorStyle {
  return value === "bar" || value === "block" || value === "underline"
    ? value
    : DEFAULT_PREFERENCES.terminalCursorStyle;
}

export async function setTerminalCursorStyle(value: unknown): Promise<void> {
  await writePref(KEY_TERMINAL_CURSOR_STYLE, coerceTerminalCursorStyle(value));
}

export async function setTerminalFontFamily(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_FAMILY, value.trim());
}

const TERMINAL_FONT_WEIGHT_VALUES = new Set(["normal", "500", "600", "bold"]);

export function coerceFontWeight(value: string): string {
  const v = value.trim();
  return TERMINAL_FONT_WEIGHT_VALUES.has(v) ? v : "normal";
}

export async function setTerminalFontWeight(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_WEIGHT, coerceFontWeight(value));
}

export async function setTerminalShell(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_SHELL, value.trim());
}

export async function setTerminalLetterSpacing(value: number): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.max(-10, Math.min(10, Math.round(value)))
    : 0;
  await writePref(KEY_TERMINAL_LETTER_SPACING, clamped);
}

export async function setTerminalFontSize(value: number): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.min(
        TERMINAL_FONT_SIZE_MAX,
        Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)),
      )
    : TERMINAL_FONT_SIZE_DEFAULT;
  await writePref(KEY_TERMINAL_FONT_SIZE, clamped);
}

function clampScrollback(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_SCROLLBACK_DEFAULT;
  return Math.min(
    TERMINAL_SCROLLBACK_MAX,
    Math.max(TERMINAL_SCROLLBACK_MIN, Math.round(value)),
  );
}

export async function setTerminalScrollback(value: number): Promise<void> {
  await writePref(KEY_TERMINAL_SCROLLBACK, clampScrollback(value));
}

export async function setConfirmCloseRunningTerminal(
  value: boolean,
): Promise<void> {
  await writePref(KEY_CONFIRM_CLOSE_RUNNING_TERMINAL, value);
}

export async function setTerminalSuggestEnabled(
  value: boolean,
): Promise<void> {
  await writePref(KEY_TERMINAL_SUGGEST_ENABLED, value);
}

export async function setLastWslDistro(value: string | null): Promise<void> {
  await writePref(KEY_LAST_WSL_DISTRO, value);
}

export async function setZoomLevel(value: number): Promise<void> {
  await writePref(KEY_ZOOM_LEVEL, value);
}

export const AUTO_SAVE_DELAY_MIN = 100;
export const AUTO_SAVE_DELAY_MAX = 60000;

export function clampAutoSaveDelay(v: number): number {
  if (!Number.isFinite(v)) return 1000;
  return Math.min(
    AUTO_SAVE_DELAY_MAX,
    Math.max(AUTO_SAVE_DELAY_MIN, Math.round(v)),
  );
}

export async function setEditorAutoSave(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_AUTO_SAVE, value);
}

export async function setTabStyle(value: TabStyle): Promise<void> {
  if (!isTabStyle(value)) return;
  await writePref(KEY_TAB_STYLE, value);
}

export async function setEditorAutoSaveDelay(value: number): Promise<void> {
  await writePref(KEY_EDITOR_AUTO_SAVE_DELAY, clampAutoSaveDelay(value));
}

export async function setEditorFormatOnSave(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_FORMAT_ON_SAVE, value);
}

export async function setEditorFormatter(
  value: EditorFormatter,
): Promise<void> {
  await writePref(KEY_EDITOR_FORMATTER, value);
}

export async function setEditorFormatterByLang(
  value: Record<string, EditorFormatter>,
): Promise<void> {
  await writePref(KEY_EDITOR_FORMATTER_BY_LANG, value);
}

export async function setEditorCustomFormatCommand(
  value: string,
): Promise<void> {
  await writePref(KEY_EDITOR_CUSTOM_FORMAT_COMMAND, value);
}

export async function setAgentNotifications(value: boolean): Promise<void> {
  await writePref(KEY_AGENT_NOTIFICATIONS, value);
}

export async function setSoundEnabled(value: boolean): Promise<void> {
  await writePref(KEY_SOUND_ENABLED, value);
}

export async function setSoundVolume(value: number): Promise<void> {
  await writePref(KEY_SOUND_VOLUME, clampSoundVolume(value));
}

export async function setAgentAvatarEnabled(value: boolean): Promise<void> {
  await writePref(KEY_AGENT_AVATAR_ENABLED, value);
}

export async function setAgentAvatarSize(
  value: AgentAvatarSize,
): Promise<void> {
  await writePref(KEY_AGENT_AVATAR_SIZE, value);
}

export async function setAgentAvatarAnimationIntensity(
  value: AgentAvatarAnimationIntensity,
): Promise<void> {
  await writePref(KEY_AGENT_AVATAR_INTENSITY, value);
}

export async function setAgentAvatarReducedMotion(
  value: boolean,
): Promise<void> {
  await writePref(KEY_AGENT_AVATAR_REDUCED_MOTION, value);
}

export async function setAgentNotificationSound(value: boolean): Promise<void> {
  await writePref(KEY_AGENT_NOTIFICATION_SOUND, value);
}

export async function setAgentLaunchCommands(
  value: AgentLaunchCommands,
): Promise<void> {
  await writePref(
    KEY_AGENT_LAUNCH_COMMANDS,
    normalizeAgentLaunchCommands(value),
  );
}

export async function setDefaultWorkspaceEnv(value: string): Promise<void> {
  await writePref(KEY_DEFAULT_WORKSPACE_ENV, value);
}

export async function setSpaceViewLimit(value: SpaceViewLimit): Promise<void> {
  await writePref(KEY_SPACE_VIEW_LIMIT, value);
}

export async function setShortcuts(
  value: Record<ShortcutId, KeyBinding[]> | {},
): Promise<void> {
  await writePref(KEY_SHORTCUTS, value);
}

export async function resetShortcuts(): Promise<void> {
  await writePref(KEY_SHORTCUTS, DEFAULT_PREFERENCES.shortcuts);
}

export type PrefKey = keyof Preferences;

/** Subscribe to changes from any window (settings → main). */
export async function onPreferencesChange(
  cb: (key: PrefKey, value: unknown) => void,
): Promise<UnlistenFn> {
  const map: Record<string, PrefKey> = {
    [KEY_LANGUAGE]: "language",
    [KEY_THEME]: "theme",
    [KEY_THEME_ID]: "themeId",
    [KEY_BG_KIND]: "backgroundKind",
    [KEY_BG_IMAGE_ID]: "backgroundImageId",
    [KEY_BG_OPACITY]: "backgroundOpacity",
    [KEY_BG_BLUR]: "backgroundBlur",
    [KEY_WINDOW_VIBRANCY]: "windowVibrancy",
    [KEY_AI_ENABLED]: "aiEnabled",
    [KEY_AI_CONFIG_REVISION]: "aiConfigRevision",
    [KEY_AI_HEALTH_REVISION]: "aiHealthRevision",
    [KEY_AI_HEALTH_CHECKED_AT]: "aiHealthCheckedAt",
    [KEY_DEFAULT_MODEL]: "defaultModelId",
    [KEY_EDITOR_THEME]: "editorTheme",
    [KEY_EDITOR_FONT_SIZE]: "editorFontSize",
    [KEY_CUSTOM_INSTRUCTIONS]: "customInstructions",
    [KEY_AUTOSTART]: "autostart",
    [KEY_RESTORE_WINDOW]: "restoreWindowState",
    [KEY_AUTOCOMPLETE_ENABLED]: "autocompleteEnabled",
    [KEY_AUTOCOMPLETE_TRIGGER]: "autocompleteTrigger",
    [KEY_AUTOCOMPLETE_PROVIDER]: "autocompleteProvider",
    [KEY_AUTOCOMPLETE_MODEL]: "autocompleteModelId",
    [KEY_LMSTUDIO_BASE_URL]: "lmstudioBaseURL",
    [KEY_LMSTUDIO_MODEL_ID]: "lmstudioModelId",
    [KEY_MLX_BASE_URL]: "mlxBaseURL",
    [KEY_MLX_MODEL_ID]: "mlxModelId",
    [KEY_OLLAMA_BASE_URL]: "ollamaBaseURL",
    [KEY_OLLAMA_MODEL_ID]: "ollamaModelId",
    [KEY_OPENAI_COMPAT_BASE_URL]: "openaiCompatibleBaseURL",
    [KEY_OPENAI_COMPAT_MODEL_ID]: "openaiCompatibleModelId",
    [KEY_OPENAI_COMPAT_CONTEXT_LIMIT]: "openaiCompatibleContextLimit",
    [KEY_CUSTOM_ENDPOINTS]: "customEndpoints",
    [KEY_OPENROUTER_MODEL_ID]: "openrouterModelId",
    [KEY_STT_PROVIDER]: "sttProvider",
    [KEY_GROQ_STT_MODEL]: "groqSttModel",
    [KEY_WHISPERCPP_BASE_URL]: "whispercppBaseURL",
    [KEY_FAVORITE_MODELS]: "favoriteModelIds",
    [KEY_RECENT_MODELS]: "recentModelIds",
    [KEY_VIM_MODE]: "vimMode",
    [KEY_EDITOR_WORD_WRAP]: "editorWordWrap",
    [KEY_EDITOR_MINIMAP]: "editorMinimap",
    [KEY_EDITOR_SEMANTIC_HIGHLIGHTING]: "editorSemanticHighlighting",
    [KEY_EDITOR_INLAY_HINTS]: "editorInlayHints",
    [KEY_EDITOR_WORD_WRAP_COLUMN]: "editorWordWrapColumn",
    [KEY_SHOW_HIDDEN]: "showHidden",
    [KEY_EXPLORER_GIT_DECORATIONS]: "explorerGitDecorations",
    [KEY_SOURCE_CONTROL_VIEW_MODE]: "sourceControlViewMode",
    [KEY_GIT_COMMIT_USE_EDITOR_LANGUAGE]: "gitCommitMessageUseEditorLanguage",
    [KEY_TERMINAL_WEBGL_ENABLED]: "terminalWebglEnabled",
    [KEY_TERMINAL_CURSOR_BLINK]: "terminalCursorBlink",
    [KEY_TERMINAL_CURSOR_STYLE]: "terminalCursorStyle",
    [KEY_TERMINAL_FONT_FAMILY]: "terminalFontFamily",
    [KEY_TERMINAL_FONT_WEIGHT]: "terminalFontWeight",
    [KEY_TERMINAL_SHELL]: "terminalShell",
    [KEY_TERMINAL_LETTER_SPACING]: "terminalLetterSpacing",
    [KEY_TERMINAL_FONT_SIZE]: "terminalFontSize",
    [KEY_TERMINAL_SCROLLBACK]: "terminalScrollback",
    [KEY_CONFIRM_CLOSE_RUNNING_TERMINAL]: "confirmCloseRunningTerminal",
    [KEY_TERMINAL_SUGGEST_ENABLED]: "terminalSuggestEnabled",
    [KEY_LAST_WSL_DISTRO]: "lastWslDistro",
    [KEY_ZOOM_LEVEL]: "zoomLevel",
    [KEY_SOUND_ENABLED]: "soundEnabled",
    [KEY_SOUND_VOLUME]: "soundVolume",
    [KEY_AGENT_AVATAR_ENABLED]: "agentAvatarEnabled",
    [KEY_AGENT_AVATAR_SIZE]: "agentAvatarSize",
    [KEY_AGENT_AVATAR_INTENSITY]: "agentAvatarAnimationIntensity",
    [KEY_AGENT_AVATAR_REDUCED_MOTION]: "agentAvatarReducedMotion",
    [KEY_AGENT_NOTIFICATIONS]: "agentNotifications",
    [KEY_AGENT_NOTIFICATION_SOUND]: "agentNotificationSound",
    [KEY_AGENT_LAUNCH_COMMANDS]: "agentLaunchCommands",
    [KEY_DEFAULT_WORKSPACE_ENV]: "defaultWorkspaceEnv",
    [KEY_SPACE_VIEW_LIMIT]: "spaceViewLimit",
    [KEY_SHORTCUTS]: "shortcuts",
    [KEY_EDITOR_AUTO_SAVE]: "editorAutoSave",
    [KEY_EDITOR_AUTO_SAVE_DELAY]: "editorAutoSaveDelay",
    [KEY_TAB_STYLE]: "tabStyle",
    [KEY_EDITOR_FORMAT_ON_SAVE]: "editorFormatOnSave",
    [KEY_EDITOR_FORMATTER]: "editorFormatter",
    [KEY_EDITOR_FORMATTER_BY_LANG]: "editorFormatterByLang",
    [KEY_EDITOR_CUSTOM_FORMAT_COMMAND]: "editorCustomFormatCommand",
    [KEY_LSP_ACTIVATION]: "lspActivation",
    [KEY_LSP_CUSTOM_SERVERS]: "lspCustomServers",
    [KEY_SSH_CONNECTIONS]: "sshConnections",
    [KEY_SSH_TUNNELS]: "sshTunnels",
    [KEY_DOCKER_ENABLED]: "dockerEnabled",
    [KEY_DOCKER_CUSTOM_HOST]: "dockerCustomHost",
    [KEY_DOCKER_DEFAULT_SHELL]: "dockerDefaultShell",
  };
  // Same-process writes still fire onChange immediately; cross-window writes
  // arrive via the Tauri event emitted by writePref().
  const unsubLocal = await store.onChange<unknown>((key, value) => {
    const mapped = map[key];
    if (mapped) cb(mapped, value);
  });
  const unsubEvent = await listen<{ key: string; value: unknown }>(
    PREFS_CHANGED_EVENT,
    (e) => {
      const mapped = map[e.payload.key];
      if (mapped) cb(mapped, e.payload.value);
    },
  );
  return () => {
    unsubLocal();
    unsubEvent();
  };
}

// API key changes are stored in OS keychain (not the prefs store),
// so we broadcast via a Tauri event for cross-window listeners.
const KEYS_CHANGED_EVENT = "voktty://ai-keys-changed";

export async function emitKeysChanged(): Promise<void> {
  await invalidateAiConfiguration();
  await emit(KEYS_CHANGED_EVENT);
}

export function onKeysChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(KEYS_CHANGED_EVENT, () => cb());
}

export async function setDockerEnabled(value: boolean): Promise<void> {
  await writePref(KEY_DOCKER_ENABLED, value);
}

export async function setDockerCustomHost(value: string): Promise<void> {
  await writePref(KEY_DOCKER_CUSTOM_HOST, value);
}

export async function setDockerDefaultShell(value: string): Promise<void> {
  await writePref(KEY_DOCKER_DEFAULT_SHELL, value);
}

export async function setHasCompletedOnboarding(value: boolean): Promise<void> {
  await writePref(KEY_HAS_COMPLETED_ONBOARDING, value);
}

export const PREF_KEY_TO_STORAGE_KEY: Record<PrefKey, string> = {
  language: KEY_LANGUAGE,
  theme: KEY_THEME,
  themeId: KEY_THEME_ID,
  backgroundKind: KEY_BG_KIND,
  backgroundImageId: KEY_BG_IMAGE_ID,
  backgroundOpacity: KEY_BG_OPACITY,
  backgroundBlur: KEY_BG_BLUR,
  windowVibrancy: KEY_WINDOW_VIBRANCY,
  aiEnabled: KEY_AI_ENABLED,
  aiConfigRevision: KEY_AI_CONFIG_REVISION,
  aiHealthRevision: KEY_AI_HEALTH_REVISION,
  aiHealthCheckedAt: KEY_AI_HEALTH_CHECKED_AT,
  defaultModelId: KEY_DEFAULT_MODEL,
  editorTheme: KEY_EDITOR_THEME,
  editorFontSize: KEY_EDITOR_FONT_SIZE,
  customInstructions: KEY_CUSTOM_INSTRUCTIONS,
  autostart: KEY_AUTOSTART,
  restoreWindowState: KEY_RESTORE_WINDOW,
  autocompleteEnabled: KEY_AUTOCOMPLETE_ENABLED,
  autocompleteTrigger: KEY_AUTOCOMPLETE_TRIGGER,
  autocompleteProvider: KEY_AUTOCOMPLETE_PROVIDER,
  autocompleteModelId: KEY_AUTOCOMPLETE_MODEL,
  lmstudioBaseURL: KEY_LMSTUDIO_BASE_URL,
  lmstudioModelId: KEY_LMSTUDIO_MODEL_ID,
  mlxBaseURL: KEY_MLX_BASE_URL,
  mlxModelId: KEY_MLX_MODEL_ID,
  ollamaBaseURL: KEY_OLLAMA_BASE_URL,
  ollamaModelId: KEY_OLLAMA_MODEL_ID,
  openaiCompatibleBaseURL: KEY_OPENAI_COMPAT_BASE_URL,
  openaiCompatibleModelId: KEY_OPENAI_COMPAT_MODEL_ID,
  openaiCompatibleContextLimit: KEY_OPENAI_COMPAT_CONTEXT_LIMIT,
  customEndpoints: KEY_CUSTOM_ENDPOINTS,
  openrouterModelId: KEY_OPENROUTER_MODEL_ID,
  sttProvider: KEY_STT_PROVIDER,
  groqSttModel: KEY_GROQ_STT_MODEL,
  whispercppBaseURL: KEY_WHISPERCPP_BASE_URL,
  favoriteModelIds: KEY_FAVORITE_MODELS,
  recentModelIds: KEY_RECENT_MODELS,
  vimMode: KEY_VIM_MODE,
  editorWordWrap: KEY_EDITOR_WORD_WRAP,
  editorMinimap: KEY_EDITOR_MINIMAP,
  editorSemanticHighlighting: KEY_EDITOR_SEMANTIC_HIGHLIGHTING,
  editorInlayHints: KEY_EDITOR_INLAY_HINTS,
  editorWordWrapColumn: KEY_EDITOR_WORD_WRAP_COLUMN,
  showHidden: KEY_SHOW_HIDDEN,
  explorerGitDecorations: KEY_EXPLORER_GIT_DECORATIONS,
  sourceControlViewMode: KEY_SOURCE_CONTROL_VIEW_MODE,
  gitCommitMessageUseEditorLanguage: KEY_GIT_COMMIT_USE_EDITOR_LANGUAGE,
  terminalWebglEnabled: KEY_TERMINAL_WEBGL_ENABLED,
  terminalCursorBlink: KEY_TERMINAL_CURSOR_BLINK,
  terminalCursorStyle: KEY_TERMINAL_CURSOR_STYLE,
  terminalFontFamily: KEY_TERMINAL_FONT_FAMILY,
  terminalFontWeight: KEY_TERMINAL_FONT_WEIGHT,
  terminalShell: KEY_TERMINAL_SHELL,
  terminalLetterSpacing: KEY_TERMINAL_LETTER_SPACING,
  terminalFontSize: KEY_TERMINAL_FONT_SIZE,
  terminalScrollback: KEY_TERMINAL_SCROLLBACK,
  confirmCloseRunningTerminal: KEY_CONFIRM_CLOSE_RUNNING_TERMINAL,
  terminalSuggestEnabled: KEY_TERMINAL_SUGGEST_ENABLED,
  lastWslDistro: KEY_LAST_WSL_DISTRO,
  zoomLevel: KEY_ZOOM_LEVEL,
  soundEnabled: KEY_SOUND_ENABLED,
  soundVolume: KEY_SOUND_VOLUME,
  agentAvatarEnabled: KEY_AGENT_AVATAR_ENABLED,
  agentAvatarSize: KEY_AGENT_AVATAR_SIZE,
  agentAvatarAnimationIntensity: KEY_AGENT_AVATAR_INTENSITY,
  agentAvatarReducedMotion: KEY_AGENT_AVATAR_REDUCED_MOTION,
  agentNotifications: KEY_AGENT_NOTIFICATIONS,
  agentNotificationSound: KEY_AGENT_NOTIFICATION_SOUND,
  agentLaunchCommands: KEY_AGENT_LAUNCH_COMMANDS,
  defaultWorkspaceEnv: KEY_DEFAULT_WORKSPACE_ENV,
  spaceViewLimit: KEY_SPACE_VIEW_LIMIT,
  shortcuts: KEY_SHORTCUTS,
  editorAutoSave: KEY_EDITOR_AUTO_SAVE,
  editorAutoSaveDelay: KEY_EDITOR_AUTO_SAVE_DELAY,
  tabStyle: KEY_TAB_STYLE,
  editorFormatOnSave: KEY_EDITOR_FORMAT_ON_SAVE,
  editorFormatter: KEY_EDITOR_FORMATTER,
  editorFormatterByLang: KEY_EDITOR_FORMATTER_BY_LANG,
  editorCustomFormatCommand: KEY_EDITOR_CUSTOM_FORMAT_COMMAND,
  lspActivation: KEY_LSP_ACTIVATION,
  lspCustomServers: KEY_LSP_CUSTOM_SERVERS,
  sshConnections: KEY_SSH_CONNECTIONS,
  sshTunnels: KEY_SSH_TUNNELS,
  dockerEnabled: KEY_DOCKER_ENABLED,
  dockerCustomHost: KEY_DOCKER_CUSTOM_HOST,
  dockerDefaultShell: KEY_DOCKER_DEFAULT_SHELL,
  hasCompletedOnboarding: KEY_HAS_COMPLETED_ONBOARDING,
};

export async function writePreferencesBatch(
  partial: Partial<Preferences>,
): Promise<void> {
  let invalidatesAi = false;
  for (const [key, value] of Object.entries(partial)) {
    const storageKey = PREF_KEY_TO_STORAGE_KEY[key as PrefKey];
    if (storageKey && value !== undefined) {
      await store.set(storageKey, value);
      await emit(PREFS_CHANGED_EVENT, { key: storageKey, value });
      if (AI_CONFIGURATION_KEYS.has(storageKey)) invalidatesAi = true;
    }
  }
  await store.save();
  if (invalidatesAi) await invalidateAiConfiguration();
}
