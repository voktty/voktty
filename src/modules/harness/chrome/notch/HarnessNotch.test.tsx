// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessNotch } from "../HarnessNotch";
import { useNotchStore } from "../../lib/notchStore";
import { saveHarnessNotchEnabled } from "../../lib/settings";
import type { LiveAgent } from "../../lib/liveAgents";
import type { Session } from "../../lib/session";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && Object.keys(params).length > 0) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
  }),
}));

vi.mock("@/modules/harness/lib/recents", () => ({
  loadRecents: () => [
    { path: "/projects/alpha", openedAt: 1000 },
    { path: "/projects/beta", openedAt: 2000 },
  ],
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  saveHarnessNotchEnabled(true);
  useNotchStore.setState({
    expanded: false,
    activeAgentId: null,
    idleLauncherOpen: false,
    liveAgents: [],
    sessions: [],
    onApproval: null,
    onSubmit: null,
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("HarnessNotch", () => {
  it("renders nothing when notch is disabled in settings", () => {
    saveHarnessNotchEnabled(false);

    act(() => {
      root.render(createElement(HarnessNotch));
    });

    expect(container.innerHTML).toBe("");
  });

  it("renders top hover zone when idle and notch is enabled", () => {
    act(() => {
      root.render(createElement(HarnessNotch));
    });

    expect(container.innerHTML).toContain("fixed top-0 left-1/2");
    expect(container.textContent).toContain("harness.notch.idle");
  });

  it("renders active agent mascot, project name, and elapsed time when agent is running", () => {
    const mockAgent: LiveAgent = {
      id: "agent-1",
      cwd: "/projects/voktty",
      title: "voktty",
      harness: "codex",
      activity: "bash",
      startedAt: Date.now() - 42_000,
      needsApproval: false,
      done: false,
    };

    act(() => {
      useNotchStore.getState().syncHarnessState({
        liveAgents: [mockAgent],
        sessions: [],
      });
      root.render(createElement(HarnessNotch));
    });

    expect(container.textContent).toContain("voktty");
    expect(container.textContent).toContain("42s");
    expect(container.innerHTML).toContain("svg");
  });

  it("renders multi-project mascot avatars when multiple agents are running", () => {
    const agent1: LiveAgent = {
      id: "agent-1",
      cwd: "/projects/voktty",
      title: "voktty",
      harness: "codex",
      activity: "read_file",
      startedAt: Date.now() - 15_000,
      needsApproval: false,
      done: false,
    };
    const agent2: LiveAgent = {
      id: "agent-2",
      cwd: "/projects/backend",
      title: "backend",
      harness: "codex",
      activity: "run_command",
      startedAt: Date.now() - 5_000,
      needsApproval: true,
      done: false,
    };

    act(() => {
      useNotchStore.getState().syncHarnessState({
        liveAgents: [agent1, agent2],
        sessions: [],
      });
      root.render(createElement(HarnessNotch));
    });

    expect(container.textContent).toContain("voktty");
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(1);
  });

  it("shows expanded card with diff stats and approval actions when expanded", () => {
    const mockAgent: LiveAgent = {
      id: "agent-1",
      cwd: "/projects/voktty",
      title: "voktty",
      harness: "codex",
      activity: "run_command",
      startedAt: Date.now() - 10_000,
      needsApproval: true,
      done: false,
    };

    const mockSession: Session = {
      id: "agent-1",
      cwd: "/projects/voktty",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      harness: "codex",
      model: "gpt-4o",
      status: "running",
      busy: true,
      blocks: [
        {
          id: "turn-1",
          role: "tool",
          timestamp: Date.now(),
          tool: {
            callId: "call-1",
            title: "pnpm test",
            preview: {
              lines: [
                { kind: "add", text: "line 1 added", number: 1 },
                { kind: "del", text: "line 2 removed", number: 2 },
              ],
            },
          },
          approval: {
            requestId: 101,
          },
        },
      ],
    } as unknown as Session;

    const onApprovalMock = vi.fn();

    act(() => {
      useNotchStore.getState().syncHarnessState({
        liveAgents: [mockAgent],
        sessions: [mockSession],
        onApproval: onApprovalMock,
      });
      useNotchStore.getState().setExpanded(true);
      root.render(createElement(HarnessNotch));
    });

    expect(container.textContent).toContain("line 1 added");
    expect(container.textContent).toContain("line 2 removed");
    expect(container.textContent).toContain("pnpm test");
    expect(container.textContent).toContain("harness.notch.allow");
    expect(container.textContent).toContain("harness.notch.deny");

    // Click allow
    const buttons = container.querySelectorAll("button");
    const allowBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("harness.notch.allow"),
    );
    expect(allowBtn).toBeDefined();
    act(() => {
      allowBtn?.click();
    });

    expect(onApprovalMock).toHaveBeenCalledWith("agent-1", 101, "allow");
  });

  it("opens inactive project when clicked from launcher", () => {
    const onOpenProjectMock = vi.fn();

    act(() => {
      useNotchStore.getState().setIdleLauncherOpen(true);
      root.render(createElement(HarnessNotch, { onOpenProject: onOpenProjectMock }));
    });

    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("beta");

    const alphaItem = Array.from(container.querySelectorAll("button")).find((el) =>
      el.textContent?.includes("alpha"),
    );
    expect(alphaItem).toBeDefined();

    act(() => {
      alphaItem?.click();
    });

    expect(onOpenProjectMock).toHaveBeenCalledWith("/projects/alpha");
  });
});
