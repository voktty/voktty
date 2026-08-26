export interface Disposable {
  dispose: () => void;
}

export interface ExtensionCommandContrib {
  command: string;
  title: string;
  icon?: string;
}

export interface ExtensionKeybindingContrib {
  command: string;
  key: string;
  mac?: string;
  win?: string;
  linux?: string;
}

export interface ExtensionAiToolContrib {
  name: string;
  description: string;
}

export interface ExtensionPanelContrib {
  id: string;
  title: string;
  icon?: string;
}

export interface ExtensionLanguageContrib {
  id: string;
  name: string;
  extensions: string[];
}

export interface ExtensionContributes {
  commands?: ExtensionCommandContrib[];
  keybindings?: ExtensionKeybindingContrib[];
  aiTools?: ExtensionAiToolContrib[];
  agentTools?: ExtensionAiToolContrib[];
  panels?: ExtensionPanelContrib[];
  languages?: ExtensionLanguageContrib[];
}

export interface ExtensionInfo {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  publisher: string;
  icon?: string;
  main: string;
  entry_path: string;
  folder_path: string;
  folder_name: string;
  contributes: ExtensionContributes;
}

export interface ExtensionContext {
  subscriptions: Disposable[];
  extensionPath: string;
  storagePath: string;
}

export interface ExtensionAiToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => Promise<string | Record<string, unknown>>;
}

export interface ExtensionPanelDefinition {
  id: string;
  title: string;
  mount: (container: HTMLElement) => undefined | Disposable;
}

export interface ExtensionLanguageDefinition {
  id: string;
  name: string;
  extensions: string[];
  filenames?: string[];
  load: () => Promise<import("@codemirror/state").Extension>;
}

export interface VokttyCommandsApi {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
}

export interface VokttyAiApi {
  registerTool(tool: ExtensionAiToolDefinition): Disposable;
}

export interface VokttyWindowApi {
  showInformationMessage(message: string): void;
  showWarningMessage(message: string): void;
  showErrorMessage(message: string): void;
  registerPanel(panel: ExtensionPanelDefinition): Disposable;
}

export interface VokttyLanguagesApi {
  registerLanguage(language: ExtensionLanguageDefinition): Disposable;
}

export interface VokttyTerminalApi {
  execute(command: string): Promise<string>;
}

export interface VokttyWorkspaceApi {
  getRootPath(): string | null;
}

export interface VokttyApi {
  commands: VokttyCommandsApi;
  ai: VokttyAiApi;
  window: VokttyWindowApi;
  terminal: VokttyTerminalApi;
  workspace: VokttyWorkspaceApi;
  languages: VokttyLanguagesApi;
}

export interface ExtensionModule {
  activate?: (context: ExtensionContext, vokttyApi?: VokttyApi) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export interface ActiveExtension {
  info: ExtensionInfo;
  context: ExtensionContext;
  module: ExtensionModule;
  status: "active" | "error" | "disabled";
  error?: string;
}
