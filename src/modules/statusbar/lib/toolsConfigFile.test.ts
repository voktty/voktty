import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROJECT_TOOLS,
  getGlobalToolsFilePath,
  loadToolsConfigFile,
} from "./toolsConfigFile";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: any) => {
    if (cmd === "fs_read_file") {
      if (args.path?.includes("custom-tools.json")) {
        return {
          kind: "text",
          content: JSON.stringify({
            tools: [
              {
                id: "custom-1",
                name: "Custom Tool",
                command: "echo custom",
                description: "A custom test tool",
                category: "custom",
              },
            ],
          }),
        };
      }
      return { kind: "error" };
    }
    if (cmd === "fs_stat") {
      return {};
    }
    return {};
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: vi.fn(async () => "/home/user/.config/voktty"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

describe("toolsConfigFile", () => {
  it("resolves global tools file path correctly", async () => {
    const path = await getGlobalToolsFilePath();
    expect(path).toBe("/home/user/.config/voktty/project-tools.json");
  });

  it("returns default tools when file cannot be read", async () => {
    const tools = await loadToolsConfigFile(null);
    expect(tools).toEqual(DEFAULT_PROJECT_TOOLS);
    expect(tools.some((t) => t.id === "ag-kit-install")).toBe(true);
    expect(tools.some((t) => t.id === "uipro-install")).toBe(true);
  });

  it("includes correct install commands and init commands for ag-kit and uipro", () => {
    const agKitInstall = DEFAULT_PROJECT_TOOLS.find(
      (t) => t.id === "ag-kit-install",
    );
    expect(agKitInstall?.command).toBe("npm install -g @vudovn/ag-kit");

    const agKitInit = DEFAULT_PROJECT_TOOLS.find((t) => t.id === "ag-kit-init");
    expect(agKitInit?.command).toBe("ag-kit init");

    const uiproInstall = DEFAULT_PROJECT_TOOLS.find(
      (t) => t.id === "uipro-install",
    );
    expect(uiproInstall?.command).toBe("npm install -g uipro-cli");

    const uiproInit = DEFAULT_PROJECT_TOOLS.find(
      (t) => t.id === "uipro-init-gemini",
    );
    expect(uiproInit?.command).toBe("uipro init --ai gemini");

    const eccUniversal = DEFAULT_PROJECT_TOOLS.find(
      (t) => t.id === "ecc-universal-install",
    );
    expect(eccUniversal?.command).toBe("npx ecc-universal install --guided");
    expect(eccUniversal?.recommended).toBe(true);
  });
});
