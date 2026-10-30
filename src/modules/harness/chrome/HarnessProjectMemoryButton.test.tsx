// @vitest-environment happy-dom
import { act, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HarnessProjectMemoryButton } from "@/modules/harness/chrome/HarnessProjectMemoryButton";
import { HarnessProjectOwner } from "@/modules/harness/hooks/useHarnessProjectSelection";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { HarnessWindowContext } from "@/modules/harness/components/HarnessWindowHost";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { createHarnessMemorySessions } from "@/modules/harness/lib/harnessMemorySessions";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import { createHarnessProjectReservations } from "@/modules/harness/lib/harnessProjectReservations";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { newTab } from "@/modules/harness/lib/layout";
import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";

const { captured } = vi.hoisted(() => ({
  captured: {
    target: null as MemoryPanelTarget | null,
    captureConversation: null as
      | (() => MemoryConversationCapture | null)
      | null,
  },
}));
vi.mock("@/modules/workspace-kit/components/ProjectMemoryButton", () => ({
  ProjectMemoryButton: ({
    target,
    captureConversation,
  }: {
    target: MemoryPanelTarget | null;
    captureConversation?: () => MemoryConversationCapture | null;
  }) => {
    captured.target = target;
    captured.captureConversation = captureConversation ?? null;
    return null;
  },
}));
vi.mock("@/modules/harness/lib/harnessEnvStore", () => ({
  useHarnessProjectEnvStore: Object.assign(
    (select: (state: unknown) => unknown) => select({ projects: [] }),
    {
      getState: () => ({ projects: [] }),
      subscribe: () => () => undefined,
    },
  ),
  harnessProjectEnvironmentFor: () => ({
    env: { kind: "local" },
    connecting: false,
    error: null,
  }),
}));
afterEach(() => {
  publishActiveSurface(null);
  vi.unstubAllGlobals();
});

it("captures the registered conversation by gesture using its worktree and retires on source departure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const manager = createHarnessMemorySessions();
  const session = manager.capture({}, "/harness", "/worktree", () => true);
  const captureMemorySession = vi.fn(() => session);
  const views = createHarnessWindowViews();
  const holds = createHarnessWindowSessionHolds();
  const projects = createHarnessProjectReservations();
  const tab = newTab("conversation");
  views.register(20, {
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: "/harness",
    projectTerminals: [],
    projectReturnMemory: new Map(),
    report: {
      referencedSessionIds: ["conversation"],
      foregroundSessionIds: ["conversation"],
      activeSessionId: "conversation",
    },
  });
  views.select(20);
  const surface = {
    kind: "harness" as const,
    ownerId: 20,
    projectCwd: "/harness",
    focusFolder: "/harness/browsed",
  };
  publishActiveSurface(surface);
  try {
    await act(async () =>
      root.render(
        <HarnessWindowContext
          value={
            {
              engine: { captureMemorySession },
              views,
              holds,
              projects,
            } as unknown as NonNullable<
              ContextType<typeof HarnessWindowContext>
            >
          }
        >
          <HarnessProjectOwner
            value={{ ownerId: 20, tabKey: asTabKey("harness-key") }}
          >
            <HarnessProjectMemoryButton cwd="/harness" />
          </HarnessProjectOwner>
        </HarnessWindowContext>,
      ),
    );
    expect(captureMemorySession).not.toHaveBeenCalled();
    const capture = captured.captureConversation?.();
    if (!capture) throw new Error("Missing conversation capture");
    expect(captureMemorySession).toHaveBeenCalledWith("conversation");
    expect(capture.conversation.cwd).toBe("/worktree");
    expect(captured.target?.path).toBe("/harness/browsed");
    await act(async () => publishActiveSurface(null));
    await act(async () => publishActiveSurface(surface));
    expect(capture.conversation.isCurrent()).toBe(false);
    expect(session.status()).toBe("inactive");
    capture.release();
    const held = captured.captureConversation?.();
    if (!held) throw new Error("Missing capture before hold");
    const hold = holds.acquire("switching", ["conversation"], () => true);
    if (!hold) throw new Error("Missing hold");
    hold.release();
    expect(held.conversation.isCurrent()).toBe(false);
    const reserved = captured.captureConversation?.();
    if (!reserved) throw new Error("Missing capture before reservation");
    const owner = createPersistenceAdmission().createOwner();
    const permit = owner.capture();
    if (!permit) throw new Error("Missing permit");
    const reservation = projects.reserve("/harness", permit);
    if (!reservation) throw new Error("Missing reservation");
    reservation.release();
    owner.retire();
    expect(reserved.conversation.isCurrent()).toBe(false);
  } finally {
    await act(async () => root.unmount());
    manager.dispose();
    await session.close();
  }
});

it("uses its own active Harness folder and withdraws the target when another view becomes active", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const render = () => (
    <HarnessProjectOwner
      value={{ ownerId: 20, tabKey: asTabKey("harness-key") }}
    >
      <HarnessProjectMemoryButton cwd="/harness" />
    </HarnessProjectOwner>
  );
  publishActiveSurface({
    kind: "harness",
    ownerId: 20,
    projectCwd: "/harness",
    focusFolder: "/harness/subfolder",
  });
  await act(async () => root.render(render()));
  expect(captured.target).toEqual({
    path: "/harness/subfolder",
    environment: { kind: "local" },
    source: "harness:20:harness-key",
  });
  await act(async () =>
    publishActiveSurface({
      kind: "terminal",
      ownerId: 2,
      cwd: "/other-terminal",
    }),
  );
  expect(captured.target).toBeNull();
  await act(async () =>
    publishActiveSurface({
      kind: "harness",
      ownerId: 30,
      projectCwd: "/other-view",
      focusFolder: "/other-view/sub",
    }),
  );
  expect(captured.target).toBeNull();
  await act(async () =>
    publishActiveSurface({
      kind: "harness",
      ownerId: 999,
      projectCwd: "/harness",
      focusFolder: "/harness/foreign",
    }),
  );
  await act(async () =>
    root.render(<HarnessProjectMemoryButton cwd="/harness" />),
  );
  expect(captured.target?.path).toBe("/harness");
  await act(async () => root.unmount());
  node.remove();
});
