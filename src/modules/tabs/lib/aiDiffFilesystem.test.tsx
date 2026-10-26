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

async function withTabs(
  run: (read: () => ReturnType<typeof useTabs>) => Promise<void>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof useTabs>;
  function Host() {
    current = useTabs();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Host)));
    await run(() => current);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
}

const review = {
  path: "/fixture/file.ts",
  originalContent: "old",
  proposedContent: "new",
  approvalId: "shared-approval",
  isNewFile: false,
};

it("keeps reviews with the same provider approval ID separate across chats", async () => {
  await withTabs(async (read) => {
    await act(async () =>
      read().openAiDiffTab({ ...review, approvalSessionId: "first" }),
    );
    await act(async () =>
      read().openAiDiffTab({ ...review, approvalSessionId: "second" }),
    );
    const diffs = read().tabs.filter((tab) => tab.kind === "ai-diff");
    expect(diffs.map((tab) => tab.approvalSessionId)).toEqual([
      "first",
      "second",
    ]);
    await act(async () =>
      read().openAiDiffTab({ ...review, approvalSessionId: "first" }),
    );
    expect(read().tabs.filter((tab) => tab.kind === "ai-diff")).toEqual(diffs);
  });
});

it("keeps legacy unqualified reviews separate from session-owned reviews", async () => {
  await withTabs(async (read) => {
    await act(async () => read().openAiDiffTab(review));
    await act(async () =>
      read().openAiDiffTab({ ...review, approvalSessionId: "chat" }),
    );
    expect(read().tabs.filter((tab) => tab.kind === "ai-diff")).toHaveLength(2);
  });
});

it("changes status and closes only the original chat's review", async () => {
  await withTabs(async (read) => {
    await act(async () =>
      read().openAiDiffTab({ ...review, approvalSessionId: "first" }),
    );
    await act(async () =>
      read().openAiDiffTab({ ...review, approvalSessionId: "second" }),
    );
    const second = read().tabs.find(
      (tab) => tab.kind === "ai-diff" && tab.approvalSessionId === "second",
    );
    expect(second).toBeDefined();
    if (!second) throw new Error("Second review did not open");
    await act(async () => read().setActiveId(second.id));
    await act(async () =>
      read().setAiDiffStatus(review.approvalId, "rejected", "first"),
    );
    expect(
      read().tabs.find(
        (tab) => tab.kind === "ai-diff" && tab.approvalSessionId === "first",
      ),
    ).toMatchObject({ status: "rejected" });
    expect(read().tabs.find((tab) => tab.id === second?.id)).toBe(second);
    await act(async () =>
      read().closeAiDiffTab(review.approvalId, "first", "rejected"),
    );
    expect(read().tabs.filter((tab) => tab.kind === "ai-diff")).toEqual([
      second,
    ]);
    expect(read().activeId).toBe(second?.id);
    await act(async () => {
      read().closeAiDiffTab(review.approvalId, "first", "approved");
      read().closeAiDiffTab(review.approvalId, undefined, "approved");
      read().setAiDiffStatus(review.approvalId, "approved", undefined);
    });
    expect(read().tabs.filter((tab) => tab.kind === "ai-diff")).toEqual([
      second,
    ]);
  });
});

it.each(["approved", "rejected"] as const)(
  "retains the correct %s status when the original review is alone in its space",
  async (status) => {
    await withTabs(async (read) => {
      await act(async () => {
        read().setActiveSpaceForNewTabs("review-space");
        read().openAiDiffTab({ ...review, approvalSessionId: "first" });
      });
      await act(async () => {
        read().setActiveSpaceForNewTabs("other-space");
        read().openAiDiffTab({ ...review, approvalSessionId: "second" });
      });
      await act(async () =>
        read().closeAiDiffTab(review.approvalId, "first", status),
      );
      expect(read().tabs.filter((tab) => tab.kind === "ai-diff")).toMatchObject(
        [
          { approvalSessionId: "first", status, spaceId: "review-space" },
          {
            approvalSessionId: "second",
            status: "pending",
            spaceId: "other-space",
          },
        ],
      );
    });
  },
);
