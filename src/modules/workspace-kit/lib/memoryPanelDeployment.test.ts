import { expect, it, vi } from "vitest";
import {
  canInitializeMemory,
  createMemoryPanelController,
  type MemoryPanelState,
} from "@/modules/workspace-kit/lib/memoryPanel";
import type {
  NativeMemoryScope,
  NativeMemorySelection,
  NativeMemoryReview,
} from "@/modules/workspace-kit/lib/nativeMemory";

const target = {
  path: "/owned",
  environment: { kind: "local" as const },
  source: "terminal:one",
};
const selected = {} as NativeMemorySelection;
const observation = {
  schema: 1,
  root: null,
  blockedCount: 0,
  scope: { state: "absent", ancestryComplete: true },
} as NativeMemoryScope;
const review = {
  snapshot: {
    schema: 1,
    root: "/canonical",
    deployment: { canPublish: true, entries: [], lock: null },
    isResuming: false,
    recoveryFiles: [],
    publicationBlocker: null,
  },
} as unknown as NativeMemoryReview;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const api = {
    select: vi.fn(async () => selected),
    isCurrent: vi.fn(() => true),
    discover: vi.fn(async () => observation),
    inspect: vi.fn(async () => observation),
    documents: vi.fn(),
    initializeLocalState: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    preview: vi.fn(async () => review),
    confirmPreview: vi.fn(async () => ({
      schema: 1 as const,
      created: [".voktty/kit.json"],
      migrated: [],
      skipped: [],
      cleaned: [],
    })),
    cancelPreview: vi.fn(async () => true),
    isReviewCurrent: vi.fn(() => true),
    reviewRecovery: vi.fn(),
    confirmRecovery: vi.fn(),
    cancelRecovery: vi.fn(),
    isRecoveryReviewCurrent: vi.fn(() => true),
    reviewTrust: vi.fn(),
    confirmTrust: vi.fn(),
    cancelTrust: vi.fn(),
    isTrustReviewCurrent: vi.fn(() => true),
    reviewPolicy: vi.fn(),
    confirmPolicy: vi.fn(),
    cancelPolicy: vi.fn(),
    isPolicyReviewCurrent: vi.fn(() => true),
  };
  const states: MemoryPanelState[] = [];
  const publish = vi.fn((state: MemoryPanelState) => {
    states.push(state);
  });
  const panel = createMemoryPanelController(target, publish, () => api);
  return { api, states, publish, panel };
}
it("requires complete inspection before initialization and permits existing memory repair", () => {
  expect(canInitializeMemory(observation)).toBe(true);
  for (const state of [
    "ready",
    "partial",
    "invalid",
    "denied",
    "ambiguous",
    "incomplete",
  ] as const)
    expect(
      canInitializeMemory({
        ...observation,
        scope: { ...observation.scope, state },
      }),
    ).toBe(false);
  expect(canInitializeMemory({ ...observation, blockedCount: 1 })).toBe(false);
  expect(canInitializeMemory({ ...observation, root: "/parent" })).toBe(false);
});
it("initializes in one action with project defaults and both root links without private setup", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.configure("es");
  expect(f.api.preview).toHaveBeenCalledWith(selected, {
    destination: "/owned",
    environment: { kind: "local" },
    inputs: {
      project_name: "owned",
      language: "es",
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    },
    links: { agents: true, claude: true },
  });
  expect(f.api.initializeLocalState).not.toHaveBeenCalled();
  expect(f.api.discover).not.toHaveBeenCalled();
  expect(f.api.confirmPreview).toHaveBeenCalledExactlyOnceWith(
    selected,
    review,
  );
  expect(f.states[f.states.length - 1]?.status).toBe("published");
  await f.panel.configure();
  expect(f.api.confirmPreview).toHaveBeenCalledOnce();
  await f.panel.dispose();
});
it("returns from a migration review without opening a configuration wizard or publishing", async () => {
  const f = fixture();
  const migration = {
    ...review,
    snapshot: {
      ...review.snapshot,
      deployment: {
        ...review.snapshot.deployment,
        entries: [
          {
            path: "AGENTS.md",
            action: "migrate" as const,
            reason: "root-link" as const,
            expected: "Own rules",
            proposed: "Own rules\nMemory link",
          },
        ],
      },
    },
  };
  f.api.preview.mockResolvedValue(migration);
  await f.panel.load();
  await f.panel.configure();
  await f.panel.back();
  expect(f.api.cancelPreview).toHaveBeenCalledExactlyOnceWith(selected);
  expect(f.states[f.states.length - 1]).toEqual({
    status: "ready",
    observation,
  });
  expect(f.states.some((state) => state.status === "configuring")).toBe(false);
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.dispose();
});
it("keeps unavailable ancestry blocked and permits an explicit inspection retry", async () => {
  const f = fixture();
  f.api.inspect.mockResolvedValueOnce({
    ...observation,
    scope: {
      ...observation.scope,
      state: "incomplete",
      ancestryComplete: false,
    },
  });
  await f.panel.load();
  expect(f.api.select).toHaveBeenCalledExactlyOnceWith(
    "/owned",
    { kind: "local" },
    { inspectAncestors: true },
  );
  await f.panel.configure();
  expect(f.api.preview).not.toHaveBeenCalled();
  await f.panel.inspectAncestors();
  expect(f.api.select).toHaveBeenLastCalledWith(
    "/owned",
    { kind: "local" },
    { inspectAncestors: true },
  );
  await f.panel.configure();
  expect(f.api.confirmPreview).toHaveBeenCalledOnce();
  await f.panel.dispose();
});
it("repairs ready and partial memory through the same project service", async () => {
  for (const state of ["ready", "partial"] as const) {
    const f = fixture();
    f.api.inspect.mockResolvedValue({
      ...observation,
      root: "/owned",
      scope: { ...observation.scope, state },
    });
    await f.panel.load();
    await f.panel.configure();
    expect(f.api.confirmPreview).toHaveBeenCalledOnce();
    expect(f.api.initializeLocalState).not.toHaveBeenCalled();
    await f.panel.dispose();
  }
});
it("keeps the inspected selection through create, refresh and repair without another ancestor step", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.configure();
  f.api.inspect.mockResolvedValue({
    ...observation,
    root: "/owned",
    scope: { ...observation.scope, state: "ready" },
  });
  await f.panel.load();
  await f.panel.configure();
  expect(f.api.select).toHaveBeenCalledExactlyOnceWith(
    "/owned",
    { kind: "local" },
    { inspectAncestors: true },
  );
  expect(f.api.confirmPreview).toHaveBeenCalledTimes(2);
  expect(f.api.initializeLocalState).not.toHaveBeenCalled();
  expect(f.states.some((state) => state.status === "recoveryInspection")).toBe(
    false,
  );
  await f.panel.dispose();
});
it("requires the exact displayed migration review and consumes confirmation once", async () => {
  const f = fixture();
  const migration = {
    ...review,
    snapshot: {
      ...review.snapshot,
      deployment: {
        canPublish: true,
        lock: null,
        entries: [
          {
            path: "AGENTS.md",
            action: "migrate",
            reason: "root-link",
            expected: "Own rules",
            proposed: "Own rules\nMemory link",
          },
        ],
      },
    },
  } as NativeMemoryReview;
  f.api.preview.mockResolvedValue(migration);
  await f.panel.load();
  await f.panel.configure();
  expect(f.states[f.states.length - 1]?.status).toBe("review");
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.confirm({ ...migration });
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  const confirming = f.panel.confirm(migration);
  expect(f.panel.confirm(migration)).toBe(confirming);
  await confirming;
  await f.panel.confirm(migration);
  expect(f.api.confirmPreview).toHaveBeenCalledOnce();
  await f.panel.dispose();
});
it.each(["previewing", "publishing"])(
  "does not admit later IO when the %s observer closes the panel",
  async (phase) => {
    const f = fixture();
    await f.panel.load();
    f.publish.mockImplementation((state) => {
      if (state.status === phase) void f.panel.dispose();
    });
    await f.panel.configure();
    if (phase === "previewing") expect(f.api.preview).not.toHaveBeenCalled();
    expect(f.api.confirmPreview).not.toHaveBeenCalled();
    await f.panel.dispose();
  },
);
it("suppresses a late preview after disposal without confirming it", async () => {
  const f = fixture();
  const read = deferred<NativeMemoryReview>();
  const started = deferred<void>();
  f.api.preview.mockImplementation(() => {
    started.resolve();
    return read.promise;
  });
  await f.panel.load();
  const pending = f.panel.configure();
  await started.promise;
  await f.panel.dispose();
  const count = f.publish.mock.calls.length;
  read.resolve(review);
  await pending;
  expect(f.publish).toHaveBeenCalledTimes(count);
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
});
it("blocks conflicts, platform blockers and retired reviews before automatic publication", async () => {
  for (const reason of ["conflict", "blocker", "retired"] as const) {
    const f = fixture();
    const blocked = {
      ...review,
      snapshot: {
        ...review.snapshot,
        deployment: {
          canPublish: reason !== "conflict",
          entries: [],
          lock: null,
        },
        publicationBlocker:
          reason === "blocker" ? "migrationUnsupported" : null,
      },
    } as NativeMemoryReview;
    f.api.preview.mockResolvedValue(blocked);
    if (reason === "retired") f.api.isReviewCurrent.mockReturnValue(false);
    await f.panel.load();
    await f.panel.configure();
    await f.panel.confirm(blocked);
    expect(f.api.confirmPreview).not.toHaveBeenCalled();
    await f.panel.dispose();
  }
});
it("reports partial publication without automatically retrying or claiming success", async () => {
  const f = fixture();
  const failure = {
    code: "recoveryRequired",
    changes: {
      created: [".voktty/INIT.md"],
      migrated: [],
      cleaned: [],
      possibleRecoveryFiles: ["backup"],
    },
  };
  f.api.confirmPreview.mockRejectedValueOnce(failure);
  await f.panel.load();
  await f.panel.configure();
  expect(f.states[f.states.length - 1]).toEqual({
    status: "deploymentError",
    error: failure,
  });
  await f.panel.configure();
  expect(f.api.confirmPreview).toHaveBeenCalledOnce();
  await f.panel.dispose();
});
