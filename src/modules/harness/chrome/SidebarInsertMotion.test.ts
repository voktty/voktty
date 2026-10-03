// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { SessionSummary } from "../lib/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
}));

vi.mock("../lib/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
  messageFilesFromClipboard: vi.fn().mockReturnValue(null),
}));

vi.mock("../hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => new Map(),
}));

vi.mock("../hooks/useInboxUnseen", () => ({
  useInboxUnseen: () => 0,
}));

vi.mock("./FileTree", () => ({
  FileTree: () => null,
}));

describe("sidebar new session rows", () => {
  let container: HTMLDivElement;
  let root: Root;

  const baseSession: SessionSummary = {
    id: "session-1",
    cwd: "C:/workspace/project",
    harness: "claude",
    model: "claude-3-7-sonnet",
    runtimeMode: "supervised",
    title: "Test Session",
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    providerSessionId: "harness-uuid-123",
  };

  let props: any;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      cwd: "C:/workspace/project",
      open: true,
      layout: "deck",
      status: "idle",
      pending: false,
      tab: "sessions",
      onTabChange: vi.fn(),
      filesSearchOpen: false,
      onFilesSearchOpenChange: vi.fn(),
      onOpenFile: vi.fn(),
      busySessionIds: new Set<string>(),
      approvalSessionIds: new Set<string>(),
      sessions: [baseSession],
      activeSessionId: "session-1",
      onSelectSession: vi.fn(),
      onNew: vi.fn(),
      onPinSession: vi.fn(),
      onRenameSession: vi.fn(),
      onArchiveSession: vi.fn(),
      onDeleteSession: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("grows in only for a session that arrives after the list has rendered", () => {
    const animate = vi
      .spyOn(HTMLElement.prototype, "animate")
      .mockImplementation(() => ({ cancel: vi.fn() }) as unknown as Animation);
    const animated = (property: string) =>
      animate.mock.calls.flatMap(([keyframes], index) =>
        property in (keyframes as Keyframe[])[0]
          ? [animate.mock.contexts[index] as HTMLElement]
          : [],
      );

    const render = () =>
      root.render(createElement(StrictMode, null, createElement(Sidebar, props)));
    act(() => render());
    expect(animate).not.toHaveBeenCalled();

    props = {
      ...props,
      sessions: [
        {
          ...props.sessions[0],
          id: "session-2",
          createdAt: Date.now(),
          updatedAt: props.sessions[0].updatedAt + 1,
        },
        ...props.sessions,
      ],
    };
    act(() => render());
    // The new card fades in where it lands; the row below slides down.
    expect(animated("opacity")).toHaveLength(1);
    expect(
      animated("opacity")[0].closest("li")?.querySelector(
        '[data-session-card="session-2"]',
      ),
    ).not.toBeNull();
    expect(animated("transform")).toHaveLength(1);
    expect(
      animated("transform")[0].querySelector('[data-session-card="session-1"]'),
    ).not.toBeNull();
    const calls = animate.mock.calls.length;

    props = {
      ...props,
      sessions: [
        { ...props.sessions[0], id: "session-old", createdAt: 1 },
        ...props.sessions,
      ],
    };
    act(() => render());
    expect(animate).toHaveBeenCalledTimes(calls);

    // Reordering existing rows must not replay their entrance.
    props = { ...props, sessions: [...props.sessions].reverse() };
    act(() => render());
    expect(animate).toHaveBeenCalledTimes(calls);
  });
});
