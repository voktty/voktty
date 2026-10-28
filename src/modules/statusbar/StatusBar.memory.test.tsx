// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StatusBar } from "@/modules/statusbar/StatusBar";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import { asTabKey, asWorkspaceScopeId } from "@/modules/tabs/lib/tabIdentity";

const { captured } = vi.hoisted(() => ({
  captured: { target: null as MemoryPanelTarget | null },
}));
vi.mock("@/modules/workspace-kit/components/ProjectMemoryButton", () => ({
  ProjectMemoryButton: ({ target }: { target: MemoryPanelTarget | null }) => {
    captured.target = target;
    return null;
  },
}));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/ai", () => ({
  useChatStore: (select: (state: unknown) => unknown) =>
    select({
      panelOpen: false,
      mini: { open: false, collapsed: false },
      unreadCount: 0,
    }),
}));
vi.mock("@/modules/ai/components/AgentStatusPill", () => ({
  AgentStatusPill: () => null,
}));
vi.mock("@/modules/ai/components/AiStatusBarControls", () => ({
  AiOpenButton: () => null,
}));
vi.mock("@/modules/header", () => ({ SearchInline: () => null }));
vi.mock("@/modules/docker", () => ({ DockerControlPill: () => null }));
vi.mock("@/modules/lsp", () => ({ LspStatusPill: () => null }));
vi.mock("@/modules/preview", () => ({ DevServerPill: () => null }));
vi.mock("@/modules/serial", () => ({ SerialControlPill: () => null }));
vi.mock("@/modules/statusbar/CwdBreadcrumb", () => ({
  CwdBreadcrumb: () => null,
}));
vi.mock("@/modules/statusbar/DiagnosticsBadge", () => ({
  DiagnosticsBadge: () => null,
}));
vi.mock("@/modules/statusbar/EditorStatus", () => ({
  EditorStatus: () => null,
}));
vi.mock("@/modules/statusbar/WorkspaceEnvSelector", () => ({
  WorkspaceEnvSelector: () => null,
}));
vi.mock("@/modules/statusbar/components/ConsoleUptimeWidget", () => ({
  ConsoleUptimeWidget: () => null,
}));
vi.mock("@/modules/statusbar/components/ProjectToolkitPopover", () => ({
  ProjectToolkitPopover: () => null,
}));

it("uses the active leaf directory and environment instead of the toolkit or an ambient project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const noop = () => {};
  const props: Parameters<typeof StatusBar>[0] = {
    cwd: "/leaf/directory",
    activeWorkspaceEnv: { kind: "wsl", distro: "owned" },
    activeLeafId: 7,
    toolkitTarget: { path: "/other/project", workspace: { kind: "local" } },
    toolkitSourceKey: "terminal-key",
    tabs: [
      {
        id: 1,
        kind: "terminal",
        title: "Terminal",
        tabKey: asTabKey("terminal-key"),
        workspaceScopeId: asWorkspaceScopeId("scope"),
        spaceId: "default",
        activeLeafId: 7,
        paneTree: { kind: "leaf", id: 7 },
      },
    ],
    onCd: noop,
    onWorkspaceChange: noop,
    onToggleAi: noop,
    onOpenAi: noop,
    onOpenSettings: noop,
    onOpenDevServer: noop,
    searchTarget: null,
    searchRef: createRef(),
    hasComposer: false,
    privateActive: false,
  };
  await act(async () => root.render(<StatusBar {...props} />));
  expect(captured.target).toEqual({
    path: "/leaf/directory",
    environment: { kind: "wsl", distro: "owned" },
    source: "terminal:terminal-key:7",
  });
  await act(async () =>
    root.render(<StatusBar {...props} toolkitTarget={null} />),
  );
  expect(captured.target).toBeNull();
  await act(async () =>
    root.render(<StatusBar {...props} toolkitSourceKey="another-resource" />),
  );
  expect(captured.target).toBeNull();
  await act(async () =>
    root.render(<StatusBar {...props} activeLeafId={undefined} />),
  );
  expect(captured.target).toBeNull();
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
