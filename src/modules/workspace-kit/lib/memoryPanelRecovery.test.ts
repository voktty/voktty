import {
  canReviewMemoryRecovery,
  createMemoryPanelController,
  type MemoryPanelState,
  type MemoryPanelTarget,
} from "@/modules/workspace-kit/lib/memoryPanel";
import type {
  NativeMemoryScope,
  NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type { NativeMemoryRecoveryReview } from "@/modules/workspace-kit/lib/nativeMemoryRecovery";
import { expect, it, vi } from "vitest";

const target: MemoryPanelTarget = {
  path: "/owned",
  environment: { kind: "local" },
  source: "terminal:one",
};
const selected = {} as NativeMemorySelection;
const partial = {
  schema: 1,
  root: null,
  blockedCount: 1,
  scope: { state: "partial", ancestryComplete: true },
} as NativeMemoryScope;
const review = {
  snapshot: {
    schema: 1,
    root: "/canonical",
    entries: [
      { target: ".voktty/.gitignore", backup: ".voktty/backup", text: "*\r\n" },
    ],
  },
} as unknown as NativeMemoryRecoveryReview;
const report = {
  schema: 1 as const,
  created: [".voktty/.gitignore"],
  cleaned: [".voktty/backup"],
  skipped: [],
  migrated: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture(location = target) {
  const api = {
    select: vi.fn(async () => selected),
    isCurrent: vi.fn(() => true),
    inspect: vi.fn(async () => partial),
    discover: vi.fn(async () => partial),
    documents: vi.fn(),
    initializeLocalState: vi.fn(),
    close: vi.fn(async () => {}),
    preview: vi.fn(),
    confirmPreview: vi.fn(),
    cancelPreview: vi.fn(),
    isReviewCurrent: vi.fn(() => true),
    reviewRecovery: vi.fn(async () => review),
    confirmRecovery: vi.fn(async () => report),
    cancelRecovery: vi.fn(async () => true),
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
  const panel = createMemoryPanelController(location, publish, () => api);
  return { api, states, publish, panel };
}

it("reviews partial memory only by action and requires the exact review before restoration", async () => {
  const f = fixture();
  await f.panel.reviewRecovery();
  await f.panel.load();
  expect(f.api.reviewRecovery).not.toHaveBeenCalled();
  const pending = f.panel.reviewRecovery();
  expect(f.panel.reviewRecovery()).toBe(pending);
  await pending;
  expect(f.api.reviewRecovery).toHaveBeenCalledExactlyOnceWith(selected, {
    destination: target.path,
    environment: target.environment,
  });
  await f.panel.confirmRecovery({ ...review });
  expect(f.api.confirmRecovery).not.toHaveBeenCalled();
  const confirmation = f.panel.confirmRecovery(review);
  expect(f.panel.confirmRecovery(review)).toBe(confirmation);
  await confirmation;
  expect(f.publish).toHaveBeenLastCalledWith({
    status: "recoveryRestored",
    root: "/canonical",
    report,
  });
  await f.panel.confirmRecovery(review);
  expect(f.api.confirmRecovery).toHaveBeenCalledExactlyOnceWith(
    selected,
    review,
  );
  expect(f.api.initializeLocalState).not.toHaveBeenCalled();
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it("re-inspects after restoration and starts editable initialization without publishing or reusing an old preview", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.reviewRecovery();
  await f.panel.confirmRecovery(review);
  f.api.inspect.mockResolvedValue({
    ...partial,
    blockedCount: 0,
    scope: { ...partial.scope, state: "reserved" },
  });
  await f.panel.resumeInitialization();
  expect(f.api.inspect).toHaveBeenCalledTimes(2);
  expect(f.publish).toHaveBeenLastCalledWith({
    status: "configuring",
    recovering: true,
  });
  expect(f.api.preview).not.toHaveBeenCalled();
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it("allows explicit review of pending initialization without creating private state or assuming a recoverable backup", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configureInterruptedInitialization();
  expect(f.publish).toHaveBeenLastCalledWith({
    status: "configuring",
    recovering: true,
  });
  expect(f.api.initializeLocalState).not.toHaveBeenCalled();
  expect(f.api.reviewRecovery).not.toHaveBeenCalled();
  expect(f.api.preview).not.toHaveBeenCalled();
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it.each(["restored", "pending"] as const)(
  "requires explicit ancestor inspection before reviewing %s initialization",
  async (phase) => {
    const f = fixture();
    f.api.inspect.mockResolvedValue({
      ...partial,
      scope: { ...partial.scope, ancestryComplete: false },
    });
    await f.panel.load();
    if (phase === "restored") {
      await f.panel.reviewRecovery();
      await f.panel.confirmRecovery(review);
      await f.panel.resumeInitialization();
    } else f.panel.configureInterruptedInitialization();
    expect(f.publish).toHaveBeenLastCalledWith({
      status: "recoveryInspection",
    });
    expect(f.api.select).toHaveBeenCalledExactlyOnceWith(
      target.path,
      target.environment,
    );
    await f.panel.preview({}, { agents: false, claude: false });
    expect(f.api.preview).not.toHaveBeenCalled();
    f.api.inspect.mockResolvedValue(partial);
    await f.panel.inspectAncestors();
    expect(f.api.select).toHaveBeenLastCalledWith(
      target.path,
      target.environment,
      { inspectAncestors: true },
    );
    expect(f.publish).toHaveBeenLastCalledWith({
      status: "configuring",
      recovering: true,
    });
    expect(f.api.initializeLocalState).not.toHaveBeenCalled();
    expect(f.api.confirmPreview).not.toHaveBeenCalled();
    await f.panel.dispose();
  },
);

it.each(["incomplete", "denied", "retired"] as const)(
  "does not enter resumed configuration after %s ancestor inspection",
  async (result) => {
    const f = fixture();
    f.api.inspect.mockResolvedValue({
      ...partial,
      scope: { ...partial.scope, ancestryComplete: false },
    });
    await f.panel.load();
    f.panel.configureInterruptedInitialization();
    if (result === "denied")
      f.api.select.mockRejectedValueOnce({ code: "denied" });
    if (result === "retired")
      f.publish.mockImplementation((state) => {
        if (state.status === "ready") void f.panel.dispose();
      });
    await f.panel.inspectAncestors();
    expect(f.states.some((state) => state.status === "configuring")).toBe(
      false,
    );
    expect(f.api.preview).not.toHaveBeenCalled();
    expect(f.api.confirmPreview).not.toHaveBeenCalled();
    await f.panel.dispose();
  },
);

it.each(["failure", "blocker"] as const)(
  "offers recovery after a native deployment %s without automatically restoring",
  async (kind) => {
    const f = fixture();
    f.api.inspect.mockResolvedValue({
      ...partial,
      blockedCount: 0,
      scope: { ...partial.scope, state: "absent" },
    });
    await f.panel.load();
    if (kind === "failure")
      f.api.preview.mockRejectedValueOnce({ code: "recoveryRequired" });
    else
      f.api.preview.mockResolvedValueOnce({
        snapshot: {
          deployment: { canPublish: true, entries: [] },
          publicationBlocker: "recoveryRequired",
        },
      });
    await f.panel.configure();
    await f.panel.reviewRecovery();
    expect(f.api.reviewRecovery).toHaveBeenCalledOnce();
    expect(f.api.confirmRecovery).not.toHaveBeenCalled();
    expect(f.api.confirmPreview).not.toHaveBeenCalled();
    await f.panel.dispose();
  },
);

it("does not enter initialization when fresh post-restoration inspection fails", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.reviewRecovery();
  await f.panel.confirmRecovery(review);
  f.api.inspect.mockRejectedValueOnce({ code: "denied" });
  await f.panel.resumeInitialization();
  expect(f.publish).toHaveBeenLastCalledWith({
    status: "recoveryError",
    error: { code: "denied" },
  });
  expect(f.api.preview).not.toHaveBeenCalled();
  expect(f.api.confirmPreview).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it.each(["recoveryLoading", "recoveryRestoring"] as const)(
  "rechecks ownership after a synchronous %s observer retires the panel",
  async (phase) => {
    const f = fixture();
    await f.panel.load();
    if (phase === "recoveryRestoring") await f.panel.reviewRecovery();
    f.publish.mockImplementation((state) => {
      if (state.status === phase) void f.panel.dispose();
    });
    if (phase === "recoveryRestoring") await f.panel.confirmRecovery(review);
    else await f.panel.reviewRecovery();
    expect(f.api.confirmRecovery).not.toHaveBeenCalled();
    if (phase === "recoveryLoading")
      expect(f.api.reviewRecovery).not.toHaveBeenCalled();
    await f.panel.dispose();
  },
);

it("rejects a review retired during the restoration observer before admitting writes", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.reviewRecovery();
  f.publish.mockImplementation((state) => {
    if (state.status === "recoveryRestoring")
      f.api.isRecoveryReviewCurrent.mockReturnValue(false);
  });
  await f.panel.confirmRecovery(review);
  expect(f.api.confirmRecovery).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it.each(["read", "write"] as const)(
  "suppresses late %s delivery after closing",
  async (phase) => {
    const f = fixture();
    await f.panel.load();
    const started = deferred<void>();
    const read = deferred<NativeMemoryRecoveryReview>();
    const write = deferred<typeof report>();
    if (phase === "write") {
      await f.panel.reviewRecovery();
      f.api.confirmRecovery.mockImplementation(() => {
        started.resolve();
        return write.promise;
      });
    } else
      f.api.reviewRecovery.mockImplementation(() => {
        started.resolve();
        return read.promise;
      });
    const pending =
      phase === "write"
        ? f.panel.confirmRecovery(review)
        : f.panel.reviewRecovery();
    await started.promise;
    await f.panel.dispose();
    const count = f.publish.mock.calls.length;
    read.resolve(review);
    write.resolve(report);
    await pending;
    expect(f.publish).toHaveBeenCalledTimes(count);
  },
);

it("retains partial failures, requires a new review and waits for exact cancellation before fresh discovery", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.reviewRecovery();
  const failure = {
    code: "recoveryRequired",
    changes: {
      created: ["AGENTS.md"],
      migrated: [],
      cleaned: ["original"],
      possibleRecoveryFiles: ["other"],
    },
  };
  f.api.confirmRecovery.mockRejectedValueOnce(failure);
  await f.panel.confirmRecovery(review);
  expect(f.publish).toHaveBeenLastCalledWith({
    status: "recoveryError",
    error: failure,
  });
  await f.panel.confirmRecovery(review);
  expect(f.api.confirmRecovery).toHaveBeenCalledOnce();
  const cancel = deferred<boolean>();
  const started = deferred<void>();
  f.api.cancelRecovery.mockImplementation(() => {
    started.resolve();
    return cancel.promise;
  });
  const back = f.panel.backRecovery();
  await started.promise;
  expect(f.api.inspect).toHaveBeenCalledOnce();
  cancel.resolve(true);
  await back;
  expect(f.api.inspect).toHaveBeenCalledTimes(2);
  await f.panel.confirmRecovery(review);
  expect(f.api.confirmRecovery).toHaveBeenCalledOnce();
  await f.panel.dispose();
});

it("never offers recovery for WSL, Docker or malformed sources", async () => {
  for (const location of [
    { ...target, path: "" },
    { ...target, path: "/owned\0invalid" },
    { ...target, environment: { kind: "wsl", distro: "Ubuntu" } },
    {
      ...target,
      environment: {
        kind: "docker",
        connection: {
          containerId: "container",
          containerName: "container",
          image: "test",
        },
      },
    },
  ] as MemoryPanelTarget[]) {
    const f = fixture(location);
    await f.panel.load();
    await f.panel.reviewRecovery();
    expect(f.api.reviewRecovery).not.toHaveBeenCalled();
    await f.panel.dispose();
  }
  expect(canReviewMemoryRecovery(target, partial)).toBe(true);
  for (const state of ["ready", "absent", "reserved", "denied"] as const)
    expect(
      canReviewMemoryRecovery(target, {
        ...partial,
        scope: { ...partial.scope, state },
      }),
    ).toBe(false);
});
