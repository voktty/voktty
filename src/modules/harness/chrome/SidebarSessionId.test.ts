import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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

describe("Sidebar session card rendering", () => {
  const baseSession: SessionSummary = {
    id: "session-1",
    cwd: "/test/repo",
    harness: "claude",
    model: "claude-3-7-sonnet",
    runtimeMode: "supervised",
    title: "Test Session",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    providerSessionId: "harness-uuid-123",
  };

  it("renders the session card with data attribute for contextual actions", () => {
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        cwd: "/test/repo",
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
      }),
    );

    expect(markup).toContain('data-session-card="session-1"');
    expect(markup).toContain("Test Session");
  });
});
