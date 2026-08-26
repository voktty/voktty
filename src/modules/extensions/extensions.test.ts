import { describe, expect, it, vi } from "vitest";
import {
  createVokttyApi,
  extensionAiTools,
  extensionCommands,
  extensionLanguages,
  extensionPanels,
} from "./lib/vokttyApi";
import { unloadExtension } from "./lib/extensionLoader";
import type { ActiveExtension, ExtensionContext, ExtensionInfo } from "./types";
import { resolveLanguage } from "@/modules/editor/lib/languageResolver";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exit_code: 0 }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("Extension System API & Disposables", () => {
  it("registers and disposes commands cleanly", async () => {
    const api = createVokttyApi();
    const handler = vi.fn().mockReturnValue("result-123");

    const disposable = api.commands.registerCommand("test.sampleCommand", handler);
    expect(extensionCommands.has("test.sampleCommand")).toBe(true);

    const result = await api.commands.executeCommand("test.sampleCommand", "arg1");
    expect(handler).toHaveBeenCalledWith("arg1");
    expect(result).toBe("result-123");

    disposable.dispose();
    expect(extensionCommands.has("test.sampleCommand")).toBe(false);

    await expect(api.commands.executeCommand("test.sampleCommand")).rejects.toThrow(
      /Command not found/,
    );
  });

  it("registers and disposes AI tools cleanly", () => {
    const api = createVokttyApi();
    const toolDef = {
      name: "custom_docker_ps",
      description: "Lists docker containers",
      execute: vi.fn(),
    };

    const disposable = api.ai.registerTool(toolDef);
    expect(extensionAiTools.get("custom_docker_ps")).toBe(toolDef);

    disposable.dispose();
    expect(extensionAiTools.has("custom_docker_ps")).toBe(false);
  });

  it("registers and disposes panels and languages cleanly", () => {
    const api = createVokttyApi();
    const panel = { id: "test.panel", title: "Test", mount: vi.fn() };
    const language = {
      id: "test-lang",
      name: "Test language",
      extensions: ["tlang"],
      load: vi.fn(async () => []),
    };

    const panelDisposable = api.window.registerPanel(panel);
    const languageDisposable = api.languages.registerLanguage(language);
    expect(extensionPanels.get(panel.id)).toBe(panel);
    expect(extensionLanguages.get(language.id)).toBe(language);

    panelDisposable.dispose();
    languageDisposable.dispose();
    expect(extensionPanels.has(panel.id)).toBe(false);
    expect(extensionLanguages.has(language.id)).toBe(false);
  });

  it("makes contributed languages available to the editor resolver", async () => {
    const api = createVokttyApi();
    const disposable = api.languages.registerLanguage({
      id: "test-resolver-lang",
      name: "Resolver language",
      extensions: ["resolverlang"],
      load: vi.fn(async () => []),
    });
    const resolved = await resolveLanguage("sample.resolverlang");
    expect(resolved?.id).toBe("test-resolver-lang");
    disposable.dispose();
  });

  it("does not reuse a disposed language contribution after reload", async () => {
    const api = createVokttyApi();
    const first = api.languages.registerLanguage({
      id: "reloadable-lang",
      name: "First language",
      extensions: ["reloadable"],
      load: vi.fn(async () => []),
    });
    expect((await resolveLanguage("sample.reloadable"))?.name).toBe("First language");
    first.dispose();

    const second = api.languages.registerLanguage({
      id: "reloadable-lang",
      name: "Second language",
      extensions: ["reloadable"],
      load: vi.fn(async () => []),
    });
    expect((await resolveLanguage("sample.reloadable"))?.name).toBe("Second language");
    second.dispose();
  });

  it("unloads extension cleanly and calls deactivate and all disposables", async () => {
    const disposeFn1 = vi.fn();
    const disposeFn2 = vi.fn();
    const deactivateFn = vi.fn();

    const mockContext: ExtensionContext = {
      subscriptions: [{ dispose: disposeFn1 }, { dispose: disposeFn2 }],
      extensionPath: "/path/to/ext",
      storagePath: "/path/to/ext",
    };

    const mockInfo: ExtensionInfo = {
      id: "test.ext",
      name: "ext",
      display_name: "Extension",
      version: "1.0.0",
      description: "Test extension",
      publisher: "test",
      main: "dist/index.js",
      entry_path: "/path/to/ext/dist/index.js",
      folder_path: "/path/to/ext",
      folder_name: "ext",
      contributes: {},
    };

    const activeInstance: ActiveExtension = {
      info: mockInfo,
      context: mockContext,
      module: { deactivate: deactivateFn },
      status: "active",
    };

    await unloadExtension(activeInstance);

    expect(deactivateFn).toHaveBeenCalled();
    expect(disposeFn1).toHaveBeenCalled();
    expect(disposeFn2).toHaveBeenCalled();
    expect(activeInstance.context.subscriptions.length).toBe(0);
    expect(activeInstance.status).toBe("disabled");
  });
});
