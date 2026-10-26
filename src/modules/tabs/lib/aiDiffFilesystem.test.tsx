// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTabs } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));

it("keeps the approval's filesystem and source space when the caller changes before React commits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  let current: ReturnType<typeof useTabs> | undefined;
  function Host() {
    current = useTabs();
    return null;
  }
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    if (!current) throw new Error("Hook did not mount");
    const tabs = current;
    const workspace: WorkspaceEnv = {
      kind: "ssh",
      root: "/fixture",
      sessionId: 7,
      connection: { id: "fixture", name: "Fixture", host: "fixture.invalid" },
    };
    const input = {
      path: "/fixture/file.ts",
      originalContent: "old",
      proposedContent: "new",
      approvalId: "fixture-approval",
      isNewFile: false,
      workspaceEnv: workspace,
    };
    await act(async () => {
      tabs.setActiveSpaceForNewTabs("original-space");
      tabs.openAiDiffTab(input);
      workspace.connection.host = "replacement.invalid";
      workspace.sessionId = 8;
      input.path = "/replacement/file.ts";
      tabs.setActiveSpaceForNewTabs("replacement-space");
    });
    const diff = current?.tabs.find((tab) => tab.kind === "ai-diff");
    expect(diff).toMatchObject({
      kind: "ai-diff",
      path: "/fixture/file.ts",
      spaceId: "original-space",
      workspaceEnv: {
        kind: "ssh",
        sessionId: 7,
        connection: { host: "fixture.invalid" },
      },
    });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
