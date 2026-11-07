// @vitest-environment happy-dom

import { hydrateTabs, serializeTabs } from "@/modules/spaces/lib/serialize";
import { safeWorkspaceEnv } from "@/modules/spaces/lib/sessionSnapshot";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { useTabs } from "@/modules/tabs/lib/useTabs";
import type { DockerWorkspaceConnection } from "@/modules/workspace/env";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("docker tab qualification in matrix H7", () => {
  const sampleDockerConnection: DockerWorkspaceConnection = {
    containerId: "d12345678901",
    containerName: "api-backend",
    image: "node:22-alpine",
    shell: "/bin/sh",
    workdir: "/usr/src/app",
  };

  it("creates a canonical terminal tab targeting docker container", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let tabs: ReturnType<typeof useTabs> | undefined;
    function Host() {
      tabs = useTabs();
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<Host />));
      if (!tabs) throw new Error("Missing tabs hook");

      let created: { tabId: number; leafId: number } | undefined;
      await act(async () => {
        created = tabs?.newDockerTab(sampleDockerConnection);
      });

      expect(created).toBeDefined();
      if (!created) throw new Error("Missing created docker tab");
      const createdTabId = created.tabId;
      const tab = tabs.getTab(createdTabId);
      expect(tab).toBeDefined();
      if (tab?.kind !== "terminal") throw new Error("Expected terminal tab");
      expect(tab.title).toBe("🐳 api-backend");
      expect(tab.customTitle).toBe("🐳 api-backend");
      expect(tab.cwd).toBe("/usr/src/app");
      expect(tab.workspaceEnv).toEqual({
        kind: "docker",
        connection: sampleDockerConnection,
      });
      expect(tabs.activeId).toBe(createdTabId);

      // Duplicate tab inherits the docker workspaceEnv
      let duplicateId: number | null = null;
      await act(async () => {
        duplicateId = tabs?.duplicateTab(createdTabId) ?? null;
      });
      expect(duplicateId).not.toBeNull();
      if (duplicateId === null) throw new Error("Missing duplicate tab");
      const duplicateTab = tabs.getTab(duplicateId);
      if (duplicateTab?.kind !== "terminal")
        throw new Error("Expected duplicate terminal tab");
      expect(duplicateTab.workspaceEnv).toEqual({
        kind: "docker",
        connection: sampleDockerConnection,
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("serializes and hydrates docker terminal tabs across sessions", () => {
    let idCounter = 200;
    const allocId = () => idCounter++;

    const serialized = serializeTabs([
      {
        id: 1,
        ...createTabIdentity("main"),
        spaceId: "main",
        kind: "terminal",
        title: "🐳 api-backend",
        customTitle: "🐳 api-backend",
        cwd: "/usr/src/app",
        paneTree: { kind: "leaf", id: 2, cwd: "/usr/src/app" },
        activeLeafId: 2,
        workspaceEnv: {
          kind: "docker",
          connection: sampleDockerConnection,
        },
      },
    ]);

    expect(serialized).toHaveLength(1);
    expect(serialized[0]).toMatchObject({
      kind: "terminal",
      customTitle: "🐳 api-backend",
      workspaceEnv: {
        kind: "docker",
        connection: sampleDockerConnection,
      },
    });

    const [hydrated] = hydrateTabs(serialized, "main", allocId);
    expect(hydrated).toBeDefined();
    if (hydrated?.kind !== "terminal")
      throw new Error("Expected hydrated terminal tab");
    expect(hydrated.workspaceEnv).toEqual({
      kind: "docker",
      connection: sampleDockerConnection,
    });
    expect(hydrated.customTitle).toBe("🐳 api-backend");
  });

  it("safeWorkspaceEnv maintains docker connection and falls back if malformed", () => {
    expect(
      safeWorkspaceEnv({
        kind: "docker",
        connection: sampleDockerConnection,
      }),
    ).toEqual({
      kind: "docker",
      connection: sampleDockerConnection,
    });

    // Malformed docker env without connection falls back to local safely
    expect(safeWorkspaceEnv({ kind: "docker" })).toEqual({ kind: "local" });
  });
});
