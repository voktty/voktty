import { useAgentHistoryStore } from "@/modules/agent-history";
import type { CommandPaletteActionContext } from "@/modules/command-palette";
import { t } from "@/modules/i18n";
import { useArcadeStore } from "@/modules/statusbar/arcadeStore";
import { useCommandHistoryStore } from "@/modules/terminal";
import {
  Alert02Icon,
  BrainIcon,
  Clock01Icon,
  ComputerScreenShareIcon,
  ComputerTerminal02Icon,
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
  Layout01Icon,
  LayoutTwoRowIcon,
  PlayIcon,
  Rocket01Icon,
  ServerStack01Icon,
  SparklesIcon,
  UsbIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { LauncherItem } from "./types";

/** Surfaces the launcher can reach that the palette context does not already
 * carry. They live behind their own dialogs, so App wires them in. */
export type LauncherExtraContext = {
  openConnections?: () => void;
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
    ctx.openConnections
      ? {
          id: "launch.connections",
          title: t("launcher.items.connections"),
          group: "connections",
          keywords: [
            "connections",
            "conexiones",
            "active",
            "activas",
            "switch",
            "cambiar",
          ],
          icon: DashboardSquare01Icon,
          tint: "text-sky-400",
          run: ctx.openConnections,
        }
      : null,
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

    // --- Navigation ---
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
