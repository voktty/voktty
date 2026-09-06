import { useAgentHistoryStore } from "@/modules/agent-history";
import type { CommandPaletteActionContext } from "@/modules/command-palette";
import { t } from "@/modules/i18n";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { useArcadeStore } from "@/modules/statusbar/arcadeStore";
import { useCommandHistoryStore } from "@/modules/terminal";
import {
  Alert02Icon,
  BrainIcon,
  Clock01Icon,
  CommandIcon,
  ComputerScreenShareIcon,
  ComputerTerminal02Icon,
  ContainerIcon,
  DashboardSquare01Icon,
  Download01Icon,
  File02Icon,
  FileEditIcon,
  FileSearchIcon,
  FolderGitTwoIcon,
  GlobalIcon,
  GlobalSearchIcon,
  Globe02Icon,
  HierarchyIcon,
  IncognitoIcon,
  InformationCircleIcon,
  KeyboardIcon,
  Layout01Icon,
  LayoutTwoRowIcon,
  LockPasswordIcon,
  PaintBoardIcon,
  PlayIcon,
  PlugIcon,
  PuzzleIcon,
  Rocket01Icon,
  ServerStack01Icon,
  Settings01Icon,
  SparklesIcon,
  UsbIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { LauncherItem } from "./types";

/** Surfaces the launcher can reach that the palette context does not already
 * carry. They live behind their own dialogs, so App wires them in. */
export type LauncherExtraContext = {
  openSshConnect?: () => void;
  openRdpConnect?: () => void;
  openGuestConnect?: () => void;
};

export type LauncherActionContext = CommandPaletteActionContext &
  LauncherExtraContext;

export function createLauncherItems(
  ctx: LauncherActionContext,
): LauncherItem[] {
  const items: (LauncherItem | null)[] = [
    // --- Terminals ---
    {
      id: "launch.terminal",
      title: t("launcher.items.terminal"),
      group: "terminals",
      keywords: ["terminal", "shell", "consola", "console", "new", "nueva"],
      icon: ComputerTerminal02Icon,
      tint: "text-emerald-400",
      run: ctx.openNewTab,
    },
    {
      id: "launch.blockTerminal",
      title: t("launcher.items.blockTerminal"),
      group: "terminals",
      keywords: ["blocks", "bloques", "prompt", "terminal"],
      icon: LayoutTwoRowIcon,
      tint: "text-emerald-400",
      run: ctx.openNewBlock,
    },
    {
      id: "launch.privateTerminal",
      title: t("launcher.items.privateTerminal"),
      group: "terminals",
      keywords: ["private", "privada", "incognito", "terminal"],
      icon: IncognitoIcon,
      tint: "text-emerald-400",
      run: ctx.openNewPrivate,
    },
    {
      id: "launch.commandHistory",
      title: t("launcher.items.commandHistory"),
      group: "terminals",
      keywords: ["history", "historial", "comandos", "commands"],
      icon: Clock01Icon,
      tint: "text-emerald-400",
      run: () => useCommandHistoryStore.getState().openHistory(),
    },

    // --- Connections ---
    ctx.openSshConnect
      ? {
          id: "launch.ssh",
          title: t("launcher.items.ssh"),
          group: "connections",
          keywords: ["ssh", "remote", "remoto", "servidor", "server"],
          icon: ServerStack01Icon,
          tint: "text-sky-400",
          run: ctx.openSshConnect,
        }
      : null,
    ctx.openSerialConnect
      ? {
          id: "launch.serial",
          title: t("launcher.items.serial"),
          group: "connections",
          keywords: ["serial", "serie", "com", "tty", "usb", "uart"],
          icon: UsbIcon,
          tint: "text-sky-400",
          run: ctx.openSerialConnect,
        }
      : null,
    ctx.openRdpConnect
      ? {
          id: "launch.rdp",
          title: t("launcher.items.rdp"),
          group: "connections",
          keywords: ["rdp", "escritorio", "desktop", "remote", "windows"],
          icon: ComputerScreenShareIcon,
          tint: "text-sky-400",
          run: ctx.openRdpConnect,
        }
      : null,
    ctx.openGuestConnect
      ? {
          id: "launch.guestConnect",
          title: t("launcher.items.guestConnect"),
          group: "connections",
          keywords: ["collab", "colaborar", "guest", "invitado", "unirse", "join"],
          icon: UserGroupIcon,
          tint: "text-sky-400",
          run: ctx.openGuestConnect,
        }
      : null,

    // --- Development ---
    {
      id: "launch.editor",
      title: t("launcher.items.editor"),
      group: "development",
      keywords: ["editor", "code", "codigo", "file", "archivo"],
      icon: FileEditIcon,
      tint: "text-amber-400",
      run: ctx.openNewEditor,
    },
    ctx.openFileFromDisk
      ? {
          id: "launch.openFile",
          title: t("launcher.items.openFile"),
          group: "development",
          keywords: ["open", "abrir", "file", "archivo", "disk", "disco"],
          icon: File02Icon,
          tint: "text-amber-400",
          run: ctx.openFileFromDisk,
        }
      : null,
    {
      id: "launch.quickOpen",
      title: t("launcher.items.quickOpen"),
      group: "development",
      keywords: ["quick", "rapida", "goto", "ir", "file", "archivo"],
      icon: FileSearchIcon,
      tint: "text-amber-400",
      run: ctx.openQuickOpen,
    },
    {
      id: "launch.search",
      title: t("launcher.items.search"),
      group: "development",
      keywords: ["search", "buscar", "grep", "find", "contenido"],
      icon: GlobalSearchIcon,
      tint: "text-amber-400",
      run: ctx.openWorkspaceSearch,
    },
    {
      id: "launch.browser",
      title: t("launcher.items.browser"),
      group: "development",
      keywords: ["browser", "navegador", "preview", "web", "vista"],
      icon: Globe02Icon,
      tint: "text-amber-400",
      run: ctx.openNewPreview,
    },
    ctx.openNewApiClient
      ? {
          id: "launch.apiClient",
          title: t("launcher.items.apiClient"),
          group: "development",
          keywords: ["api", "http", "rest", "client", "cliente", "request"],
          icon: GlobalIcon,
          tint: "text-amber-400",
          run: ctx.openNewApiClient,
        }
      : null,
    ctx.openRunDebug
      ? {
          id: "launch.runDebug",
          title: t("launcher.items.runDebug"),
          group: "development",
          keywords: ["run", "debug", "ejecutar", "depurar", "dap"],
          icon: PlayIcon,
          tint: "text-amber-400",
          run: ctx.openRunDebug,
        }
      : null,
    {
      id: "launch.problems",
      title: t("launcher.items.problems"),
      group: "development",
      keywords: ["problems", "problemas", "errors", "errores", "lint"],
      icon: Alert02Icon,
      tint: "text-amber-400",
      run: ctx.openProblems,
    },
    {
      id: "launch.outline",
      title: t("launcher.items.outline"),
      group: "development",
      keywords: ["outline", "esquema", "symbols", "simbolos", "estructura"],
      icon: HierarchyIcon,
      tint: "text-amber-400",
      run: ctx.openOutline,
    },

    // --- Git ---
    {
      id: "launch.gitGraph",
      title: t("launcher.items.gitGraph"),
      group: "git",
      keywords: ["git", "graph", "grafo", "commits", "historial", "log"],
      icon: HierarchyIcon,
      tint: "text-orange-400",
      run: ctx.openGitGraph,
    },
    {
      id: "launch.sourceControl",
      title: t("launcher.items.sourceControl"),
      group: "git",
      keywords: ["git", "source", "control", "cambios", "changes", "commit"],
      icon: FolderGitTwoIcon,
      tint: "text-orange-400",
      run: ctx.toggleSourceControl,
    },
    ctx.openGitClone
      ? {
          id: "launch.gitClone",
          title: t("launcher.items.gitClone"),
          group: "git",
          keywords: ["git", "clone", "clonar", "repo", "repositorio"],
          icon: Download01Icon,
          tint: "text-orange-400",
          run: ctx.openGitClone,
        }
      : null,

    // --- AI ---
    ctx.openNewHarness
      ? {
          id: "launch.harness",
          title: t("launcher.items.harness"),
          group: "ai",
          keywords: ["harness", "agent", "agente", "claude", "codex", "dev"],
          icon: SparklesIcon,
          tint: "text-violet-400",
          run: ctx.openNewHarness,
        }
      : null,
    {
      id: "launch.aiAgent",
      title: t("launcher.items.aiAgent"),
      group: "ai",
      keywords: ["ai", "ia", "chat", "agente", "agent", "asistente"],
      icon: BrainIcon,
      tint: "text-violet-400",
      run: ctx.toggleAi,
    },
    {
      id: "launch.agentHistory",
      title: t("launcher.items.agentHistory"),
      group: "ai",
      keywords: [
        "agent",
        "agente",
        "history",
        "historial",
        "sesiones",
        "sessions",
        "claude",
        "codex",
      ],
      icon: Clock01Icon,
      tint: "text-violet-400",
      run: () => useAgentHistoryStore.getState().openHistory(),
    },

    // --- System ---
    {
      id: "launch.settings",
      title: t("launcher.items.settings"),
      group: "system",
      keywords: ["settings", "ajustes", "preferencias", "config"],
      icon: Settings01Icon,
      run: ctx.openSettings,
    },
    {
      id: "launch.shortcuts",
      title: t("launcher.items.shortcuts"),
      group: "system",
      keywords: ["shortcuts", "atajos", "teclado", "keyboard", "keys"],
      icon: KeyboardIcon,
      run: ctx.openKeyboardShortcuts,
    },
    {
      id: "launch.themes",
      title: t("launcher.items.themes"),
      group: "system",
      keywords: ["theme", "tema", "apariencia", "colors", "colores"],
      icon: PaintBoardIcon,
      run: () => void openSettingsWindow("themes"),
    },
    {
      id: "launch.models",
      title: t("launcher.items.models"),
      group: "system",
      keywords: ["models", "modelos", "ai", "ia", "providers", "proveedores"],
      icon: BrainIcon,
      run: () => void openSettingsWindow("models"),
    },
    {
      id: "launch.extensions",
      title: t("launcher.items.extensions"),
      group: "system",
      keywords: ["extensions", "extensiones", "plugins", "addons"],
      icon: PuzzleIcon,
      run: () => void openSettingsWindow("extensions"),
    },
    {
      id: "launch.mcp",
      title: t("launcher.items.mcp"),
      group: "system",
      keywords: ["mcp", "servers", "servidores", "tools", "herramientas"],
      icon: PlugIcon,
      run: () => void openSettingsWindow("mcp"),
    },
    {
      id: "launch.aliases",
      title: t("launcher.items.aliases"),
      group: "system",
      keywords: ["alias", "aliases", "comandos", "commands", "shell"],
      icon: CommandIcon,
      run: () => void openSettingsWindow("aliases"),
    },
    {
      id: "launch.vault",
      title: t("launcher.items.vault"),
      group: "system",
      keywords: ["vault", "boveda", "secrets", "secretos", "keys", "claves"],
      icon: LockPasswordIcon,
      run: () => void openSettingsWindow("vault"),
    },
    {
      id: "launch.spaces",
      title: t("launcher.items.spaces"),
      group: "system",
      keywords: ["spaces", "espacios", "layout", "workspaces"],
      icon: Layout01Icon,
      run: ctx.openSpacesOverview,
    },
    {
      id: "launch.activeTabs",
      title: t("launcher.items.activeTabs"),
      group: "system",
      keywords: ["tabs", "pestanas", "active", "activas", "switch"],
      icon: DashboardSquare01Icon,
      run: ctx.openActiveTabs,
    },
    // Settings panes that no menu and no palette command reach today. They are
    // whole tools in their own right, not preferences.
    {
      id: "launch.sshSettings",
      title: t("launcher.items.sshSettings"),
      group: "connections",
      keywords: ["ssh", "tunnels", "tuneles", "hosts", "claves", "keys"],
      icon: ServerStack01Icon,
      run: () => void openSettingsWindow("ssh"),
    },
    {
      id: "launch.dockerSettings",
      title: t("launcher.items.dockerSettings"),
      group: "connections",
      keywords: ["docker", "containers", "contenedores", "images", "imagenes"],
      icon: ContainerIcon,
      run: () => void openSettingsWindow("docker"),
    },
    {
      id: "launch.rdpSettings",
      title: t("launcher.items.rdpSettings"),
      group: "connections",
      keywords: ["rdp", "escritorio", "desktop", "hosts"],
      icon: ComputerScreenShareIcon,
      run: () => void openSettingsWindow("rdp"),
    },
    {
      id: "launch.harnessSettings",
      title: t("launcher.items.harnessSettings"),
      group: "ai",
      keywords: ["harness", "settings", "ajustes", "agentes", "agents"],
      icon: Settings01Icon,
      tint: "text-violet-400",
      run: () => void openSettingsWindow("harness"),
    },
    {
      id: "launch.about",
      title: t("launcher.items.about"),
      group: "system",
      keywords: ["about", "acerca", "version", "info", "updates"],
      icon: InformationCircleIcon,
      run: () => void openSettingsWindow("about"),
    },
    ctx.openOnboarding
      ? {
          id: "launch.onboarding",
          title: t("launcher.items.onboarding"),
          group: "system",
          keywords: ["onboarding", "welcome", "bienvenida", "tour", "inicio"],
          icon: Rocket01Icon,
          run: ctx.openOnboarding,
        }
      : null,

    // --- Extras ---
    {
      id: "launch.arcade",
      title: t("launcher.items.arcade"),
      group: "extras",
      keywords: ["arcade", "game", "juego", "pacman", "snake", "pac-man"],
      icon: PlayIcon,
      tint: "text-yellow-400",
      run: () => useArcadeStore.getState().openArcade(),
    },
  ];

  return items.filter((item): item is LauncherItem => item !== null);
}
