import { useAgentHistoryStore } from "@/modules/agent-history";
import { extensionCommands, useExtensionStore } from "@/modules/extensions";
import type { SearchTarget } from "@/modules/header";
import { t } from "@/modules/i18n";
import { downloadConfiguration } from "@/modules/settings/configExport";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { stopAllSshTunnels } from "@/modules/ssh/tunnels";
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
  DashboardSquare01Icon,
  Download01Icon,
  File02Icon,
  FileEditIcon,
  FileSearchIcon,
  GlobalIcon,
  Globe02Icon,
  IncognitoIcon,
  Key01Icon,
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
  StopIcon,
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
  const editorDisabled = ctx.editorActions
    ? undefined
    : t("commandPalette.disabled.noEditorTab");

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
      id: "vault.open",
      title: t("commandPalette.commands.openVault"),
      group: "General",
      keywords: [
        "vault",
        "keys",
        "ssh",
        "passwords",
        "security",
        "secrets",
        "cifrado",
      ],
      icon: Key01Icon,
      run: () => {
        void openSettingsWindow("vault");
      },
    },
    {
      id: "vault.lock",
      title: t("commandPalette.commands.lockVault"),
      group: "General",
      keywords: ["vault", "lock", "bloquear", "seguridad"],
      icon: LockPasswordIcon,
      run: () => {
        useVaultStore.getState().lockVault();
      },
    },
    {
      id: "ssh.tunnels.open",
      title: t("commandPalette.commands.openTunnels"),
      group: "General",
      keywords: [
        "tunnel",
        "port forwarding",
        "forward",
        "ssh",
        "puerto",
        "proxy",
        "socks5",
      ],
      icon: GlobalIcon,
      run: () => {
        void openSettingsWindow("ssh");
      },
    },
    {
      id: "ssh.tunnels.stopAll",
      title: t("commandPalette.commands.stopAllTunnels"),
      group: "General",
      keywords: ["tunnel", "stop all", "detener", "forwarding", "ssh"],
      icon: StopIcon,
      run: () => {
        void stopAllSshTunnels();
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
      ],
      icon: DashboardSquare01Icon,
      run: ctx.openSpacesOverview,
    },
    {
      id: "spaces.new",
      title: t("commandPalette.commands.newSpace"),
      group: "Spaces",
      keywords: ["space", "session", "workspace", "group", "create"],
      icon: DashboardSquare01Icon,
      run: ctx.newSpace,
    },
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
      disabledReason: ctx.activeViewSpacePresentation
        ? undefined
        : t("commandPalette.disabled.noCompositeSpace"),
      run: () => ctx.toggleFocusedSpaceView?.(),
    },
    {
      id: "spaces.extractFocusedMember",
      title: t("commandPalette.commands.extractFocusedSpaceMember"),
      group: "Spaces",
      keywords: ["space", "member", "extract", "standalone", "sacar"],
      icon: ArrowRight01Icon,
      disabledReason: ctx.activeViewSpacePresentation
        ? undefined
        : t("commandPalette.disabled.noCompositeSpace"),
      run: () => ctx.extractFocusedSpaceMember?.(),
    },
    {
      id: "spaces.moveFocusedMember",
      title: t("commandPalette.commands.moveFocusedSpaceMember"),
      group: "Spaces",
      keywords: ["space", "member", "move", "workspace", "mover"],
      icon: ArrowRight01Icon,
      disabledReason: ctx.activeViewSpacePresentation
        ? undefined
        : t("commandPalette.disabled.noCompositeSpace"),
      run: () => ctx.moveFocusedSpaceMember?.(),
    },
    {
      id: "spaces.closeFocusedMember",
      title: t("commandPalette.commands.closeFocusedSpaceMember"),
      group: "Spaces",
      keywords: ["space", "member", "close", "delete", "cerrar"],
      icon: Cancel01Icon,
      disabledReason: ctx.activeViewSpacePresentation
        ? undefined
        : t("commandPalette.disabled.noCompositeSpace"),
      run: () => ctx.closeFocusedSpaceMember?.(),
    },
    ...ctx.spaces.map((sp) => ({
      id: `spaces.switch.${sp.id}`,
      title: t("commandPalette.commands.switchToSpace", { name: sp.name }),
      group: "Spaces" as const,
      keywords: ["space", "switch", "session", sp.name],
      icon: DashboardSquare01Icon,
      disabledReason:
        sp.id === ctx.activeSpaceId
          ? t("commandPalette.disabled.currentSpace")
          : undefined,
      run: () => ctx.switchSpace(sp.id),
    })),
    {
      id: "tab.new",
      title: t("commandPalette.commands.newTerminal"),
      group: "Tabs",
      keywords: ["shell", "terminal", "new tab"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      run: ctx.openNewTab,
    },
    {
      id: "tab.newBlock",
      title: t("commandPalette.commands.newBlockTerminal"),
      group: "Tabs",
      keywords: ["blocks", "warp", "command blocks", "terminal"],
      icon: DashboardSquare01Icon,
      run: ctx.openNewBlock,
    },
    {
      id: "tab.newPrivate",
      title: t("commandPalette.commands.newPrivateTerminal"),
      group: "Tabs",
      keywords: ["privacy", "private", "incognito", "hidden from ai"],
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
        "ssh",
        "powershell",
        "bash",
        "zsh",
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
      keywords: ["file", "editor", "create"],
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
      keywords: ["file", "workspace", "quick", "search", "open"],
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
      keywords: ["file", "open", "disk", "editor", "abrir"],
      icon: File02Icon,
      shortcutId: "editor.openFile",
      run: () => ctx.openFileFromDisk?.(),
    },
    {
      id: "tab.newPreview",
      title: t("commandPalette.commands.newWebPreview"),
      group: "Tabs",
      keywords: ["browser", "web", "localhost", "preview"],
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
      ],
      icon: GlobalIcon,
      shortcutId: "tab.newApiClient",
      run: () => ctx.openNewApiClient?.(),
    },
    {
      id: "tab.close",
      title: t("commandPalette.commands.closeTabOrPane"),
      group: "Tabs",
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabled,
      run: ctx.closeActiveTabOrPane,
    },
    {
      id: "editor.reopenClosed",
      title: t("commandPalette.commands.editorReopenClosed"),
      group: "Tabs",
      keywords: ["editor", "reopen", "restore", "closed", "file"],
      icon: FileEditIcon,
      run: () => ctx.reopenClosedEditor?.(),
    },
    {
      id: "tab.toggleLock",
      title: activeTab?.locked
        ? t("commandPalette.commands.unlockTab")
        : t("commandPalette.commands.lockTab"),
      group: "Tabs",
      keywords: ["tab", "lock", "unlock", "protect", "freeze"],
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
      keywords: ["tabs", "open", "switch", "active"],
      icon: DashboardSquare01Icon,
      shortcutId: "tabs.launchpad",
      run: ctx.openActiveTabs,
    },
    {
      id: "pane.splitRight",
      title: t("commandPalette.commands.splitPaneRight"),
      group: "Panes",
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitDisabled,
      run: ctx.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      title: t("commandPalette.commands.splitPaneDown"),
      group: "Panes",
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitDisabled,
      run: ctx.splitPaneDown,
    },
    {
      id: "git.graph",
      title: t("commandPalette.commands.openGitGraph"),
      group: "Git",
      keywords: ["git", "graph", "history", "log", "commits"],
      icon: SourceCodeIcon,
      run: ctx.openGitGraph,
    },
    {
      id: "git.source",
      title: t("commandPalette.commands.toggleSourceControl"),
      group: "Git",
      keywords: ["git", "source control", "changes", "staging", "diff"],
      icon: SourceCodeIcon,
      shortcutId: "pane.source",
      run: ctx.toggleSourceControl,
    },
    {
      id: "search.content",
      title: t("commandPalette.commands.findInFiles"),
      group: "Search",
      keywords: ["grep", "ripgrep", "text", "contents", "search in files"],
      icon: FileSearchIcon,
      shortcutId: "commandPalette.content",
      run: ctx.openWorkspaceSearch,
    },
    {
      id: "editor.find",
      title: t("commandPalette.commands.editorFind"),
      group: "Editor",
      keywords: ["find", "replace", "current file", "editor"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.openSearch(),
    },
    {
      id: "editor.gotoLine",
      title: t("commandPalette.commands.editorGotoLine"),
      group: "Editor",
      keywords: ["line", "goto", "jump", "editor"],
      icon: CodeIcon,
      shortcutId: "editor.gotoLine",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.openGotoLine(),
    },
    {
      id: "editor.revealInExplorer",
      title: t("commandPalette.commands.editorRevealInExplorer"),
      group: "Editor",
      keywords: ["file", "explorer", "reveal", "folder", "workspace"],
      icon: FileSearchIcon,
      disabledReason:
        activeTab?.kind === "editor" || activeTab?.kind === "markdown"
          ? undefined
          : t("commandPalette.disabled.noEditorTab"),
      run: () => ctx.revealActiveFileInExplorer?.(),
    },
    {
      id: "editor.navigateBack",
      title: t("commandPalette.commands.editorNavigateBack"),
      group: "Editor",
      keywords: ["back", "previous", "location", "navigation"],
      icon: ArrowLeft01Icon,
      shortcutId: "editor.navigateBack",
      disabledReason: ctx.canNavigateBack
        ? undefined
        : t("commandPalette.disabled.noPreviousLocation"),
      run: ctx.navigateBack,
    },
    {
      id: "editor.navigateForward",
      title: t("commandPalette.commands.editorNavigateForward"),
      group: "Editor",
      keywords: ["forward", "next", "location", "navigation"],
      icon: ArrowRight01Icon,
      shortcutId: "editor.navigateForward",
      disabledReason: ctx.canNavigateForward
        ? undefined
        : t("commandPalette.disabled.noNextLocation"),
      run: ctx.navigateForward,
    },
    {
      id: "editor.outline",
      title: t("commandPalette.commands.editorOutline"),
      group: "Editor",
      keywords: ["symbols", "outline", "structure", "workspace"],
      icon: HierarchyIcon,
      shortcutId: "editor.outline",
      disabledReason: editorDisabled,
      run: ctx.openOutline,
    },
    {
      id: "editor.problems",
      title: t("commandPalette.commands.editorProblems"),
      group: "Editor",
      keywords: ["problems", "diagnostics", "errors", "warnings", "lsp"],
      icon: Alert02Icon,
      disabledReason: noWorkspaceRoot
        ? t("commandPalette.disabled.noWorkspaceRoot")
        : undefined,
      run: ctx.openProblems,
    },
    {
      id: "workbench.runDebug",
      title: t("commandPalette.commands.openRunDebug"),
      group: "View",
      keywords: ["task", "test", "debug", "dap", "run"],
      icon: CodeIcon,
      disabledReason: noWorkspaceRoot
        ? t("commandPalette.disabled.noWorkspaceRoot")
        : undefined,
      run: ctx.openRunDebug ?? noop,
    },
    {
      id: "editor.formatDocument",
      title: t("commandPalette.commands.editorFormatDocument"),
      group: "Editor",
      keywords: ["format", "prettier", "lsp", "document"],
      icon: FileEditIcon,
      shortcutId: "editor.formatDocument",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.formatDocument(),
    },
    {
      id: "editor.quickFix",
      title: t("commandPalette.commands.editorQuickFix"),
      group: "Editor",
      keywords: ["fix", "diagnostic", "error", "ai"],
      icon: SparklesIcon,
      shortcutId: "editor.quickFix",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerQuickFix(),
    },
    {
      id: "editor.signatureHelp",
      title: t("commandPalette.commands.editorSignatureHelp"),
      group: "Editor",
      keywords: ["signature", "parameters", "overload", "lsp"],
      icon: CodeIcon,
      shortcutId: "editor.signatureHelp",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerSignatureHelp(),
    },
    {
      id: "editor.goToDefinition",
      title: t("commandPalette.commands.editorGoToDefinition"),
      group: "Editor",
      keywords: ["definition", "symbol", "navigate", "lsp"],
      icon: SourceCodeIcon,
      shortcutId: "editor.goToDefinition",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerLspNavigation("definition"),
    },
    {
      id: "editor.peekDefinition",
      title: t("commandPalette.commands.editorPeekDefinition"),
      group: "Editor",
      keywords: ["peek", "definition", "symbol", "lsp"],
      icon: SourceCodeIcon,
      shortcutId: "editor.peekDefinition",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerLspPeek("definition"),
    },
    {
      id: "editor.goToTypeDefinition",
      title: t("commandPalette.commands.editorGoToTypeDefinition"),
      group: "Editor",
      keywords: ["type", "definition", "symbol", "lsp"],
      icon: SourceCodeIcon,
      shortcutId: "editor.goToTypeDefinition",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerLspNavigation("typeDefinition"),
    },
    {
      id: "editor.goToImplementation",
      title: t("commandPalette.commands.editorGoToImplementation"),
      group: "Editor",
      keywords: ["implementation", "symbol", "navigate", "lsp"],
      icon: HierarchyIcon,
      shortcutId: "editor.goToImplementation",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerLspNavigation("implementation"),
    },
    {
      id: "editor.findReferences",
      title: t("commandPalette.commands.editorFindReferences"),
      group: "Editor",
      keywords: ["references", "usages", "symbol", "lsp"],
      icon: FileSearchIcon,
      shortcutId: "editor.findReferences",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerLspPeek("references"),
    },
    {
      id: "editor.inlineAi",
      title: t("commandPalette.commands.editorInlineAi"),
      group: "Editor",
      keywords: ["edit", "refactor", "inline", "ai"],
      icon: SparklesIcon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerInlineAi(),
    },
    {
      id: "editor.aiComplete",
      title: t("commandPalette.commands.editorAiComplete"),
      group: "Editor",
      keywords: ["autocomplete", "completion", "ghost", "ai"],
      icon: SparklesIcon,
      shortcutId: "editor.aiComplete",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerAiComplete(),
    },
    {
      id: "editor.codeComplete",
      title: t("commandPalette.commands.editorCodeComplete"),
      group: "Editor",
      keywords: ["autocomplete", "completion", "lsp", "code"],
      icon: CodeIcon,
      shortcutId: "editor.codeComplete",
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.triggerCodeComplete(),
    },
    {
      id: "editor.acceptAiCompletion",
      title: t("commandPalette.commands.editorAcceptAiCompletion"),
      group: "Editor",
      keywords: ["autocomplete", "ghost", "accept", "all"],
      icon: SparklesIcon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.runInlineSuggestionCommand("accept"),
    },
    {
      id: "editor.acceptAiLine",
      title: t("commandPalette.commands.editorAcceptAiLine"),
      group: "Editor",
      keywords: ["autocomplete", "ghost", "accept", "line"],
      icon: SparklesIcon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.runInlineSuggestionCommand("acceptLine"),
    },
    {
      id: "editor.acceptAiToken",
      title: t("commandPalette.commands.editorAcceptAiToken"),
      group: "Editor",
      keywords: ["autocomplete", "ghost", "accept", "token"],
      icon: SparklesIcon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.runInlineSuggestionCommand("acceptToken"),
    },
    {
      id: "editor.dismissAiCompletion",
      title: t("commandPalette.commands.editorDismissAiCompletion"),
      group: "Editor",
      keywords: ["autocomplete", "ghost", "dismiss", "cancel"],
      icon: Cancel01Icon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.runInlineSuggestionCommand("dismiss"),
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
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.runEditCommand(command),
    })),
    {
      id: "editor.splitGroupRight",
      title: t("commandPalette.commands.editorSplitGroupRight"),
      group: "Editor",
      keywords: ["editor", "group", "split", "right", "horizontal"],
      icon: LayoutTwoColumnIcon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.splitGroup("row"),
    },
    {
      id: "editor.splitGroupDown",
      title: t("commandPalette.commands.editorSplitGroupDown"),
      group: "Editor",
      keywords: ["editor", "group", "split", "down", "vertical"],
      icon: LayoutTwoRowIcon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.splitGroup("col"),
    },
    {
      id: "editor.focusNextGroup",
      title: t("commandPalette.commands.editorFocusNextGroup"),
      group: "Editor",
      keywords: ["editor", "group", "focus", "next"],
      icon: LayoutTwoColumnIcon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.focusGroup(1),
    },
    {
      id: "editor.closeGroup",
      title: t("commandPalette.commands.editorCloseGroup"),
      group: "Editor",
      keywords: ["editor", "group", "close"],
      icon: Cancel01Icon,
      disabledReason: editorDisabled,
      run: () => ctx.editorActions?.closeGroup(),
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
    {
      id: "search.focus",
      title: t("commandPalette.commands.findInCurrentTab"),
      group: "Search",
      keywords: ["find", "terminal", "editor", "current"],
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
      keywords: ["explorer", "workspace", "file", "open"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: ctx.explorerRoot
        ? undefined
        : t("commandPalette.disabled.noWorkspaceRoot"),
      run: ctx.focusExplorerSearch,
    },
    {
      id: "sidebar.toggle",
      title: t("commandPalette.commands.toggleExplorer"),
      group: "View",
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
    {
      id: "explorer.toggleHidden",
      title: t("commandPalette.commands.toggleHiddenFiles"),
      group: "View",
      keywords: ["dotfiles", "hidden", "explorer", "gitignore", "env"],
      icon: ViewIcon,
      shortcutId: "explorer.toggleHidden",
      run: ctx.toggleHiddenFiles,
    },
    {
      id: "ai.toggle",
      title: t("commandPalette.commands.toggleAi"),
      group: "AI",
      keywords: ["assistant", "chat", "agent"],
      icon: SparklesIcon,
      shortcutId: "ai.toggle",
      run: ctx.toggleAi,
    },
    {
      id: "ai.askSelection",
      title: t("commandPalette.commands.askAiAboutSelection"),
      group: "AI",
      keywords: ["ai", "ask", "selection", "explain", "review"],
      icon: SparklesIcon,
      shortcutId: "ai.askSelection",
      run: ctx.askAiSelection,
    },
    {
      id: "agentHistory.open",
      title: "Agent Operational History",
      group: "AI",
      keywords: [
        "agent",
        "history",
        "claude",
        "codex",
        "cursor",
        "transcript",
        "sessions",
        "resume",
        "chat",
      ],
      icon: Clock01Icon,
      run: () => useAgentHistoryStore.getState().openHistory(),
    },
  ];

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
