import { useSpaces } from "@/modules/spaces";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  Disposable,
  ExtensionAiToolDefinition,
  ExtensionLanguageDefinition,
  ExtensionPanelDefinition,
  VokttyApi,
} from "../types";

export const extensionCommands = new Map<
  string,
  (...args: unknown[]) => unknown
>();

export const extensionAiTools = new Map<
  string,
  ExtensionAiToolDefinition
>();

export const extensionPanels = new Map<string, ExtensionPanelDefinition>();
export const extensionLanguages = new Map<string, ExtensionLanguageDefinition>();

function registerUnique<T>(registry: Map<string, T>, id: string, value: T): Disposable {
  if (!id.trim() || registry.has(id)) throw new Error(`Duplicate extension contribution: ${id}`);
  registry.set(id, value);
  return { dispose: () => { if (registry.get(id) === value) registry.delete(id); } };
}

interface CommandOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export function createVokttyApi(): VokttyApi {
  return {
    commands: {
      registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        extensionCommands.set(id, handler);
        return {
          dispose: () => {
            if (extensionCommands.get(id) === handler) {
              extensionCommands.delete(id);
            }
          },
        };
      },
      async executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
        const handler = extensionCommands.get(id);
        if (handler) {
          return handler(...args);
        }
        throw new Error(`Command not found: ${id}`);
      },
    },
    ai: {
      registerTool(tool: ExtensionAiToolDefinition): Disposable {
        return registerUnique(extensionAiTools, tool.name, tool);
      },
    },
    window: {
      showInformationMessage(message: string): void {
        toast(message);
      },
      showWarningMessage(message: string): void {
        toast.warning(message);
      },
      showErrorMessage(message: string): void {
        toast.error(message);
      },
      registerPanel(panel: ExtensionPanelDefinition): Disposable {
        return registerUnique(extensionPanels, panel.id, panel);
      },
    },
    terminal: {
      async execute(command: string): Promise<string> {
        const activeId = useSpaces.getState().activeId;
        const root = activeId
          ? useSpaces.getState().spaces.find((s) => s.id === activeId)?.root ?? null
          : null;

        const out = await invoke<CommandOutput>("shell_run_command", {
          command,
          cwd: root,
          timeoutSecs: 30,
        });

        if (out.exit_code !== 0) {
          throw new Error(out.stderr || out.stdout || `Command failed with code ${out.exit_code}`);
        }
        return out.stdout;
      },
    },
    workspace: {
      getRootPath(): string | null {
        const activeId = useSpaces.getState().activeId;
        return activeId
          ? useSpaces.getState().spaces.find((s) => s.id === activeId)?.root ?? null
          : null;
      },
    },
    languages: {
      registerLanguage(language: ExtensionLanguageDefinition): Disposable {
        if (!language.extensions.length && !language.filenames?.length) {
          throw new Error(`Language contribution has no filename matcher: ${language.id}`);
        }
        return registerUnique(extensionLanguages, language.id, language);
      },
    },
  };
}
