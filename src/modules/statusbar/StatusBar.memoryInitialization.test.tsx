// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StatusBar } from "@/modules/statusbar/StatusBar";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";
import { useHarnessProjectEnvStore } from "@/modules/harness/lib/harnessEnvStore";
import { asTabKey, asWorkspaceScopeId } from "@/modules/tabs/lib/tabIdentity";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  request: vi.fn(),
  acquire: vi.fn(),
  snapshot: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: {
    acquire: io.acquire,
    snapshot: io.snapshot,
    subscribe: () => () => {},
  },
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemote: io.request,
}));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
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

const project = "/owned/project";
const profile = {
  id: "memory-fixture",
  name: "Fixture",
  host: "fixture.invalid",
  port: 22,
};
const handle = { id: 1, token: "00000000-0000-4000-8000-000000000001" };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  useHarnessProjectEnvStore.setState({ projects: {} });
  const reply = (operation: string) => {
    if (operation === "open") return handle;
    if (operation === "select") return "selection";
    if (operation === "inspect")
      return {
        schema: 1,
        root: null,
        blockedCount: 0,
        scope: { schema: 1, state: "absent", ancestryComplete: true },
      };
    if (operation === "preview")
      return {
        schema: 1,
        root: project,
        revision: 1,
        review: "review-token",
        isResuming: false,
        recoveryFiles: [],
        publicationBlocker: null,
        deployment: {
          canPublish: true,
          lock: null,
          entries: [
            {
              path: ".voktty/INIT.md",
              action: "create",
              reason: "missing",
              expected: null,
              proposed: "Guide\n",
            },
          ],
        },
      };
    if (operation === "confirm")
      return {
        schema: 1,
        created: [".voktty/INIT.md"],
        skipped: [],
        migrated: [],
        cleaned: [],
      };
    return null;
  };
  const nativeOperations: Record<string, string> = {
    project_memory_open: "open",
    project_memory_select: "select",
    project_memory_discover: "inspect",
    project_memory_preview: "preview",
    project_memory_confirm_preview: "confirm",
  };
  io.invoke.mockImplementation(async (command: string) =>
    reply(nativeOperations[command]),
  );
  io.close.mockResolvedValue(undefined);
  io.acquire.mockImplementation(async (key) => {
    io.snapshot.mockReturnValue([{ key, sessionId: 62, closing: false }]);
    return {
      info: {
        session_id: 62,
        workspace_root: "/owned",
        capabilities: ["memory.manage"],
      },
      release: () => {},
      releaseAndClose: io.close,
    };
  });
  io.request.mockImplementation(async (_session, request) => ({
    protocol: 2,
    id: request.id,
    ok: true,
    result: { schema: 1, ok: true, result: reply(request.params.operation) },
  }));
});
afterEach(() => {
  publishActiveSurface(null);
  useHarnessProjectEnvStore.setState({ projects: {} });
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "initializes from the foreground Harness without a conversation or background terminal (SSH=%s)",
  async (remote) => {
    if (remote)
      useHarnessProjectEnvStore.setState({
        projects: {
          [project]: {
            identity: {
              projectId: project,
              profileId: profile.id,
              requestedRoot: "/owned",
              resolvedRoot: "/owned",
              automatic: false,
            },
            env: {
              kind: "ssh",
              connection: profile,
              root: "/owned",
              sessionId: 61,
            },
            connecting: false,
            error: null,
          },
        },
      });
    publishActiveSurface({
      kind: "harness",
      ownerId: 20,
      projectCwd: project,
      focusFolder: project,
    });
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const noop = () => {};
    const props: Parameters<typeof StatusBar>[0] = {
      cwd: "/background-terminal",
      activeWorkspaceEnv: { kind: "local" },
      toolkitTarget: null,
      toolkitSourceKey: "harness-memory",
      tabs: [
        {
          id: 20,
          kind: "harness",
          title: "Harness",
          cwd: project,
          tabKey: asTabKey("harness-memory"),
          workspaceScopeId: asWorkspaceScopeId("scope"),
          spaceId: "default",
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
    function button(label: string) {
      const found = [...document.querySelectorAll("button")].find(
        (item) =>
          item.getAttribute("aria-label") === label ||
          item.textContent === label,
      );
      if (!found) throw new Error(`Missing button: ${label}`);
      return found;
    }
    try {
      await act(async () => root.render(<StatusBar {...props} />));
      await act(async () => {
        button("projectMemory.title").click();
        await import("@/modules/workspace-kit/components/ProjectMemoryPanel");
      });
      await act(async () => button("projectMemory.initialize").click());
      if (remote) {
        expect(
          io.invoke.mock.calls.some(([command]) =>
            command.startsWith("project_memory_"),
          ),
        ).toBe(false);
        expect(io.request.mock.calls.every(([id]) => id === 62)).toBe(true);
        expect(
          io.request.mock.calls.some(
            ([, request]) =>
              request.params.operation === "select" &&
              request.params.path === project,
          ),
        ).toBe(true);
        expect(
          io.request.mock.calls.some(
            ([, request]) =>
              request.params.operation === "preview" &&
              request.params.links.agents &&
              request.params.links.claude,
          ),
        ).toBe(true);
        expect(
          io.request.mock.calls.some(
            ([, request]) => request.params.operation === "confirm",
          ),
        ).toBe(true);
      } else {
        expect(io.invoke).toHaveBeenCalledWith(
          "project_memory_select",
          expect.objectContaining({
            path: project,
            environment: { kind: "local" },
          }),
        );
        expect(io.invoke).toHaveBeenCalledWith(
          "project_memory_preview",
          expect.objectContaining({
            request: expect.objectContaining({
              destination: project,
              links: { agents: true, claude: true },
            }),
          }),
        );
        expect(io.invoke).toHaveBeenCalledWith(
          "project_memory_confirm_preview",
          expect.anything(),
        );
        expect(io.acquire).not.toHaveBeenCalled();
      }
    } finally {
      await act(async () => root.unmount());
      node.remove();
    }
  },
);
