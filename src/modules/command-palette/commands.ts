import { useAgentHistoryStore } from "@/modules/agent-history";
import { extensionCommands, useExtensionStore } from "@/modules/extensions";
import type { SearchTarget } from "@/modules/header";
import { t } from "@/modules/i18n";
import { downloadConfiguration } from "@/modules/settings/configExport";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import { leafIds, useCommandHistoryStore } from "@/modules/terminal";
import { useVaultStore } from "@/modules/vault";
import {
  Alert02Icon,
  Cancel01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  CodeIcon,
  CommandLineIcon,
  DashboardSquare01Icon,
  Download01Icon,
  File02Icon,
  FileEditIcon,
  FileSearchIcon,
  GlobalIcon,
  Globe02Icon,
  IncognitoIcon,
  KeyboardIcon,
  HierarchyIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  LockPasswordIcon,
  PackageIcon,
  PaintBoardIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  SourceCodeIcon,
  SparklesIcon,
  SquareLock01Icon,
  SquareUnlock01Icon,
  TerminalIcon,
  Upload01Icon,
  UsbIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import type { PaletteItem } from "./types";

export const COMMAND_GROUPS = [
  "General",
  "Spaces",
  "Tabs",
  "Panes",
  "Git",
  "Search",
  "Editor",
  "View",
  "AI",
  "Extensions",
] as const;

export type CommandPaletteActionContext = {
  aiAvailable?: boolean;
  tabs: Tab[];
  activeId: number;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  home: string | null;
  openNewTab: () => void;
  openNewBlock: () => void;
  openNewPrivate: () => void;
  openSerialConnect?: () => void;
  openNewEditor: () => void;
  openFileFromDisk?: () => void;
  openQuickOpen: () => void;
  openWorkspaceSearch: () => void;
  openOutline: () => void;
  openProblems: () => void;
  revealActiveFileInExplorer?: () => void;
  openRunDebug?: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  openNewPreview: () => void;
  openNewApiClient?: () => void;
  openActiveTabs: () => void;
  openGitGraph: () => void;
  openGitClone?: () => void;
  toggleSourceControl: () => void;
  closeActiveTabOrPane: () => void;
  reopenClosedEditor?: () => number | null;
  toggleLockTab?: (id: number) => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusSearch: () => void;
  focusExplorerSearch: () => void;
  toggleSidebar: () => void;
  toggleHiddenFiles: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  zoomReset?: () => void;
  toggleAi: () => void;
  askAiSelection: () => void;
  openSettings: () => void;
  openKeyboardShortcuts: () => void;
  openOnboarding?: () => void;
  spaces: { id: string; name: string }[];
  activeSpaceId: string | null;
  activeViewSpacePresentation?: "composite" | "expanded" | null;
  openSpacesOverview: () => void;
  newSpace: () => void;
  switchSpace: (id: string) => void;
  focusNextSpaceSlot?: () => void;
  focusPreviousSpaceSlot?: () => void;
  toggleFocusedSpaceView?: () => void;
  extractFocusedSpaceMember?: () => void;
  moveFocusedSpaceMember?: () => void;
  closeFocusedSpaceMember?: () => void;
  editorActions: {
    openSearch: () => void;
    openGotoLine: () => void;
    formatDocument: () => void;
    triggerInlineAi: () => void;
    triggerQuickFix: () => void;
    triggerSignatureHelp: () => void;
    triggerLspNavigation: (
      kind: "definition" | "typeDefinition" | "implementation" | "references",
    ) => void;
    triggerLspPeek: (kind: "definition" | "references") => void;
    triggerAiComplete: () => void;
    triggerCodeComplete: () => void;
    runEditCommand: (
      command:
        | "addCursorAbove"
        | "addCursorBelow"
        | "clearMultipleCursors"
        | "moveLineUp"
        | "moveLineDown"
        | "copyLineUp"
        | "copyLineDown"
        | "expandSelection",
    ) => void;
    runInlineSuggestionCommand: (
      command: "accept" | "acceptLine" | "acceptToken" | "dismiss",
    ) => void;
    splitGroup: (direction: "row" | "col") => void;
    closeGroup: () => void;
    focusGroup: (delta: 1 | -1) => void;
  } | null;
};

const noop = () => {};

export function createCommandItems(
  ctx: CommandPaletteActionContext,
): PaletteItem[] {
  const activeTab = ctx.tabs.find((tab) => tab.id === ctx.activeId);
  const activeTerminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const activePaneCount = activeTerminalTab
    ? leafIds(activeTerminalTab.paneTree).length
    : 0;
  const onlyOneTab = ctx.tabs.length < 2;
  const noWorkspaceRoot = !ctx.explorerRoot && !ctx.home;
  const splitDisabled = !activeTerminalTab
    ? t("commandPalette.disabled.noTerminalTab")
    : activePaneCount >= MAX_PANES_PER_TAB
      ? t("commandPalette.disabled.paneLimit")
      : undefined;
  const closeDisabled = activeTab?.locked
    ? t("commandPalette.disabled.tabLocked")
    : onlyOneTab && activePaneCount < 2
      ? t("commandPalette.disabled.lastTab")
      : undefined;

  const items: PaletteItem[] = [
    {
      id: "onboarding.open",
      title: t("onboarding.title"),
      group: "General",
      keywords: [
        "wizard",
        "setup",
        "onboarding",
        "welcome",
        "init",
        "config",
        "deepseek",
      ],
      icon: SparklesIcon,
      run: ctx.openOnboarding ?? noop,
    },
    {
      id: "settings.open",
      title: t("commandPalette.commands.openSettings"),
      group: "General",
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: ctx.openSettings,
    },
    {
      id: "aliases.manage",
      title: t("commandPalette.commands.manageAliases"),
      group: "General",
      keywords: [
        "alias",
        "aliases",
        "commands",
        "cmd",
        "shorthand",
        "port",
        "ipme",
        "sslcheck",
        "jwt",
        "sysinfo",
        "bench",
        "envdiff",
        "hash",
      ],
      icon: CommandLineIcon,
      run: () => void openSettingsWindow("aliases"),
    },
    {
      id: "preferences.export",
      title: t("commandPalette.commands.exportConfig"),
      group: "General",
      keywords: [
        "export",
        "backup",
        "save",
        "settings",
        "json",
        "ssh",
        "config",
      ],
      icon: Download01Icon,
      run: () => {
        downloadConfiguration();
      },
    },
    {
      id: "preferences.import",
      title: t("commandPalette.commands.importConfig"),
      group: "General",
      keywords: [
        "import",
        "restore",
        "load",
        "settings",
        "json",
        "ssh",
        "config",
      ],
      icon: Upload01Icon,
      run: ctx.openSettings,
    },
    {
      id: "vault.lock",
      title: t("commandPalette.commands.lockVault"),
      group: "General",
      keywords: ["vault", "lock", "bloquear", "seguridad", "keys", "secrets"],
      icon: LockPasswordIcon,
      run: () => {
        useVaultStore.getState().lockVault();
      },
    },
    {
      id: "theme.pick",
      title: t("commandPalette.commands.changeTheme"),
      group: "General",
      keywords: ["theme", "appearance", "color", "dark", "light"],
      icon: PaintBoardIcon,
      run: noop,
    },
    {
      id: "shortcuts.open",
      title: t("commandPalette.commands.keyboardShortcuts"),
      group: "General",
      keywords: ["keys", "keybindings", "settings"],
      icon: KeyboardIcon,
      run: ctx.openKeyboardShortcuts,
    },
    // --- Spaces (Global) ---
    {
      id: "spaces.overview",
      title: t("commandPalette.commands.spacesOverview"),
      group: "Spaces",
      keywords: [
        "spaces",
        "sessions",
        "overview",
        "organize",
        "manage",
        "move",
        "espacios",
      ],
      icon: DashboardSquare01Icon,
      run: ctx.openSpacesOverview,
    },
    {
      id: "spaces.new",
      title: t("commandPalette.commands.newSpace"),
      group: "Spaces",
      keywords: ["space", "session", "workspace", "group", "create", "nuevo espacio"],
      icon: DashboardSquare01Icon,
      run: ctx.newSpace,
    },
    ...ctx.spaces.map((sp) => ({
      id: `spaces.switch.${sp.id}`,
      title: t("commandPalette.commands.switchToSpace", { name: sp.name }),
      group: "Spaces" as const,
      keywords: ["space", "switch", "session", sp.name, "cambiar"],
      icon: DashboardSquare01Icon,
      disabledReason:
        sp.id === ctx.activeSpaceId
          ? t("commandPalette.disabled.currentSpace")
          : undefined,
      run: () => ctx.switchSpace(sp.id),
    })),

    // --- Tabs & Creation ---
    {
      id: "tab.new",
      title: t("commandPalette.commands.newTerminal"),
      group: "Tabs",
      keywords: ["shell", "terminal", "new tab", "consola", "nueva"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      run: ctx.openNewTab,
    },
    {
      id: "tab.newBlock",
      title: t("commandPalette.commands.newBlockTerminal"),
      group: "Tabs",
      keywords: ["blocks", "warp", "command blocks", "terminal", "bloques"],
      icon: DashboardSquare01Icon,
      run: ctx.openNewBlock,
    },
    {
      id: "tab.newPrivate",
      title: t("commandPalette.commands.newPrivateTerminal"),
      group: "Tabs",
      keywords: ["privacy", "private", "incognito", "hidden from ai", "privada"],
      icon: IncognitoIcon,
      shortcutId: "tab.newPrivate",
      run: ctx.openNewPrivate,
    },
    {
      id: "terminal.history",
      title: t("commandPalette.commands.commandHistory"),
      group: "Tabs",
      keywords: [
        "history",
        "historial",
        "commands",
        "comandos",
        "shell",
        "terminal",
        "ssh",
        "powershell",
        "bash",
        "zsh",
        "ejecutados",
      ],
      icon: Clock01Icon,
      shortcutId: "terminal.history",
      run: () => useCommandHistoryStore.getState().openHistory(),
    },
    {
      id: "tab.serialConnect",
      title: t("commandPalette.commands.connectSerial"),
      group: "Tabs",
      keywords: [
        "serial",
        "com",
        "tty",
        "usb",
        "arduino",
        "esp32",
        "microcontroller",
        "baud",
      ],
      icon: UsbIcon,
      run: () => ctx.openSerialConnect?.(),
    },
    {
      id: "tab.newEditor",
      title: t("commandPalette.commands.newEditorTab"),
      group: "Tabs",
      keywords: ["file", "editor", "create", "archivo", "nuevo archivo"],
      icon: FileEditIcon,
      shortcutId: "tab.newEditor",
      disabledReason: noWorkspaceRoot
        ? t("commandPalette.disabled.noWorkspaceRoot")
        : undefined,
      run: ctx.openNewEditor,
    },
    {
      id: "editor.quickOpen",
      title: t("commandPalette.commands.quickOpen"),
      group: "Tabs",
      keywords: ["file", "workspace", "quick", "search", "open", "archivo", "buscar"],
      icon: FileSearchIcon,
      shortcutId: "file.quickOpen",
      disabledReason: noWorkspaceRoot
        ? t("commandPalette.disabled.noWorkspaceRoot")
        : undefined,
      run: ctx.openQuickOpen,
    },
    {
      id: "editor.openFile",
      title: t("commandPalette.commands.openFile"),
      group: "Tabs",
      keywords: ["file", "open", "disk", "editor", "abrir", "disco"],
      icon: File02Icon,
      shortcutId: "editor.openFile",
      run: () => ctx.openFileFromDisk?.(),
    },
    {
      id: "tab.newPreview",
      title: t("commandPalette.commands.newWebPreview"),
      group: "Tabs",
      keywords: ["browser", "web", "localhost", "preview", "navegador", "vista previa"],
      icon: Globe02Icon,
      shortcutId: "tab.newPreview",
      run: ctx.openNewPreview,
    },
    {
      id: "tab.newApiClient",
      title: t("commandPalette.commands.newApiClient"),
      group: "Tabs",
      keywords: [
        "api",
        "client",
        "http",
        "curl",
        "sandbox",
        "webhook",
        "postman",
        "fetch",
        "rest",
        "cliente",
      ],
      icon: GlobalIcon,
      shortcutId: "tab.newApiClient",
      run: () => ctx.openNewApiClient?.(),
    },
    {
      id: "tab.close",
      title: t("commandPalette.commands.closeTabOrPane"),
      group: "Tabs",
      keywords: ["close", "remove", "pane", "cerrar"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabled,
      run: ctx.closeActiveTabOrPane,
    },
    {
      id: "editor.reopenClosed",
      title: t("commandPalette.commands.editorReopenClosed"),
      group: "Tabs",
      keywords: ["editor", "reopen", "restore", "closed", "file", "reabrir"],
      icon: FileEditIcon,
      run: () => ctx.reopenClosedEditor?.(),
    },
    {
      id: "tab.toggleLock",
      title: activeTab?.locked
        ? t("commandPalette.commands.unlockTab")
        : t("commandPalette.commands.lockTab"),
      group: "Tabs",
      keywords: ["tab", "lock", "unlock", "protect", "freeze", "bloquear", "pestana"],
      icon: activeTab?.locked ? SquareUnlock01Icon : SquareLock01Icon,
      disabledReason: !activeTab
        ? t("commandPalette.disabled.noActiveTab")
        : undefined,
      run: () => {
        if (activeTab && ctx.toggleLockTab) {
          ctx.toggleLockTab(activeTab.id);
        }
      },
    },
    {
      id: "tabs.launchpad",
      title: t("commandPalette.commands.openActiveTabs"),
      group: "Tabs",
      keywords: ["tabs", "open", "switch", "active", "pestanas", "activas"],
      icon: DashboardSquare01Icon,
      shortcutId: "tabs.launchpad",
      run: ctx.openActiveTabs,
    },

    // --- Git ---
    {
      id: "git.graph",
      title: t("commandPalette.commands.openGitGraph"),
      group: "Git",
      keywords: ["git", "graph", "history", "log", "commits", "grafo", "historial"],
      icon: SourceCodeIcon,
      run: ctx.openGitGraph,
    },
    {
      id: "git.clone",
      title: t("commandPalette.commands.cloneRepo"),
      group: "Git",
      keywords: ["git", "clone", "repository", "github", "clonar", "repositorio"],
      icon: SourceCodeIcon,
      run: ctx.openGitClone ?? noop,
    },
    {
      id: "git.source",
      title: t("commandPalette.commands.toggleSourceControl"),
      group: "Git",
      keywords: ["git", "source control", "changes", "staging", "diff", "cambios", "control de versiones"],
      icon: SourceCodeIcon,
      shortcutId: "pane.source",
      run: ctx.toggleSourceControl,
    },

    // --- Search ---
    {
      id: "search.content",
      title: t("commandPalette.commands.findInFiles"),
      group: "Search",
      keywords: ["grep", "ripgrep", "text", "contents", "search in files", "buscar en archivos"],
      icon: FileSearchIcon,
      shortcutId: "commandPalette.content",
      run: ctx.openWorkspaceSearch,
    },
    {
      id: "search.focus",
      title: t("commandPalette.commands.findInCurrentTab"),
      group: "Search",
      keywords: ["find", "terminal", "editor", "current", "buscar"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: ctx.searchTarget
        ? undefined
        : t("commandPalette.disabled.noSearchableView"),
      run: ctx.focusSearch,
    },
    {
      id: "explorer.search",
      title: t("commandPalette.commands.searchFiles"),
      group: "Search",
      keywords: ["explorer", "workspace", "file", "open", "explorador"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: ctx.explorerRoot
        ? undefined
        : t("commandPalette.disabled.noWorkspaceRoot"),
      run: ctx.focusExplorerSearch,
    },
    {
      id: "history.open",
      title: t("commandPalette.commands.searchHistory"),
      group: "Search",
      keywords: ["history", "shell", "rerun", "previous commands"],
      icon: TerminalIcon,
      trailing: ">",
      run: noop,
    },

    // --- View ---
    {
      id: "sidebar.toggle",
      title: t("commandPalette.commands.toggleExplorer"),
      group: "View",
      keywords: ["sidebar", "files", "explorer", "barra lateral", "explorador"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
    {
      id: "explorer.toggleHidden",
      title: t("commandPalette.commands.toggleHiddenFiles"),
      group: "View",
      keywords: ["dotfiles", "hidden", "explorer", "gitignore", "env", "ocultos"],
      icon: ViewIcon,
      shortcutId: "explorer.toggleHidden",
      run: ctx.toggleHiddenFiles,
    },
    {
      id: "view.zoomIn",
      title: t("commandPalette.commands.zoomIn"),
      group: "View",
      keywords: ["zoom", "in", "acercar", "ampliar", "scale", "larger", "bigger", "display"],
      icon: ViewIcon,
      shortcutId: "view.zoomIn",
      run: ctx.zoomIn ?? noop,
    },
    {
      id: "view.zoomOut",
      title: t("commandPalette.commands.zoomOut"),
      group: "View",
      keywords: ["zoom", "out", "alejar", "reducir", "scale", "smaller", "display"],
      icon: ViewIcon,
      shortcutId: "view.zoomOut",
      run: ctx.zoomOut ?? noop,
    },
    {
      id: "view.zoomReset",
      title: t("commandPalette.commands.zoomReset"),
      group: "View",
      keywords: ["zoom", "reset", "restablecer", "default", "100%", "scale", "display"],
      icon: ViewIcon,
      shortcutId: "view.zoomReset",
      run: ctx.zoomReset ?? noop,
    },
    {
      id: "workbench.runDebug",
      title: t("commandPalette.commands.openRunDebug"),
      group: "View",
      keywords: ["task", "test", "debug", "dap", "run", "ejecutar", "pruebas"],
      icon: CodeIcon,
      disabledReason: noWorkspaceRoot
        ? t("commandPalette.disabled.noWorkspaceRoot")
        : undefined,
      run: ctx.openRunDebug ?? noop,
    },
    {
      id: "editor.problems",
      title: t("commandPalette.commands.editorProblems"),
      group: "View",
      keywords: ["problems", "diagnostics", "errors", "warnings", "lsp", "problemas", "errores"],
      icon: Alert02Icon,
      disabledReason: noWorkspaceRoot
        ? t("commandPalette.disabled.noWorkspaceRoot")
        : undefined,
      run: ctx.openProblems,
    },

    // --- AI ---
    {
      id: "ai.toggle",
      title: t("commandPalette.commands.toggleAi"),
      group: "AI",
      keywords: ["assistant", "chat", "agent", "asistente", "ia"],
      icon: SparklesIcon,
      shortcutId: "ai.toggle",
      run: ctx.toggleAi,
    },
    {
      id: "ai.askSelection",
      title: t("commandPalette.commands.askAiSelection"),
      group: "AI",
      keywords: ["ai", "ask", "selection", "explain", "review", "preguntar", "explicar", "seleccion"],
      icon: SparklesIcon,
      shortcutId: "ai.askSelection",
      run: ctx.askAiSelection,
    },
    {
      id: "agentHistory.open",
      title: t("agentHistory.modalTitle"),
      group: "AI",
      keywords: [
        "agent",
        "history",
        "historial",
        "claude",
        "codex",
        "cursor",
        "transcript",
        "sessions",
        "sesiones",
        "resume",
        "chat",
        "antigravity",
        "gemini",
      ],
      icon: Clock01Icon,
      shortcutId: "agentHistory.open",
      run: () => useAgentHistoryStore.getState().openHistory(),
    },
  ];

  // --- Contextual: Panes (Terminal only) ---
  if (activeTerminalTab) {
    items.push(
      {
        id: "pane.splitRight",
        title: t("commandPalette.commands.splitPaneRight"),
        group: "Panes",
        keywords: ["terminal", "pane", "split", "right", "column", "dividir", "derecha"],
        icon: LayoutTwoColumnIcon,
        shortcutId: "pane.splitRight",
        disabledReason: splitDisabled,
        run: ctx.splitPaneRight,
      },
      {
        id: "pane.splitDown",
        title: t("commandPalette.commands.splitPaneDown"),
        group: "Panes",
        keywords: ["terminal", "pane", "split", "down", "row", "dividir", "abajo"],
        icon: LayoutTwoRowIcon,
        shortcutId: "pane.splitDown",
        disabledReason: splitDisabled,
        run: ctx.splitPaneDown,
      },
    );
  }

  // --- Contextual: Composed Spaces (only when viewing composite spaces) ---
  if (ctx.activeViewSpacePresentation) {
    items.push(
      {
        id: "spaces.focusNextSlot",
        title: t("commandPalette.commands.focusNextSpaceSlot"),
        group: "Spaces",
        keywords: ["space", "slot", "view", "focus", "next", "siguiente"],
        icon: ArrowRight01Icon,
        disabledReason:
          ctx.activeViewSpacePresentation === "composite"
            ? undefined
            : t("commandPalette.disabled.noCompositeSpace"),
        run: () => ctx.focusNextSpaceSlot?.(),
      },
      {
        id: "spaces.focusPreviousSlot",
        title: t("commandPalette.commands.focusPreviousSpaceSlot"),
        group: "Spaces",
        keywords: ["space", "slot", "view", "focus", "previous", "anterior"],
        icon: ArrowLeft01Icon,
        disabledReason:
          ctx.activeViewSpacePresentation === "composite"
            ? undefined
            : t("commandPalette.disabled.noCompositeSpace"),
        run: () => ctx.focusPreviousSpaceSlot?.(),
      },
      {
        id: "spaces.toggleView",
        title: t("commandPalette.commands.toggleSpaceView"),
        group: "Spaces",
        keywords: ["space", "view", "split", "expand", "compact"],
        icon: ViewIcon,
        run: () => ctx.toggleFocusedSpaceView?.(),
      },
      {
        id: "spaces.extractFocusedMember",
        title: t("commandPalette.commands.extractFocusedSpaceMember"),
        group: "Spaces",
        keywords: ["space", "member", "extract", "standalone", "sacar"],
        icon: ArrowRight01Icon,
        run: () => ctx.extractFocusedSpaceMember?.(),
      },
      {
        id: "spaces.moveFocusedMember",
        title: t("commandPalette.commands.moveFocusedSpaceMember"),
        group: "Spaces",
        keywords: ["space", "member", "move", "workspace", "mover"],
        icon: ArrowRight01Icon,
        run: () => ctx.moveFocusedSpaceMember?.(),
      },
      {
        id: "spaces.closeFocusedMember",
        title: t("commandPalette.commands.closeFocusedSpaceMember"),
        group: "Spaces",
        keywords: ["space", "member", "close", "delete", "cerrar"],
        icon: Cancel01Icon,
        run: () => ctx.closeFocusedSpaceMember?.(),
      },
    );
  }

  // --- Contextual: Editor (only when active tab has editorActions) ---
  if (ctx.editorActions) {
    const editorActions = ctx.editorActions;
    const isEditorOrMarkdown =
      activeTab?.kind === "editor" || activeTab?.kind === "markdown";

    if (isEditorOrMarkdown) {
      items.push({
        id: "editor.revealInExplorer",
        title: t("commandPalette.commands.editorRevealInExplorer"),
        group: "Editor",
        keywords: ["file", "explorer", "reveal", "folder", "workspace", "revelar"],
        icon: FileSearchIcon,
        run: () => ctx.revealActiveFileInExplorer?.(),
      });
    }

    if (ctx.canNavigateBack) {
      items.push({
        id: "editor.navigateBack",
        title: t("commandPalette.commands.editorNavigateBack"),
        group: "Editor",
        keywords: ["back", "previous", "location", "navigation", "atras"],
        icon: ArrowLeft01Icon,
        shortcutId: "editor.navigateBack",
        run: ctx.navigateBack,
      });
    }

    if (ctx.canNavigateForward) {
      items.push({
        id: "editor.navigateForward",
        title: t("commandPalette.commands.editorNavigateForward"),
        group: "Editor",
        keywords: ["forward", "next", "location", "navigation", "adelante"],
        icon: ArrowRight01Icon,
        shortcutId: "editor.navigateForward",
        run: ctx.navigateForward,
      });
    }

    items.push(
      {
        id: "editor.find",
        title: t("commandPalette.commands.editorFind"),
        group: "Editor",
        keywords: ["find", "replace", "current file", "editor", "buscar", "reemplazar"],
        icon: Search01Icon,
        shortcutId: "search.focus",
        run: () => editorActions.openSearch(),
      },
      {
        id: "editor.gotoLine",
        title: t("commandPalette.commands.editorGotoLine"),
        group: "Editor",
        keywords: ["line", "goto", "jump", "editor", "linea", "ir a linea"],
        icon: CodeIcon,
        shortcutId: "editor.gotoLine",
        run: () => editorActions.openGotoLine(),
      },
      {
        id: "editor.outline",
        title: t("commandPalette.commands.editorOutline"),
        group: "Editor",
        keywords: ["symbols", "outline", "structure", "workspace", "esquema", "simbolos"],
        icon: HierarchyIcon,
        shortcutId: "editor.outline",
        run: ctx.openOutline,
      },
      {
        id: "editor.formatDocument",
        title: t("commandPalette.commands.editorFormatDocument"),
        group: "Editor",
        keywords: ["format", "prettier", "lsp", "document", "formatear"],
        icon: FileEditIcon,
        shortcutId: "editor.formatDocument",
        run: () => editorActions.formatDocument(),
      },
      {
        id: "editor.quickFix",
        title: t("commandPalette.commands.editorQuickFix"),
        group: "Editor",
        keywords: ["fix", "diagnostic", "error", "ai", "corregir"],
        icon: SparklesIcon,
        shortcutId: "editor.quickFix",
        run: () => editorActions.triggerQuickFix(),
      },
      {
        id: "editor.signatureHelp",
        title: t("commandPalette.commands.editorSignatureHelp"),
        group: "Editor",
        keywords: ["signature", "parameters", "overload", "lsp", "firma"],
        icon: CodeIcon,
        shortcutId: "editor.signatureHelp",
        run: () => editorActions.triggerSignatureHelp(),
      },
      {
        id: "editor.goToDefinition",
        title: t("commandPalette.commands.editorGoToDefinition"),
        group: "Editor",
        keywords: ["definition", "symbol", "navigate", "lsp", "definicion"],
        icon: SourceCodeIcon,
        shortcutId: "editor.goToDefinition",
        run: () => editorActions.triggerLspNavigation("definition"),
      },
      {
        id: "editor.peekDefinition",
        title: t("commandPalette.commands.editorPeekDefinition"),
        group: "Editor",
        keywords: ["peek", "definition", "symbol", "lsp"],
        icon: SourceCodeIcon,
        shortcutId: "editor.peekDefinition",
        run: () => editorActions.triggerLspPeek("definition"),
      },
      {
        id: "editor.goToTypeDefinition",
        title: t("commandPalette.commands.editorGoToTypeDefinition"),
        group: "Editor",
        keywords: ["type", "definition", "symbol", "lsp", "tipo"],
        icon: SourceCodeIcon,
        shortcutId: "editor.goToTypeDefinition",
        run: () => editorActions.triggerLspNavigation("typeDefinition"),
      },
      {
        id: "editor.goToImplementation",
        title: t("commandPalette.commands.editorGoToImplementation"),
        group: "Editor",
        keywords: ["implementation", "symbol", "navigate", "lsp", "implementacion"],
        icon: HierarchyIcon,
        shortcutId: "editor.goToImplementation",
        run: () => editorActions.triggerLspNavigation("implementation"),
      },
      {
        id: "editor.findReferences",
        title: t("commandPalette.commands.editorFindReferences"),
        group: "Editor",
        keywords: ["references", "usages", "symbol", "lsp", "referencias"],
        icon: FileSearchIcon,
        shortcutId: "editor.findReferences",
        run: () => editorActions.triggerLspPeek("references"),
      },
      {
        id: "editor.inlineAi",
        title: t("commandPalette.commands.editorInlineAi"),
        group: "Editor",
        keywords: ["edit", "refactor", "inline", "ai", "editar"],
        icon: SparklesIcon,
        run: () => editorActions.triggerInlineAi(),
      },
      {
        id: "editor.aiComplete",
        title: t("commandPalette.commands.editorAiComplete"),
        group: "Editor",
        keywords: ["autocomplete", "completion", "ghost", "ai", "completar"],
        icon: SparklesIcon,
        shortcutId: "editor.aiComplete",
        run: () => editorActions.triggerAiComplete(),
      },
      {
        id: "editor.codeComplete",
        title: t("commandPalette.commands.editorCodeComplete"),
        group: "Editor",
        keywords: ["autocomplete", "completion", "lsp", "code"],
        icon: CodeIcon,
        shortcutId: "editor.codeComplete",
        run: () => editorActions.triggerCodeComplete(),
      },
      {
        id: "editor.acceptAiCompletion",
        title: t("commandPalette.commands.editorAcceptAiCompletion"),
        group: "Editor",
        keywords: ["autocomplete", "ghost", "accept", "all", "aceptar"],
        icon: SparklesIcon,
        run: () => editorActions.runInlineSuggestionCommand("accept"),
      },
      {
        id: "editor.acceptAiLine",
        title: t("commandPalette.commands.editorAcceptAiLine"),
        group: "Editor",
        keywords: ["autocomplete", "ghost", "accept", "line", "linea"],
        icon: SparklesIcon,
        run: () => editorActions.runInlineSuggestionCommand("acceptLine"),
      },
      {
        id: "editor.acceptAiToken",
        title: t("commandPalette.commands.editorAcceptAiToken"),
        group: "Editor",
        keywords: ["autocomplete", "ghost", "accept", "token"],
        icon: SparklesIcon,
        run: () => editorActions.runInlineSuggestionCommand("acceptToken"),
      },
      {
        id: "editor.dismissAiCompletion",
        title: t("commandPalette.commands.editorDismissAiCompletion"),
        group: "Editor",
        keywords: ["autocomplete", "ghost", "dismiss", "cancel", "descartar"],
        icon: Cancel01Icon,
        run: () => editorActions.runInlineSuggestionCommand("dismiss"),
      },
      ...(
        [
          ["editor.addCursorAbove", "editorAddCursorAbove", "addCursorAbove"],
          ["editor.addCursorBelow", "editorAddCursorBelow", "addCursorBelow"],
          [
            "editor.clearMultipleCursors",
            "editorClearMultipleCursors",
            "clearMultipleCursors",
          ],
          ["editor.moveLineUp", "editorMoveLineUp", "moveLineUp"],
          ["editor.moveLineDown", "editorMoveLineDown", "moveLineDown"],
          ["editor.copyLineUp", "editorCopyLineUp", "copyLineUp"],
          ["editor.copyLineDown", "editorCopyLineDown", "copyLineDown"],
          ["editor.expandSelection", "editorExpandSelection", "expandSelection"],
        ] as const
      ).map(([id, label, command]) => ({
        id,
        title: t(`commandPalette.commands.${label}`),
        group: "Editor" as const,
        keywords: ["editor", "selection", "cursor", "line", command],
        icon: CodeIcon,
        run: () => editorActions.runEditCommand(command),
      })),
      {
        id: "editor.splitGroupRight",
        title: t("commandPalette.commands.editorSplitGroupRight"),
        group: "Editor",
        keywords: ["editor", "group", "split", "right", "horizontal", "dividir"],
        icon: LayoutTwoColumnIcon,
        run: () => editorActions.splitGroup("row"),
      },
      {
        id: "editor.splitGroupDown",
        title: t("commandPalette.commands.editorSplitGroupDown"),
        group: "Editor",
        keywords: ["editor", "group", "split", "down", "vertical", "dividir"],
        icon: LayoutTwoRowIcon,
        run: () => editorActions.splitGroup("col"),
      },
      {
        id: "editor.focusNextGroup",
        title: t("commandPalette.commands.editorFocusNextGroup"),
        group: "Editor",
        keywords: ["editor", "group", "focus", "next"],
        icon: LayoutTwoColumnIcon,
        run: () => editorActions.focusGroup(1),
      },
      {
        id: "editor.closeGroup",
        title: t("commandPalette.commands.editorCloseGroup"),
        group: "Editor",
        keywords: ["editor", "group", "close", "cerrar grupo"],
        icon: Cancel01Icon,
        run: () => editorActions.closeGroup(),
      },
    );
  }

  try {
    const extState = useExtensionStore.getState();
    for (const active of Object.values(extState.activeExtensions)) {
      const cmds = active.info.contributes.commands;
      if (active.status === "active" && Array.isArray(cmds)) {
        for (const cmd of cmds) {
          items.push({
            id: cmd.command,
            title: cmd.title,
            group: "Extensions",
            keywords: [active.info.name, active.info.publisher, cmd.title],
            icon: PackageIcon,
            run: () => {
              const handler = extensionCommands.get(cmd.command);
              if (handler) {
                void handler();
              }
            },
          });
        }
      }
    }
  } catch {
    // ignore extension store access errors if called outside React
  }

  if (ctx.aiAvailable === false) {
    const aiCommandIds = new Set([
      "ai.toggle",
      "ai.askSelection",
      "editor.inlineAi",
      "editor.aiComplete",
      "editor.acceptAiCompletion",
      "editor.acceptAiLine",
      "editor.acceptAiToken",
      "editor.dismissAiCompletion",
    ]);
    return items.filter((item) => !aiCommandIds.has(item.id));
  }
  return items;
}
