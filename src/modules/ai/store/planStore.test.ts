import { beforeEach, describe, expect, it, vi } from "vitest";

const adapter = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    inspect: vi.fn(async (path: string) =>
      files.has(path)
        ? { kind: "file" as const, content: files.get(path) ?? "" }
        : null,
    ),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    createDirectory: vi.fn(async () => undefined),
    removeFile: vi.fn(async (path: string) => {
      files.delete(path);
    }),
    removeEmptyDirectory: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/nativeOperationAdapter", () => ({
  nativeOperationAdapter: adapter,
}));

import { usePlanStore } from "./planStore";

describe("planStore development operation", () => {
  beforeEach(() => {
    adapter.files.clear();
    adapter.files.set("/repo/a.ts", "before");
    vi.clearAllMocks();
    usePlanStore.setState({
      active: true,
      queue: [],
      lastOperation: null,
      lastError: null,
      pendingCommands: [],
    });
  });

  it("records provenance and reverts the complete operation", async () => {
    const queued = usePlanStore.getState().enqueue({
      id: "edit-1",
      kind: "edit",
      path: "/repo/a.ts",
      originalContent: "before",
      proposedContent: "after",
      isNewFile: false,
      sessionId: "session-1",
      modelId: "model-1",
      createdAt: 10,
    });
    expect(queued.ok).toBe(true);
    const applied = await usePlanStore.getState().applyAll();
    expect(applied.ok).toBe(true);
    expect(adapter.files.get("/repo/a.ts")).toBe("after");
    expect(usePlanStore.getState().lastOperation).toMatchObject({
      status: "applied",
      sessionId: "session-1",
      modelId: "model-1",
      files: ["/repo/a.ts"],
    });

    usePlanStore.getState().recordCommand({
      kind: "tests",
      command: "pnpm test",
      exitCode: 0,
      cancelled: false,
      timedOut: false,
      ranAt: 20,
    });
    expect(usePlanStore.getState().lastOperation?.commands).toHaveLength(1);

    const reverted = await usePlanStore.getState().revertLast();
    expect(reverted.ok).toBe(true);
    expect(adapter.files.get("/repo/a.ts")).toBe("before");
    expect(usePlanStore.getState().lastOperation?.status).toBe("reverted");
  });
});
