import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listExternalEditors, openInExternalEditor } from "./fs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("external editors client", () => {
  it("lists detected external editors via Tauri command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { id: "vscode", name: "Visual Studio Code" },
      { id: "zed", name: "Zed" },
    ]);

    const editors = await listExternalEditors();
    expect(invoke).toHaveBeenCalledWith("list_external_editors");
    expect(editors).toEqual([
      { id: "vscode", name: "Visual Studio Code" },
      { id: "zed", name: "Zed" },
    ]);
  });

  it("invokes open_in_external_editor with editorId and cwd", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await openInExternalEditor("cursor", "/work/project");
    expect(invoke).toHaveBeenCalledWith("open_in_external_editor", {
      editorId: "cursor",
      cwd: "/work/project",
    });
  });
});
