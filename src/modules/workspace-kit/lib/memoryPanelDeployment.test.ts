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
    root: "/canonical",
    deployment: { canPublish: true },
    publicationBlocker: null,
  },
} as NativeMemoryReview;
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
  };
  const states: MemoryPanelState[] = [];
  const publish = vi.fn((state: MemoryPanelState) => {
    states.push(state);
  });
  const panel = createMemoryPanelController(target, publish, () => api);
  return { api, states, publish, panel };
}
it("requires complete absence, and never interprets a kit or incomplete scope as initialization permission", () => {
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
  expect(
    canInitializeMemory({
      ...observation,
      scope: { ...observation.scope, ancestryComplete: false },
    }),
  ).toBe(false);
});
it("inspects ancestors only by explicit action with a fresh selection and no state initialization", async () => {
  const f = fixture();
  f.api.discover.mockResolvedValueOnce({
    ...observation,
    scope: {
      ...observation.scope,
      state: "incomplete",
      ancestryComplete: false,
    },
  });
  await f.panel.load();
  f.panel.configure();
  expect(f.states[f.states.length - 1]?.status).toBe("ready");
  await f.panel.inspectAncestors();
  expect(f.api.select).toHaveBeenLastCalledWith(
    "/owned",
    { kind: "local" },
    { inspectAncestors: true },
  );
  expect(f.api.initializeLocalState).not.toHaveBeenCalled();
  f.panel.configure();
  expect(f.states[f.states.length - 1]?.status).toBe("configuring");
  await f.panel.dispose();
});
it("captures preview inputs, requires the exact displayed review, and consumes confirmation once", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configure();
  const values = { project_name: "original" };
  const links = { agents: false, claude: false };
  const pending = f.panel.preview(values, links);
  values.project_name = "changed";
  links.agents = true;
  await pending;
  expect(f.api.preview).toHaveBeenCalledWith(selected, {
    destination: "/owned",
    environment: { kind: "local" },
    inputs: { project_name: "original" },
    links: { agents: false, claude: false },
  });
  await f.panel.confirm({ ...review });
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  const confirming = f.panel.confirm(review);
  expect(f.panel.confirm(review)).toBe(confirming);
  await confirming;
  await f.panel.confirm(review);
  expect(f.api.confirmPreview).toHaveBeenCalledOnce();
  expect(f.states[f.states.length - 1]?.status).toBe("published");
  await f.panel.dispose();
});
it("withdraws confirmation admission when a publication observer closes the panel", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configure();
  await f.panel.preview({}, { agents: false, claude: false });
  f.publish.mockImplementation((state) => {
    if (state.status === "publishing") void f.panel.dispose();
  });
  await f.panel.confirm(review);
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.dispose();
});
it("blocks conflicts, native blockers and retired reviews before publication", async () => {
  for (const snapshot of [
    {
      ...review.snapshot,
      deployment: { ...review.snapshot.deployment, canPublish: false },
    },
    { ...review.snapshot, publicationBlocker: "migrationUnsupported" },
    review.snapshot,
  ]) {
    const f = fixture();
    const blocked = { ...review, snapshot };
    f.api.preview.mockResolvedValueOnce(blocked);
    await f.panel.load();
    f.panel.configure();
    await f.panel.preview({}, { agents: false, claude: false });
    if (snapshot === review.snapshot)
      f.api.isReviewCurrent.mockReturnValue(false);
    await f.panel.confirm(blocked);
    expect(f.api.confirmPreview).not.toHaveBeenCalled();
    await f.panel.dispose();
  }
});
it("suppresses a late preview after disposal and never confirms it", async () => {
  const f = fixture();
  const read = deferred<NativeMemoryReview>();
  const started = deferred<void>();
  f.api.preview.mockImplementation(() => {
    started.resolve();
    return read.promise;
  });
  await f.panel.load();
  f.panel.configure();
  const pending = f.panel.preview({}, { agents: false, claude: false });
  await started.promise;
  await f.panel.dispose();
  const count = f.publish.mock.calls.length;
  read.resolve(review);
  await pending;
  expect(f.publish).toHaveBeenCalledTimes(count);
  await f.panel.confirm(review);
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
});
it("retires a reviewed preview before returning to editable setup and never retries partial writes automatically", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configure();
  await f.panel.preview({}, { agents: false, claude: false });
  await f.panel.back();
  expect(f.api.cancelPreview).toHaveBeenCalledWith(selected);
  await f.panel.confirm(review);
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.preview({}, { agents: false, claude: false });
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
  await f.panel.confirm(review);
  expect(f.states[f.states.length - 1]).toEqual({
    status: "deploymentError",
    error: failure,
  });
  await f.panel.confirm(review);
  expect(f.api.confirmPreview).toHaveBeenCalledOnce();
  await f.panel.dispose();
});
